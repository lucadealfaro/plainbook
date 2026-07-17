# Amend & fold

## Problem

An action cell's code is generated from `explanation` plus the accumulated
`additions`. Folding then asks the AI to rewrite those into a single
explanation, and `commit_fold` installs the rewrite while deliberately leaving
the code valid.

That last part is the defect. The rewrite is never verified: the code on screen
was produced by `explanation + additions`, not by the folded text now stored
next to it. The two are only assumed to be equivalent. Regenerating later — or
re-running the notebook from scratch — can produce different code and different
results, with nothing in the cell indicating why. Appending gets the right
answer; folding can silently take it away.

The cell should never hold code that its own explanation did not produce.

## Invariant

> A cell has exactly one explanation, and code that a real generation from that
> explanation actually produced.

Every operation either preserves the invariant or marks the code stale so the
pipeline restores it. Nothing assumes an unverified equivalence.

## Design

### Flow

Typing an instruction and pressing **Amend & fold** folds it into the
explanation, shows the result for review, and — on accept — regenerates through
the normal pipeline:

```
type "make the axes log scale"
  → propose_amend: fold(explanation, text) → proposed text   (no mutation)
  → review / edit the proposed text
  → accept
      → commit_amend: snapshot {explanation, source}
                      explanation := proposed
                      mark code stale
      → generate → run                                        (normal pipeline)
```

Cancelling the review persists nothing.

The fold is what makes the amendment reproducible: the explanation is rewritten
first, and the code is then generated *from that rewrite*, so the stored pair is
one that actually ran together.

### Regeneration

`commit_amend` marks the code stale; it does not generate. The client then
drives the same `generateCodeOneCell` + `runCells` path as the Generate button.
Regeneration happens once, after the fold, through one code path that already
owns cancellation, progress, and the clarify handling.

This inverts `commit_fold`, which deliberately did *not* invalidate. That
inversion is the fix.

### Data model

- `cell.metadata.additions` — **removed**. `_explanation_with_additions` is
  removed with it; generation reads `explanation` directly.
- `cell.metadata.explanation_prefold` — `{explanation, additions}` becomes
  `{explanation, source}`.

### Server (`plainbook.py`)

| Method | Behavior |
| --- | --- |
| `propose_amend(api_key, index, text, ai_provider, model)` | Returns `fold(explanation, [text])`. Does not mutate the cell. |
| `commit_amend(index, folded)` | Snapshots `{explanation, source}` into `explanation_prefold`; sets `explanation`; marks the code stale via `_mark_code_stale`. |
| `unfold(index)` | Restores `explanation` and `source` from the snapshot, deletes it, returns both. |

`add_cell_addition` and `delete_cell_addition` are removed.

`unfold` mirrors the pointer handling `set_cell_source` already uses for an
edited cell — the restored code is valid where it sits, only its output is
stale:

```
last_valid_code_cell   = min(last_valid_code_cell, index)      # valid here
last_valid_output_cell = min(last_valid_output_cell, index - 1)
last_valid_test_cell   = min(last_valid_test_cell, index - 1)
```

The client then re-runs. Unfold spends no AI call and cannot drift: it restores
a pair that already ran together.

### Endpoints (`main.py`)

`/add_addition`, `/delete_addition`, `/fold_additions`, `/commit_fold` are
replaced by `/propose_amend` and `/commit_amend`. `/unfold` is unchanged.
`OP_LOG_CONFIG` in `action_log.py` follows.

### Client

`ExplanationEditor.js` drops the addition chips and the Append and Fold toolbar
buttons. An active action cell that has code always shows the amend field with
**Amend & fold** beside it; after an accepted amend the field clears and stays
open, so amendments chain. The review panel (reusing `.fold-review`) shows the
current explanation against the editable proposal, with Cancel and Accept.
**Unfold** stays in the toolbar.

`nb.js` replaces `ui_appendAddition` / `addAddition` / `deleteAddition` /
`ui_openFold` / `ui_commitFold` with:

- `ui_amendAndFold(index, text)` — propose, then open the review.
- `ui_acceptAmend(index, editedText)` — commit, then generate, then run.
- `ui_unfold(index)` — unfold, then run. No AI.

Clarify answers are formatted into a Q&A string and pushed through the identical
propose → review → accept path, so they persist in the explanation and a later
regeneration does not ask again. There is one amend path, not two.

### Legacy notebooks

Notebooks written by the previous version (including `test.plnb`) carry the old
shape. Neither case may leave a cell violating the invariant:

- **`explanation_prefold` without `source`** — a true undo is impossible. Unfold
  restores the explanation and marks the code stale, so the pipeline regenerates
  rather than leaving a mismatched pair.
- **Non-empty `additions` on load** — appended onto the explanation so the
  guidance is not silently dropped, then cleared.

## Testing

`tests/test_folding.py` is rewritten:

- `propose_amend` passes the explanation and the typed text to the provider,
  returns its output, and leaves the cell untouched.
- `commit_amend` snapshots `{explanation, source}`, installs the folded text,
  and **marks the code stale** — the regression test for this bug, and the exact
  assertion the old suite had backwards.
- `unfold` restores explanation and source, calls no provider, and marks only
  the output stale.
- `unfold` returns `None` with no snapshot.
- A legacy snapshot lacking `source` restores the text and marks the code stale.
- Loading a notebook with leftover `additions` folds them onto the explanation.

## Out of scope

Multi-level undo (`explanation_prefold` stays single-level, as today), and
amend for test cells (action cells only, matching the current `showFolding`).
