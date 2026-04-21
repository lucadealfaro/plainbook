# Plainbook Action Log Reference

When Plainbook is run with `--log`, every user-initiated action is recorded as a structured entry in `notebook.metadata['log']` inside the notebook file. The notebook itself is therefore the session record — no sidecar files — and can be replayed or analyzed after the study.

## Where the log lives

- **Location**: `notebook.metadata.log` — a JSON array appended in chronological order.
- **Persistence**: written to disk after every entry via the normal notebook save path.
- **Lifecycle**: if `--log` is off, the log is not created, and any existing log in the notebook is left untouched.

## Entry shape

Every entry — server-recorded or client-recorded — conforms to the same schema:

```json
{
  "ts_server": "2026-04-15T14:32:01.123Z",
  "ts_client": "2026-04-15T14:32:01.117Z",
  "source": "server" | "client",
  "op": "edit_code",
  "params": { ... },
  "result": { ... },
  "cell_id": "abc-uuid",
  "cell_index": 4,
  "cell_snapshot": {
    "cell_id": "abc-uuid",
    "cell_type": "code",
    "changed": true,
    "source": "...",
    "description": "..."
  },
  "duration_ms": 42,
  "error": null
}
```

### Field meanings

| Field | Meaning |
|---|---|
| `ts_server` | ISO-8601 UTC timestamp at which the server recorded the entry. Always present. |
| `ts_client` | ISO-8601 UTC timestamp from the browser. Present on client events. Useful for computing client/server clock skew. |
| `source` | `"server"` for API-call events, `"client"` for UX events forwarded via `/log_client_event`. |
| `op` | Operation name. Server ops are route names (`edit_code`, `execute_cell`, ...). Client ops are `active_cell_change`. |
| `params` | The filtered request payload. API keys are redacted as `"<redacted len=N>"`. Large fields (AI instructions, file lists) are truncated to 4KB. |
| `result` | The filtered response body. The large `state` dict that most endpoints return is **always stripped**. Execution outputs are dropped. AI-generated code is truncated to 8KB. |
| `cell_id` | nbformat UUID of the affected cell. Stable across reorders. Use this as the primary cell identifier in analysis. |
| `cell_index` | Zero-based position of the cell at the time of the call. Unstable — cells shift on insert/delete/move. |
| `cell_snapshot` | Post-mutation state of the affected cell, present only for ops where it's informative (see table below). |
| `duration_ms` | Server handling time for the op (entry to exit of the handler). |
| `error` | `null` on success. On failure, `repr()` of the exception. Handler failure does not suppress the log entry. |

### `cell_snapshot` fields

```json
{
  "cell_id": "abc-uuid",
  "cell_type": "code" | "markdown" | "test",
  "changed": true | false,
  "source": "<full source text>",
  "description": "<full explanation text>",
  "error": {
    "ename": "NameError",
    "evalue": "name 'x' is not defined",
    "traceback": ["<line>", "<line>", "..."]
  },
  "stderr": "<full stderr stream text>"
}
```

- `changed` is `true` iff the cell's `(source, description)` pair differs from what was logged for this cell the last time a snapshot was taken. The comparison uses sha1 stored on the cell itself at `cell.metadata['_last_logged_hash']`.
- `source` and `description` are **only present when `changed` is true**. This keeps the log compact: repeated executes of an unmodified cell contribute `{cell_id, cell_type, changed: false}` and nothing else.
- `error` is **only present** when the cell has an nbformat output of type `"error"` (i.e. the execution raised an exception). It preserves `ename`, `evalue`, and `traceback` verbatim.
- `stderr` is **only present** when the cell produced a `stream` output on the `stderr` channel (warnings, `print(..., file=sys.stderr)`, etc.).
- Regular `stream` (stdout), `display_data`, and `execute_result` outputs are never logged — only error signals are preserved.

## Server-recorded ops

The authoritative list is `plainbook/action_log.py::OP_LOG_CONFIG`.

| op | params | result | cell_snapshot |
|---|---|---|---|
| `edit_code`, `edit_markdown`, `edit_explanation`, `clear_code` | full | `{status, ...}` | yes |
| `execute_cell`, `execute_test_cell`, `run_unit_test_cell` | full | `{status}` (outputs dropped; errors surface via `cell_snapshot.error`/`stderr`) | yes |
| `generate_code`, `generate_test_code`, `generate_unit_test_cell_code` | full | code truncated to 8KB | yes |
| `validate_code`, `validate_unit_test_code` | full | validation dict verbatim | yes |
| `insert_cell` | full | `{status, cell.id, index}` | yes |
| `delete_cell`, `move_cell` | full | `{status}` | no |
| `set_key` | `gemini_api_key` / `claude_api_key` redacted as `"<redacted len=N>"` | `{status, active_ai_provider, ...}` | no |
| `reset_kernel`, `interrupt_kernel`, `clear_outputs`, `cancel_ai_request`, `reset_tokens` | full | `{status}` | no |
| `lock_notebook`, `set_active_ai`, `set_share_output` | full | `{status, ...}` | no |
| `set_files`, `set_ai_instructions` | large fields trimmed to 4KB | `{status}` | no |
| `set_validation_visibility`, `set_unit_test_validation_visibility`, `save_unit_tests`, `save_unit_test_explanation`, `save_unit_test_code`, `clear_unit_test_code`, `clear_unit_test_outputs` | full | `{status}` | yes |

Read-only and connection ops (`get_notebook`, `state`, `current_dir`, `home_dir`, `file_list`, `get_files`, `get_ai_instructions`, `get_unit_test_state`, `login`, `/`, `debug_request`) are **not logged**.

## Client-recorded ops

Just one event type:

### `active_cell_change`

```json
{
  "source": "client",
  "op": "active_cell_change",
  "ts_client": "...",
  "ts_server": "...",
  "from_id": "prev-uuid" | null,
  "from_index": 2,
  "to_id": "new-uuid",
  "to_index": 5,
  "duration_on_prev_ms": 8421
}
```

Emitted when the user clicks into a different cell. `from_*` fields are `null` on the first event of a session. `duration_on_prev_ms` is the wall-clock time the previous cell spent as the active cell.

## Computing common metrics

### Total time on notebook

Take the timestamps of the first and last entries:
```python
from datetime import datetime
def iso_to_ms(s): return datetime.fromisoformat(s.rstrip('Z')).timestamp() * 1000
log = nb.metadata['log']
total_ms = iso_to_ms(log[-1]['ts_server']) - iso_to_ms(log[0]['ts_server'])
```
This overestimates if the user walked away. To get engaged time, subtract gaps longer than a threshold (e.g. 2 minutes) between consecutive timestamps.

### Time per cell

Sum `duration_on_prev_ms` grouped by `from_id`:
```python
from collections import defaultdict
per_cell = defaultdict(int)
for e in log:
    if e.get('op') == 'active_cell_change' and e.get('from_id'):
        per_cell[e['from_id']] += e['duration_on_prev_ms']
```
The last cell the user was on is not closed out (no subsequent change), so append an implicit `now − last_active_ts` if needed.

### Edit churn per cell

Count `edit_code` / `edit_explanation` / `edit_markdown` entries grouped by `cell_id` where `cell_snapshot.changed` is true.

### Execution count per cell

Count `execute_cell` / `execute_test_cell` / `run_unit_test_cell` entries grouped by `cell_id`.

### AI assistance per cell

Count `generate_*` and `validate_*` entries grouped by `cell_id`.

### Failure rate

Fraction of entries where:
- top-level `error` is non-null (server-side handler exception), OR
- `cell_snapshot.error` is present (user code raised during execution).

The first signals a bug in plainbook or a bad request; the second signals the user's code didn't run to completion.

## Reconstructing a session

Log entries are totally ordered by `ts_server`. To replay the session:
1. Start from a fresh copy of the notebook (outputs stripped).
2. For each server-sourced entry in order, apply `params` to the corresponding operation on the notebook.
3. Ignore client-sourced entries (they carry no state-mutation payload — only timing signals).

The `cell_snapshot.source` / `description` values can be used to verify the replay matches the recorded state at each step.

## Viewing logs

Logs are **recorded** with `--log` and **viewed** with `--logview`. These are separate flags:

| Flag | What it does |
|---|---|
| `--log` | Record user actions into `notebook.metadata['log']`. No viewer UI. |
| `--logview` | Serve the `/log_view` replay UI. The notebook is **read-only** — all mutating routes return HTTP 403 and the editor disables edits. No new log entries are written. |
| *(both)* | `--logview` wins: the notebook is read-only and logging is off for that run. |

Typical workflow: run a study session with `--log`, close the server, then later inspect the captured session with `--logview`.

Under `--logview`, the main notebook navbar shows a "Log viewer" button that opens `/log_view?token=<token>` in the same tab.

The viewer:

- Starts from `notebook.metadata['log_initial_state']` — a snapshot captured the first time `--log` was enabled on the notebook. It contains the cells (id, type, source, metadata) and notebook-level metadata at that moment.
- Replays log entries in order up to the slider position to reconstruct the notebook state at any instant.
- Renders the reconstructed cells read-only using the same components as the editor.
- Shows a timeline above the cells with a dot per log entry, colour-coded by op category (edits = green, structural = blue, executions = yellow, AI = purple, settings/reset = red, client `active_cell_change` = small grey). Click a dot to seek to that entry and open a side panel with the full entry details (params, result, duration, error, snapshot).
- Highlights the cell that was active (per the most recent `active_cell_change`) at the slider's time.

**Caveats**

- Outputs are not replayable — only errors and stderr recorded in `cell_snapshot.error` / `cell_snapshot.stderr` are rendered. Regular prints and plots are not available.
- If `log_initial_state` is absent (e.g. the notebook existed before `--log` was ever used), the viewer shows a warning banner and falls back to the current notebook state as the starting point — replay will be inaccurate for the period before the first logged event.
- Cycling `--log` on and off across sessions can desynchronise the initial state from the log. The initial state is only captured once, so edits made while logging was off are not reflected in replay.

## Privacy notes

- API keys are redacted from `/set_key` params.
- Cell outputs are not logged — if a cell printed sensitive data, it will not leak into the log (except error tracebacks and stderr, which are preserved).
- The log does capture full source code and explanations the user typed; treat the notebook file as sensitive accordingly.
