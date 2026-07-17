# Amend & Fold Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse append and fold into a single amend that folds an instruction into the cell's explanation, then regenerates from it, so a cell never holds code its own explanation did not produce.

**Architecture:** `cell.metadata.additions` is deleted; a cell has one `explanation`. `propose_amend` returns an AI fold of `explanation + text` without mutating anything; the user reviews it; `commit_amend` snapshots `{explanation, source}`, installs the folded text, and **marks the code stale**. The client then drives the existing `generateCodeOneCell` + `runCells` pipeline. `unfold` restores the snapshotted text *and* code, so undo needs no AI call.

**Tech Stack:** Python 3, bottle.py, nbformat, pytest, Vue 3 (ES modules, no build step), Bulma, boxicons.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-16-amend-and-fold-design.md`. It governs; this plan implements it.
- **The invariant:** a cell has exactly one explanation, and code that a real generation from that explanation actually produced. Every operation preserves it or marks the code stale.
- Run Python with `python3` — `python` is not on PATH in this environment.
- Run tests from the repo root: `python3 -m pytest tests/ -q`.
- Comments: one-line docstrings, short inline comments, matching the surrounding code. No comment restating what the code says.
- Commit messages: no AI/Claude authorship, no `Co-Authored-By` trailer, no emoji.
- Do not touch `claude.py` or `gemini.py`. The provider `fold` functions already accept `additions` as a list; amend passes a single-element list.
- `plainbook/css/main.css` is generated from `main.scss` via `npm run build`, which **fails in this environment** (`sass: Permission denied`). SCSS comment/rule deletions that affect `main.css` cannot be rebuilt here — see Task 6.

---

### Task 1: Server — amend core

Replaces the additions data model with propose/commit/unfold on a single explanation. This is the task that fixes the bug: `commit_amend` marks the code stale where `commit_fold` deliberately did not.

**Files:**
- Modify: `plainbook/plainbook.py:860-988` (the whole `# Incremental additions (prompt folding)` block), `plainbook/plainbook.py:1471`
- Test: `tests/test_folding.py` (rewrite in full)

**Interfaces:**
- Consumes: `AI_PROVIDERS[provider]["fold"]`, called as `fold_fn(api_key, explanation=str, additions=[str], model=..., debug=..., dump_ai_requests=...)` → `str`. Unchanged from today.
- Produces:
  - `Plainbook.propose_amend(api_key, index, text, ai_provider="gemini", model=None) -> str`
  - `Plainbook.commit_amend(index, folded_explanation) -> None`
  - `Plainbook.unfold(index) -> {'explanation': str, 'source': str} | None`
  - `Plainbook._normalize_explanation(explanation) -> str` (kept, static)
  - `Plainbook._mark_code_stale(index) -> None` (kept, unchanged)
  - Removed: `add_cell_addition`, `delete_cell_addition`, `fold_additions`, `commit_fold`, `_explanation_with_additions`

**Expected transient breakage:** this task deletes `add_cell_addition`, `delete_cell_addition`, `fold_additions`, and `commit_fold`, which `main.py` still calls at lines 409, 420, 434, and 451. Those routes will 500 until Task 3 replaces them. The module still imports and the suite still passes, so this is expected — do **not** keep the old methods alive to paper over it. Land Task 3 promptly.

- [ ] **Step 1: Write the failing tests**

Replace the entire contents of `tests/test_folding.py` with:

```python
import pytest

import plainbook.plainbook as pb
from plainbook.plainbook import Plainbook


@pytest.fixture
def notebook(tmp_notebook_path):
    """Creates a Plainbook instance and shuts it down after the test."""
    nb = Plainbook(tmp_notebook_path)
    yield nb
    nb._shutdown()


def _add_action_cell(notebook, explanation, source="print(1)"):
    """Insert a code (action) cell with an explanation and valid code/output."""
    cell, idx = notebook.insert_cell(len(notebook.nb.cells), 'code')
    notebook.set_cell_explanation(idx, explanation)
    notebook.set_cell_source(idx, source)
    notebook.last_valid_code_cell = idx
    notebook.last_valid_output_cell = idx
    return idx


class TestProposeAmend:

    def test_passes_explanation_and_text_to_provider(self, notebook, monkeypatch):
        idx = _add_action_cell(notebook, "Plot revenue.")
        captured = {}

        def fake_fold(api_key, explanation=None, additions=None, model=None,
                      debug=False, dump_ai_requests=False):
            captured['explanation'] = explanation
            captured['additions'] = additions
            return "Plot revenue on log axes."

        monkeypatch.setitem(pb.AI_PROVIDERS['gemini'], 'fold', fake_fold)
        result = notebook.propose_amend("key", idx, "make the axes log scale",
                                        ai_provider='gemini')
        assert result == "Plot revenue on log axes."
        assert captured['explanation'] == "Plot revenue."
        assert captured['additions'] == ["make the axes log scale"]

    def test_does_not_mutate_the_cell(self, notebook, monkeypatch):
        idx = _add_action_cell(notebook, "Plot revenue.")
        monkeypatch.setitem(pb.AI_PROVIDERS['gemini'], 'fold',
                            lambda *a, **k: "Plot revenue on log axes.")
        notebook.propose_amend("key", idx, "log scale", ai_provider='gemini')
        cell = notebook.nb.cells[idx]
        assert cell.metadata['explanation'] == "Plot revenue."
        assert 'explanation_prefold' not in cell.metadata
        # Proposing is non-committal: the code is untouched.
        assert notebook.last_valid_code_cell == idx

    def test_empty_text_returns_base_without_calling_ai(self, notebook, monkeypatch):
        idx = _add_action_cell(notebook, "Plot revenue.")

        def boom(*a, **k):
            raise AssertionError("AI must not be called for an empty amendment")

        monkeypatch.setitem(pb.AI_PROVIDERS['gemini'], 'fold', boom)
        assert notebook.propose_amend("key", idx, "   ", ai_provider='gemini') == "Plot revenue."


class TestCommitAmend:

    def test_snapshots_explanation_and_source(self, notebook):
        idx = _add_action_cell(notebook, "Plot revenue.", source="plot(df)")
        notebook.commit_amend(idx, "Plot revenue on log axes.")
        cell = notebook.nb.cells[idx]
        assert cell.metadata['explanation'] == "Plot revenue on log axes."
        snap = cell.metadata['explanation_prefold']
        assert snap['explanation'] == "Plot revenue."
        assert snap['source'] == "plot(df)"

    def test_marks_code_stale_so_the_pipeline_regenerates(self, notebook):
        idx = _add_action_cell(notebook, "Plot revenue.")
        notebook.last_valid_code_cell = idx
        notebook.last_valid_output_cell = idx
        notebook.commit_amend(idx, "Plot revenue on log axes.")
        # The folded text has never generated code. It must not be left
        # standing next to code produced by the old explanation.
        assert notebook.last_valid_code_cell == idx - 1
        assert notebook.last_valid_output_cell == idx - 1


class TestUnfold:

    def test_restores_explanation_and_source(self, notebook):
        idx = _add_action_cell(notebook, "Plot revenue.", source="plot(df)")
        notebook.commit_amend(idx, "Plot revenue on log axes.")
        notebook.set_cell_source(idx, "plot(df, logy=True)")
        result = notebook.unfold(idx)
        cell = notebook.nb.cells[idx]
        assert cell.metadata['explanation'] == "Plot revenue."
        assert cell.source == "plot(df)"
        assert 'explanation_prefold' not in cell.metadata
        assert result == {'explanation': "Plot revenue.", 'source': "plot(df)"}

    def test_calls_no_provider(self, notebook, monkeypatch):
        idx = _add_action_cell(notebook, "Plot revenue.", source="plot(df)")
        notebook.commit_amend(idx, "Plot revenue on log axes.")

        def boom(*a, **k):
            raise AssertionError("unfold must not call the AI")

        monkeypatch.setitem(pb.AI_PROVIDERS['gemini'], 'fold', boom)
        notebook.unfold(idx)

    def test_marks_only_the_output_stale(self, notebook):
        idx = _add_action_cell(notebook, "Plot revenue.", source="plot(df)")
        notebook.commit_amend(idx, "Plot revenue on log axes.")
        notebook.last_valid_code_cell = idx
        notebook.last_valid_output_cell = idx
        notebook.unfold(idx)
        # The restored pair already ran together: the code is valid where it
        # sits, only its output needs re-running.
        assert notebook.last_valid_code_cell == idx
        assert notebook.last_valid_output_cell == idx - 1

    def test_without_snapshot_returns_none(self, notebook):
        idx = _add_action_cell(notebook, "Plot revenue.")
        assert notebook.unfold(idx) is None

    def test_legacy_snapshot_without_source_marks_code_stale(self, notebook):
        idx = _add_action_cell(notebook, "Folded text.", source="plot(df)")
        # A snapshot written by the previous version: no source, so a true
        # undo is impossible.
        notebook.nb.cells[idx].metadata['explanation_prefold'] = {
            'explanation': "Plot revenue.",
            'additions': [{'id': 'a1', 'text': "log scale"}],
        }
        notebook.last_valid_code_cell = idx
        notebook.last_valid_output_cell = idx
        result = notebook.unfold(idx)
        cell = notebook.nb.cells[idx]
        assert cell.metadata['explanation'] == "Plot revenue."
        assert result['source'] is None
        # No code to restore, so it must be regenerated rather than trusted.
        assert notebook.last_valid_code_cell == idx - 1


class TestGeneratorReadsExplanationDirectly:

    def test_no_additions_machinery_remains(self, notebook):
        assert not hasattr(notebook, 'add_cell_addition')
        assert not hasattr(notebook, 'delete_cell_addition')
        assert not hasattr(notebook, '_explanation_with_additions')
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python3 -m pytest tests/test_folding.py -q`
Expected: FAIL — `AttributeError: 'Plainbook' object has no attribute 'propose_amend'`.

- [ ] **Step 3: Replace the additions block**

In `plainbook/plainbook.py`, replace lines 860-988 (from `    # Incremental additions (prompt folding)` through the end of `unfold`, up to but not including `    # Unit test metadata methods (stubs for Phase 1)`) with:

```python
    # Amend and fold

    @staticmethod
    def _normalize_explanation(explanation):
        """Coerces an explanation to a string (new cells store [] initially)."""
        if isinstance(explanation, list):
            return ''.join(explanation)
        return explanation or ''

    def _mark_code_stale(self, index):
        """Invalidates a cell and everything downstream, as an explanation edit does."""
        self.last_valid_code_cell = min(self.last_valid_code_cell, index - 1)
        self.last_valid_output_cell = min(self.last_valid_output_cell, index - 1)
        self.last_valid_test_cell = min(self.last_valid_test_cell, index - 1)
        if self.nb.cells[index].metadata.get('unit_tests'):
            self._invalidate_all_unit_tests(index, 'setup_code')
        for j in range(index + 1, len(self.nb.cells)):
            if self.nb.cells[j].metadata.get('unit_tests'):
                self._invalidate_all_unit_tests(j, 'setup_code')

    def propose_amend(self, api_key, index, text, ai_provider="gemini", model=None):
        """Returns the explanation rewritten to incorporate `text`. Does not modify
        the cell; the caller reviews the result and calls commit_amend."""
        with self._lock:
            assert 0 <= index < len(self.nb.cells)
            cell = self.nb.cells[index]
            assert cell.cell_type in ('code', 'test')
            base = self._normalize_explanation(cell.metadata.get('explanation'))
            if not (text or '').strip():
                return base
            if self.ai_request_pending:
                raise RuntimeError("An AI request is already pending.")
            try:
                self.ai_request_pending = True
                fold_fn = AI_PROVIDERS[ai_provider]["fold"]
                return fold_fn(api_key, explanation=base, additions=[text],
                               model=model, debug=self.debug,
                               dump_ai_requests=self.dump_ai_requests)
            finally:
                self.ai_request_pending = False

    def commit_amend(self, index, folded_explanation):
        """Installs a folded explanation, snapshotting the explanation and code it
        replaces so it can be undone. Marks the code stale: the folded text has not
        generated code yet, and the caller regenerates from it."""
        with self._lock:
            assert 0 <= index < len(self.nb.cells)
            cell = self.nb.cells[index]
            assert cell.cell_type in ('code', 'test')
            cell.metadata['explanation_prefold'] = {
                'explanation': self._normalize_explanation(cell.metadata.get('explanation')),
                'source': tostring(cell.source),
            }
            cell.metadata['explanation'] = folded_explanation
            cell.metadata['explanation_timestamp'] = datetime.datetime.now().isoformat()
            self._mark_code_stale(index)
            self._write()

    def unfold(self, index):
        """Restores the explanation and code saved by commit_amend, returning both,
        or None if there is no snapshot. A restored pair already ran together, so
        only the output is stale. Snapshots from before the amend redesign have no
        code to restore, and leave the code stale instead."""
        with self._lock:
            assert 0 <= index < len(self.nb.cells)
            cell = self.nb.cells[index]
            assert cell.cell_type in ('code', 'test')
            snapshot = cell.metadata.get('explanation_prefold')
            if not snapshot:
                return None
            source = snapshot.get('source')
            cell.metadata['explanation'] = snapshot.get('explanation', '')
            cell.metadata['explanation_timestamp'] = datetime.datetime.now().isoformat()
            del cell.metadata['explanation_prefold']
            if source is None:
                self._mark_code_stale(index)
            else:
                cell.source = source
                self._invalidate_execution(index)
                self.last_valid_code_cell = min(self.last_valid_code_cell, index)
                self.last_valid_output_cell = min(self.last_valid_output_cell, index - 1)
                self.last_valid_test_cell = min(self.last_valid_test_cell, index - 1)
            self._write()
            return {'explanation': cell.metadata['explanation'], 'source': source}
```

- [ ] **Step 4: Point the generator at the explanation**

In `plainbook/plainbook.py`, at line 1471, change:

```python
            instructions = self._get_instructions(self._explanation_with_additions(cell))
```

to:

```python
            instructions = self._get_instructions(cell.metadata.get('explanation'))
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `python3 -m pytest tests/test_folding.py -q`
Expected: PASS, 11 passed.

- [ ] **Step 6: Run the full suite for regressions**

Run: `python3 -m pytest tests/ -q`
Expected: PASS. If `tests/test_plainbook.py` references `additions`, update it to match the new model.

- [ ] **Step 7: Commit**

```bash
git add plainbook/plainbook.py tests/test_folding.py
git commit -m "Fold an amendment into the explanation before regenerating

A cell held code generated from the explanation plus its additions, while
commit_fold installed an AI rewrite of that text and left the code valid. The
rewrite was never verified, so a cell could ship code its explanation did not
produce, and regenerating later could give a different result.

An amendment is now folded into the explanation first, and the code is marked
stale so the caller regenerates from the folded text. Unfold restores the
explanation and the code together, so it needs no AI call and cannot drift."
```

---

### Task 2: Legacy notebook migration

Notebooks written by the previous version carry `additions` and old-shape snapshots. Neither may leave a cell violating the invariant. The `unfold` half of this is already handled in Task 1; this task covers load.

**Files:**
- Modify: `plainbook/plainbook.py:530` (beside the existing unit-test migration block)
- Test: `tests/test_folding.py` (append a class)

**Interfaces:**
- Consumes: `Plainbook._normalize_explanation` from Task 1.
- Produces: no new public API. On load, cells have no `additions` key.

- [ ] **Step 1: Write the failing test**

Append to `tests/test_folding.py`:

```python
class TestLegacyMigration:

    def test_leftover_additions_are_folded_onto_the_explanation(self, tmp_notebook_path):
        nb = Plainbook(tmp_notebook_path)
        idx = _add_action_cell(nb, "Plot revenue.")
        nb.nb.cells[idx].metadata['additions'] = [
            {'id': 'a1', 'text': "Color the bars blue."},
            {'id': 'a2', 'text': "Drop null rows first."},
        ]
        nb._write()
        nb._shutdown()

        reloaded = Plainbook(tmp_notebook_path)
        try:
            cell = reloaded.nb.cells[idx]
            explanation = cell.metadata['explanation']
            # The guidance must survive, and the key must be gone.
            assert "Plot revenue." in explanation
            assert "Color the bars blue." in explanation
            assert "Drop null rows first." in explanation
            assert 'additions' not in cell.metadata
        finally:
            reloaded._shutdown()

    def test_empty_additions_leave_the_explanation_alone(self, tmp_notebook_path):
        nb = Plainbook(tmp_notebook_path)
        idx = _add_action_cell(nb, "Plot revenue.")
        nb.nb.cells[idx].metadata['additions'] = []
        nb._write()
        nb._shutdown()

        reloaded = Plainbook(tmp_notebook_path)
        try:
            cell = reloaded.nb.cells[idx]
            assert cell.metadata['explanation'] == "Plot revenue."
            assert 'additions' not in cell.metadata
        finally:
            reloaded._shutdown()
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python3 -m pytest tests/test_folding.py::TestLegacyMigration -q`
Expected: FAIL — `assert 'additions' not in cell.metadata`.

- [ ] **Step 3: Add the migration**

In `plainbook/plainbook.py`, immediately before the existing `# Migrate old unit test format` comment at line 530, insert:

```python
        # Migrate cells written before amend: fold leftover additions into the
        # explanation, so their guidance is not silently dropped.
        for cell in self.nb.cells:
            additions = cell.metadata.pop('additions', None)
            if additions:
                base = self._normalize_explanation(cell.metadata.get('explanation'))
                guidance = "\n".join(f"- {a.get('text', '')}" for a in additions)
                cell.metadata['explanation'] = f"{base}\n\nAdditional guidance:\n{guidance}"

```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python3 -m pytest tests/test_folding.py -q`
Expected: PASS, 13 passed.

- [ ] **Step 5: Verify against the real legacy notebook**

`test.plnb` in the repo root is a real notebook from the previous version: its cell has `additions: []` and an `explanation_prefold` carrying `additions`.

Run:
```bash
python3 -c "
from plainbook.plainbook import Plainbook
nb = Plainbook('test.plnb')
c = nb.nb.cells[0]
print('additions key present:', 'additions' in c.metadata)
print('explanation:', repr(c.metadata['explanation']))
print('unfold:', nb.unfold(0))
nb._shutdown()
"
```
Expected: `additions key present: False`; the explanation is unchanged (its additions list was empty); `unfold` returns a dict with `'source': None`, having marked the code stale rather than restoring code it does not have.

Note: this rewrites `test.plnb` in place. It is untracked scratch, so that is fine — but do not stage it.

- [ ] **Step 6: Commit**

```bash
git add plainbook/plainbook.py tests/test_folding.py
git commit -m "Fold leftover additions into the explanation on load

Notebooks written before amend carry an additions list that nothing reads now.
Folding it onto the explanation at load keeps the guidance rather than dropping
it silently."
```

---

### Task 3: Endpoints and action log

**Files:**
- Modify: `plainbook/main.py:401-469` (the `/add_addition` … `/unfold` routes)
- Modify: `plainbook/action_log.py:69-73`

**Interfaces:**
- Consumes: `propose_amend`, `commit_amend`, `unfold` from Task 1.
- Produces (client contract for Tasks 4-5):
  - `POST /propose_amend {cell_index, text}` → `{status:'success', proposed}` | `{status:'error', message}`
  - `POST /commit_amend {cell_index, explanation}` → `{status:'success'}`
  - `POST /unfold {cell_index}` → `{status:'success', explanation, source}` | `{status:'error', message}`

- [ ] **Step 1: Replace the routes**

In `plainbook/main.py`, replace the four routes `add_addition`, `delete_addition`, `fold_additions`, `commit_fold` and the existing `unfold` (lines 401-469, ending before `@post('/edit_code')`) with:

```python
@post('/propose_amend')
@action_log.logged('propose_amend')
@stateful
@require_token
def propose_amend():
    data = request.json
    cell_index = data.get('cell_index')
    text = data.get('text')
    api_key, ai_provider, model, error = _get_ai_config()
    if error:
        return dict(status='error', message=error)
    try:
        proposed = notebook.propose_amend(
            api_key, cell_index, text, ai_provider=ai_provider, model=model)
    except Exception as e:
        friendly = _check_billing_error(e)
        if friendly:
            return dict(status='error', message=friendly)
        raise
    return dict(status='success', proposed=proposed)

@post('/commit_amend')
@action_log.logged('commit_amend')
@stateful
@require_token
def commit_amend():
    data = request.json
    cell_index = data.get('cell_index')
    explanation = data.get('explanation')
    notebook.commit_amend(cell_index, explanation)
    return dict(status='success')

@post('/unfold')
@action_log.logged('unfold')
@stateful
@require_token
def unfold():
    data = request.json
    cell_index = data.get('cell_index')
    result = notebook.unfold(cell_index)
    if result is None:
        return dict(status='error', message='Nothing to unfold.')
    return dict(status='success', explanation=result['explanation'],
                source=result['source'])
```

- [ ] **Step 2: Update the action log config**

In `plainbook/action_log.py`, replace lines 69-73:

```python
    "add_addition": {"snapshot": True, "truncate_param_fields": {"text": 4096}},
    "delete_addition": {"snapshot": True},
    "fold_additions": {"snapshot": True, "truncate_result_fields": {"folded_explanation": 8192}},
    "commit_fold": {"snapshot": True, "truncate_param_fields": {"explanation": 8192}},
    "unfold": {"snapshot": True, "truncate_result_fields": {"explanation": 8192}},
```

with:

```python
    "propose_amend": {"snapshot": False, "truncate_param_fields": {"text": 4096},
                      "truncate_result_fields": {"proposed": 8192}},
    "commit_amend": {"snapshot": True, "truncate_param_fields": {"explanation": 8192}},
    "unfold": {"snapshot": True, "truncate_result_fields": {"explanation": 8192, "source": 8192}},
```

`propose_amend` takes no snapshot: it does not mutate the notebook.

- [ ] **Step 3: Verify the module imports and routes are registered**

Run:
```bash
python3 -c "
import sys; sys.argv = ['plainbook', 'test.plnb']
from plainbook import main
from bottle import default_app
routes = sorted(r.rule for r in default_app().routes)
for r in ['/propose_amend', '/commit_amend', '/unfold']:
    assert r in routes, f'missing {r}'
for r in ['/add_addition', '/delete_addition', '/fold_additions', '/commit_fold']:
    assert r not in routes, f'{r} should be gone'
print('routes OK')
"
```
Expected: `routes OK`.

- [ ] **Step 4: Run the full suite**

Run: `python3 -m pytest tests/ -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plainbook/main.py plainbook/action_log.py
git commit -m "Replace the addition endpoints with propose_amend and commit_amend

propose_amend takes no action log snapshot: it does not mutate the notebook."
```

---

### Task 4: Client wiring

`nb.js` drives the sequence: propose → review → commit → generate → run. This is where "the only regeneration is through the normal pipeline" is realised — commit is followed by the same `generateCodeOneCell` + `runCells` the Generate button uses.

**Files:**
- Modify: `plainbook/js/nb.js:903-1043` (the whole amend block, from `const foldState = ref({});` down to the end of `ui_unfold`, ending just before the `// Missing-module installation state` comment at line 1044) and the `return {...}` block near line 1705
- Modify: `plainbook/js/NotebookCell.js` (props and emits)
- Modify: `plainbook/views/index.html` (props and handlers)

**Note:** `dismissClarify` (line 934) and `ui_submitClarification` (line 943) live *inside* that block. The Step 1 replacement below reproduces both — do not treat them as untouched.

**Interfaces:**
- Consumes: `/propose_amend`, `/commit_amend`, `/unfold` from Task 3; existing `apiCall`, `flushActiveEdits`, `waitForPendingSaves`, `generateCodeOneCell(cellIndex, force, validationFeedback)`, `runCells(cellIndex)`.
- Produces (for Task 5):
  - `foldState[cellIndex] = { status: 'review', original, proposed }`
  - Handlers `ui_amendAndFold(index, text)`, `ui_acceptAmend(index, editedText)`, `dismissFold(index)`, `ui_unfold(index)`
  - Cell events consumed: `amend-and-fold` (payload: text), `accept-amend` (payload: edited text), `dismiss-fold`, `unfold`, `submit-clarification` (payload: answers array), `dismiss-clarification`
  - Cell props passed: `:fold-state`, `:clarify-state`

- [ ] **Step 1: Replace the amend block in nb.js**

In `plainbook/js/nb.js`, replace lines 903-1043 — everything from the `// Folds awaiting review:` comment through the end of `ui_unfold`, ending just before `// Missing-module installation state, keyed by cell index:` — with the following. This deletes `addAddition`, `ui_appendAddition`, `deleteAddition`, `ui_openFold`, and `ui_commitFold`, and rewrites `dismissClarify` and `ui_submitClarification` in place:

```javascript
        // Folds awaiting review: foldState[index] = { status, original, proposed }.
        const foldState = ref({});

        const dismissFold = (cellIndex) => {
            const next = { ...foldState.value };
            delete next[cellIndex];
            foldState.value = next;
        };

        // Asks the AI to fold the instruction into the explanation and opens the
        // review. Nothing is stored until the user accepts.
        const ui_amendAndFold = async (cellIndex, text) => {
            if (!text || !text.trim() || running.value) return;
            const cell = notebook.value?.cells?.[cellIndex];
            flushActiveEdits();
            await waitForPendingSaves();
            running.value = true;
            runningActivity.value = { type: 'folding', cellIndex,
                cellName: cell?.metadata?.name || null };
            try {
                const r = await apiCall('/propose_amend', 'POST', {
                    cell_index: cellIndex, text: text.trim() });
                if (r.status !== 'success') throw new Error(r.message || 'Amend failed');
                const original = Array.isArray(cell.metadata.explanation)
                    ? cell.metadata.explanation.join('')
                    : (cell.metadata.explanation || '');
                foldState.value = { ...foldState.value,
                    [cellIndex]: { status: 'review', original, proposed: r.proposed } };
            } finally {
                running.value = false;
                runningActivity.value = { type: null, cellIndex: null };
            }
        };

        // Installs the reviewed explanation, then regenerates and runs through the
        // normal pipeline, so the stored code is code this explanation produced.
        const ui_acceptAmend = async (cellIndex, editedText) => {
            if (running.value) return;
            const r = await apiCall('/commit_amend', 'POST', {
                cell_index: cellIndex, explanation: editedText });
            if (r.status !== 'success') throw new Error(r.message || 'Commit failed');
            const cell = notebook.value?.cells?.[cellIndex];
            if (cell) {
                cell.metadata.explanation = editedText;
                // Marker so Unfold appears; the snapshot itself is server-side.
                cell.metadata.explanation_prefold = { committed: true };
            }
            dismissFold(cellIndex);
            asRead.value = false;
            running.value = true;
            try {
                await generateCodeOneCell(cellIndex, true, null);
                // Only run if it produced code, rather than questions.
                if (!clarifyState.value[cellIndex]) {
                    await runCells(cellIndex);
                }
            } finally {
                running.value = false;
                runningActivity.value = { type: null, cellIndex: null };
            }
        };

        // Restores the explanation and the code saved with it, then re-runs. The
        // pair already ran together, so this needs no AI call.
        const ui_unfold = async (cellIndex) => {
            if (running.value) return;
            const r = await apiCall('/unfold', 'POST', { cell_index: cellIndex });
            if (r.status !== 'success') return;
            const cell = notebook.value?.cells?.[cellIndex];
            if (cell) {
                cell.metadata.explanation = r.explanation;
                delete cell.metadata.explanation_prefold;
                if (r.source !== null) cell.source = r.source;
            }
            asRead.value = false;
            running.value = true;
            try {
                // A legacy snapshot carries no code, so it must be regenerated.
                if (r.source === null) await generateCodeOneCell(cellIndex, true, null);
                await runCells(cellIndex);
            } finally {
                running.value = false;
                runningActivity.value = { type: null, cellIndex: null };
            }
        };

        const dismissClarify = (cellIndex) => {
            if (!clarifyState.value[cellIndex]) return;
            const next = { ...clarifyState.value };
            delete next[cellIndex];
            clarifyState.value = next;
        };

        // Answers are folded into the explanation through the amend path, so they
        // persist and a later regeneration does not ask again.
        const ui_submitClarification = async (cellIndex, answers) => {
            if (running.value) return;
            const cs = clarifyState.value[cellIndex];
            if (!cs) return;
            const lines = cs.questions.map((q, i) => {
                const a = (answers[i] || '').trim();
                return a ? `Q: ${q}\nA: ${a}` : null;
            }).filter(Boolean);
            if (!lines.length) return;
            dismissClarify(cellIndex);
            await ui_amendAndFold(cellIndex, 'Clarifications:\n' + lines.join('\n'));
        };
```

- [ ] **Step 2: Update the returned bindings**

In `plainbook/js/nb.js`, in the `return { ... }` block, replace the line:

```javascript
            foldState, ui_appendAddition, deleteAddition, ui_openFold, ui_commitFold,
            dismissFold, ui_unfold,
```

with:

```javascript
            foldState, ui_amendAndFold, ui_acceptAmend, dismissFold, ui_unfold,
```

- [ ] **Step 3: Update NotebookCell.js**

In `plainbook/js/NotebookCell.js`, in `emits`, replace:

```javascript
        'append-addition', 'delete-addition', 'open-fold', 'commit-fold', 'dismiss-fold', 'unfold',
```

with:

```javascript
        'amend-and-fold', 'accept-amend', 'dismiss-fold', 'unfold',
```

In the template, remove the `:additions="cell.metadata.additions || []"` prop, and replace the forwarding handlers:

```javascript
                        @append-addition="(text) => $emit('append-addition', text)"
                        @delete-addition="(id) => $emit('delete-addition', id)"
                        @open-fold="$emit('open-fold')"
                        @commit-fold="(text) => $emit('commit-fold', text)"
                        @dismiss-fold="$emit('dismiss-fold')"
                        @unfold="$emit('unfold')"
```

with:

```javascript
                        @amend-and-fold="(text) => $emit('amend-and-fold', text)"
                        @accept-amend="(text) => $emit('accept-amend', text)"
                        @dismiss-fold="$emit('dismiss-fold')"
                        @unfold="$emit('unfold')"
```

- [ ] **Step 4: Update index.html**

In `plainbook/views/index.html`, replace:

```html
                        @append-addition="(text) => ui_appendAddition(index, text)"
                        @delete-addition="(id) => deleteAddition(index, id)"
                        @open-fold="ui_openFold(index)"
                        @commit-fold="(text) => ui_commitFold(index, text)"
                        @dismiss-fold="dismissFold(index)"
                        @unfold="ui_unfold(index)"
```

with:

```html
                        @amend-and-fold="(text) => ui_amendAndFold(index, text)"
                        @accept-amend="(text) => ui_acceptAmend(index, text)"
                        @dismiss-fold="dismissFold(index)"
                        @unfold="ui_unfold(index)"
```

- [ ] **Step 5: Syntax-check the modules**

Run:
```bash
S=/tmp/claude-1000/-mnt-e-projects-ucsc-plainbook/b247dccd-e62d-41ba-8943-164b0c2f82a3/scratchpad
for f in nb.js NotebookCell.js; do
  cp "plainbook/js/$f" "$S/${f%.js}.mjs" && node --check "$S/${f%.js}.mjs" && echo "OK: $f"
done
grep -c "ui_appendAddition\|deleteAddition\|addAddition\|ui_openFold\|ui_commitFold" plainbook/js/nb.js
```
Expected: `OK: nb.js`, `OK: NotebookCell.js`, and `0` — no stale references remain.

- [ ] **Step 6: Commit**

```bash
git add plainbook/js/nb.js plainbook/js/NotebookCell.js plainbook/views/index.html
git commit -m "Drive amend through propose, review, then the normal pipeline

Accepting an amendment commits the folded explanation and then regenerates and
runs through the same path as the Generate button, so regeneration happens once
and only after the fold. Clarification answers now take the same path instead of
being stored as an addition."
```

---

### Task 5: Amend panel UI

**Files:**
- Modify: `plainbook/js/ExplanationEditor.js` (props/emits ~4-10, setup ~159-200, return ~223-227, template ~238-310 and toolbar ~367-380)
- Modify: `plainbook/css/main.scss:131-170` (delete the dead `.additions-stack` rules)

**Interfaces:**
- Consumes: `foldState`, `clarifyState` props from Task 4.
- Produces: emits `amend-and-fold` (text), `accept-amend` (text), `dismiss-fold`, `unfold`.

- [ ] **Step 1: Update props and emits**

In `plainbook/js/ExplanationEditor.js`, in the `ExplanationRenderer` props, replace:

```javascript
            'unitTestCount', 'additions', 'foldState', 'hasPrefold', 'clarifyState'],
```

with:

```javascript
            'unitTestCount', 'foldState', 'hasPrefold', 'clarifyState'],
```

and in `emits`, replace:

```javascript
            'append-addition', 'delete-addition', 'open-fold', 'commit-fold', 'dismiss-fold', 'unfold',
```

with:

```javascript
            'amend-and-fold', 'accept-amend', 'dismiss-fold', 'unfold',
```

- [ ] **Step 2: Replace the setup block**

Replace the block from `// Only action cells get the append/fold workflow.` through `const autoResizeFold = ...` with:

```javascript
        // Only action cells get the amend workflow.
        const showFolding = computed(() => mode.value === 'normal');
        const foldReview = computed(() =>
            (props.foldState && props.foldState.status === 'review') ? props.foldState : null);

        const amendText = ref('');
        const foldEdit = ref('');
        const foldEl = ref(null);

        watch(foldReview, (fr) => {
            if (fr) {
                foldEdit.value = fr.proposed || '';
                nextTick(() => { if (foldEl.value) { foldEl.value.style.height = 'auto'; foldEl.value.style.height = `${foldEl.value.scrollHeight}px`; } });
            }
        });

        const submitAmend = () => {
            const t = amendText.value.trim();
            if (!t) return;
            emit('amend-and-fold', t);
            amendText.value = '';
        };
        const onUnfold = () => emit('unfold');
        const acceptFold = () => emit('accept-amend', foldEdit.value);
        const dismissFoldReview = () => emit('dismiss-fold');
        const autoResizeFold = (e) => {
            const el = e.target; el.style.height = 'auto'; el.style.height = `${el.scrollHeight}px`;
        };
```

- [ ] **Step 3: Update the returned bindings**

Replace:

```javascript
            showFolding, additionList, foldReview, appending, appendText, appendEl,
            foldEdit, foldEl, additionsCollapsed, startAppend, cancelAppend, submitAppend,
            removeAddition, onFold, onUnfold, acceptFold, dismissFoldReview, autoResizeFold,
```

with:

```javascript
            showFolding, foldReview, amendText, foldEdit, foldEl, submitAmend,
            onUnfold, acceptFold, dismissFoldReview, autoResizeFold,
```

- [ ] **Step 4: Replace the template blocks**

Replace the two blocks — the chips/fold-review block (`<!-- Appended guidance trail + fold review (action cells only) -->`) and the append input block (`<!-- Append input -->`) — with:

```html
        <!-- Amend field: always available on an active action cell with code -->
        <div v-if="showFolding && !isEditing && isActive && hasCode && !foldReview && !clarify" class="px-4 pb-2">
            <textarea v-model="amendText" class="textarea is-small mb-2" rows="2"
                placeholder="Amend this cell — e.g. also drop rows with null revenue."
                @keydown.enter.exact.prevent="submitAmend"></textarea>
            <div class="is-flex is-justify-content-flex-end" style="gap:0.5rem;">
                <button class="button is-small is-primary" :disabled="!amendText.trim() || running || localIsLocked" @click.stop="submitAmend">
                    <span class="icon"><i class="bx bx-merge"></i></span><span>Amend &amp; fold</span>
                </button>
            </div>
        </div>

        <!-- Fold review -->
        <div v-if="showFolding && !isEditing && foldReview" class="px-4 pb-2">
            <div class="fold-review p-3">
                <p class="is-size-7 has-text-weight-semibold mb-2">
                    <span class="icon is-small"><i class="bx bx-merge"></i></span>
                    Review the amended description — accepting regenerates the code from it.
                </p>
                <p class="is-size-7 has-text-grey mb-1">Current:</p>
                <div class="fold-original p-2 mb-2 is-size-7">{{ foldReview.original }}</div>
                <p class="is-size-7 has-text-grey mb-1">Amended (editable):</p>
                <textarea ref="foldEl" v-model="foldEdit" class="textarea is-small mb-2" rows="3" @input="autoResizeFold"></textarea>
                <div class="is-flex is-justify-content-flex-end" style="gap:0.5rem;">
                    <button class="button is-small" @click.stop="dismissFoldReview">Cancel</button>
                    <button class="button is-small is-info" :disabled="!foldEdit.trim()" @click.stop="acceptFold">
                        <span class="icon"><i class="bx bx-check"></i></span><span>Accept &amp; regenerate</span>
                    </button>
                </div>
            </div>
        </div>
```

- [ ] **Step 5: Replace the toolbar buttons**

Replace the three buttons added for Append/Fold/Unfold (`<button v-if="showFolding" ...>Append</button>` through the Unfold button) with just:

```html
                <button v-if="showFolding && hasPrefold" class="button is-small is-link is-light"
                        title="Undo the last amendment, restoring the description and code"
                        :disabled="running || localIsLocked" @click.stop="onUnfold">
                    <span class="icon"><i class="bx bx-expand"></i></span><span>Unfold</span>
                </button>
```

- [ ] **Step 6: Delete the dead SCSS**

In `plainbook/css/main.scss`, delete the `.additions-stack .addition-chip`, `.additions-stack .addition-chip .addition-text`, and `.additions-stack .addition-chip .addition-del` rules together with the `// Appended-guidance chips` comment. Keep `.fold-review` and `.fold-review .fold-original` — the review panel still uses them.

- [ ] **Step 7: Syntax-check and verify nothing stale remains**

Run:
```bash
S=/tmp/claude-1000/-mnt-e-projects-ucsc-plainbook/b247dccd-e62d-41ba-8943-164b0c2f82a3/scratchpad
cp plainbook/js/ExplanationEditor.js "$S/ExplanationEditor.mjs" && node --check "$S/ExplanationEditor.mjs" && echo "OK"
grep -rc "additionList\|addition-chip\|startAppend\|submitAppend\|removeAddition\|additionsCollapsed\|onFold" plainbook/js/ plainbook/css/main.scss
```
Expected: `OK`, and `0` for every file.

- [ ] **Step 8: Commit**

```bash
git add plainbook/js/ExplanationEditor.js plainbook/css/main.scss
git commit -m "Put amend in the cell and fold into its button

An active action cell with code always shows the amend field, so amendments
chain without hunting for a button. The separate Append and Fold buttons are
gone: folding is what the amend button does. The guidance chips go with them —
an amendment is folded immediately, so additions never accumulate."
```

---

### Task 6: Rebuild CSS and verify end to end

**Files:**
- Modify: `plainbook/css/main.css`, `plainbook/css/main.css.map` (generated)

- [ ] **Step 1: Try to rebuild the CSS**

Run: `cd plainbook/css && npm run build; cd ../..`

Expected: this **fails in this environment** with `sh: 1: sass: Permission denied`. If it fails, do not hand-edit `main.css` — leave it. The only SCSS change is a deletion of three rules, so the stale `main.css` carries dead rules that match no markup. Report this to the user as a follow-up needing a working `sass`, and do not stage `main.css`.

If it succeeds, verify the chip rules are gone and the review rules remain:
```bash
grep -c "addition-chip" plainbook/css/main.css   # expect 0
grep -c "fold-review" plainbook/css/main.css     # expect 1 or more
```
Then `git add plainbook/css/main.css plainbook/css/main.css.map` and commit with: `Rebuild CSS without the addition chip rules`.

- [ ] **Step 2: Run the full suite**

Run: `python3 -m pytest tests/ -q`
Expected: PASS.

- [ ] **Step 3: Drive the real app**

REQUIRED SUB-SKILL: use the `verify` skill.

Start the server: `python3 -m plainbook.main test.plnb --debug` (background). It prints nothing until it flushes; read the token from `~/.config/plainbook/settings.yaml` (`debug_token.token`) and open `http://127.0.0.1:<port>/?token=<token>`. The port is 8080 or the next free even port.

An AI provider key must be configured for propose_amend to work. If none is available, say so rather than claiming the flow was verified.

Confirm, on the action cell:
1. The active cell shows the amend field with **Amend & fold**, and shows no Append/Fold buttons or guidance chips.
2. Typing an instruction and pressing **Amend & fold** opens the review with the current explanation and an editable amended one.
3. **Cancel** leaves the explanation unchanged and stores nothing.
4. **Accept & regenerate** installs the explanation, regenerates, and runs — and the resulting code reflects the amendment.
5. The amend field is empty and ready afterwards, so a second amendment chains.
6. **Unfold** restores the previous explanation and code and re-runs, with no AI call.

- [ ] **Step 4: Report**

Report what was verified and what was not. If step 3 could not run for lack of an API key, say that plainly rather than implying the flow was exercised.

---

## Notes for the implementer

- **The load-bearing test** is `TestCommitAmend::test_marks_code_stale_so_the_pipeline_regenerates`. The suite being replaced asserted the exact opposite (`assert notebook.last_valid_code_cell == idx`, with the comment "a fold ... must NOT invalidate the code"). That assertion encoded the bug. If you find yourself softening the new test, re-read the spec first.
- `tostring` and `_invalidate_execution` already exist in `plainbook.py`; do not redefine them.
- Do not add an `additions` key back anywhere. If a task seems to need one, the design is being misread.
