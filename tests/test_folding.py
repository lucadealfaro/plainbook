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


class TestAdditions:

    def test_add_addition_appends_and_marks_code_stale(self, notebook):
        idx = _add_action_cell(notebook, "Plot revenue.")
        notebook.last_valid_code_cell = idx
        notebook.last_valid_output_cell = idx
        add = notebook.add_cell_addition(idx, "Color the bars blue.")
        assert add['text'] == "Color the bars blue."
        assert 'id' in add and 'created' in add
        cell = notebook.nb.cells[idx]
        assert cell.metadata['additions'][0]['text'] == "Color the bars blue."
        # Adding guidance makes the current code stale.
        assert notebook.last_valid_code_cell == idx - 1
        assert notebook.last_valid_output_cell == idx - 1

    def test_explanation_with_additions_composition(self, notebook):
        idx = _add_action_cell(notebook, "Plot revenue.")
        notebook.add_cell_addition(idx, "Color the bars blue.")
        notebook.add_cell_addition(idx, "Drop null rows first.")
        combined = notebook._explanation_with_additions(notebook.nb.cells[idx])
        assert "Plot revenue." in combined
        assert "ADDITIONAL GUIDANCE" in combined
        assert "- Color the bars blue." in combined
        assert "- Drop null rows first." in combined
        # Base must come before the guidance section.
        assert combined.index("Plot revenue.") < combined.index("ADDITIONAL GUIDANCE")

    def test_explanation_with_additions_empty_is_base(self, notebook):
        idx = _add_action_cell(notebook, "Plot revenue.")
        assert notebook._explanation_with_additions(notebook.nb.cells[idx]) == "Plot revenue."

    def test_delete_addition_removes_by_id(self, notebook):
        idx = _add_action_cell(notebook, "Plot revenue.")
        a1 = notebook.add_cell_addition(idx, "one")
        a2 = notebook.add_cell_addition(idx, "two")
        notebook.delete_cell_addition(idx, a1['id'])
        ids = [a['id'] for a in notebook.nb.cells[idx].metadata['additions']]
        assert a1['id'] not in ids
        assert a2['id'] in ids


class TestFold:

    def test_commit_fold_replaces_base_and_snapshots(self, notebook):
        idx = _add_action_cell(notebook, "Plot revenue.")
        notebook.add_cell_addition(idx, "Color the bars blue.")
        notebook.last_valid_code_cell = idx
        notebook.last_valid_output_cell = idx
        notebook.commit_fold(idx, "Plot revenue as a blue bar chart.")
        cell = notebook.nb.cells[idx]
        assert cell.metadata['explanation'] == "Plot revenue as a blue bar chart."
        assert cell.metadata['additions'] == []
        snap = cell.metadata['explanation_prefold']
        assert snap['explanation'] == "Plot revenue."
        assert snap['additions'][0]['text'] == "Color the bars blue."
        # A fold is a readability rewrite; it must NOT invalidate the code.
        assert notebook.last_valid_code_cell == idx
        assert notebook.last_valid_output_cell == idx

    def test_unfold_restores_prefold_state(self, notebook):
        idx = _add_action_cell(notebook, "Plot revenue.")
        notebook.add_cell_addition(idx, "Color the bars blue.")
        notebook.commit_fold(idx, "Folded text.")
        result = notebook.unfold(idx)
        cell = notebook.nb.cells[idx]
        assert cell.metadata['explanation'] == "Plot revenue."
        assert cell.metadata['additions'][0]['text'] == "Color the bars blue."
        assert 'explanation_prefold' not in cell.metadata
        assert result['explanation'] == "Plot revenue."

    def test_unfold_without_snapshot_returns_none(self, notebook):
        idx = _add_action_cell(notebook, "Plot revenue.")
        assert notebook.unfold(idx) is None

    def test_fold_additions_invokes_provider_with_base_and_additions(self, notebook, monkeypatch):
        idx = _add_action_cell(notebook, "Plot revenue.")
        notebook.add_cell_addition(idx, "Color the bars blue.")
        notebook.add_cell_addition(idx, "Drop null rows first.")
        captured = {}

        def fake_fold(api_key, explanation=None, additions=None, model=None,
                      debug=False, dump_ai_requests=False):
            captured['explanation'] = explanation
            captured['additions'] = additions
            return "FOLDED RESULT"

        monkeypatch.setitem(pb.AI_PROVIDERS['gemini'], 'fold', fake_fold)
        result = notebook.fold_additions("key", idx, ai_provider='gemini')
        assert result == "FOLDED RESULT"
        assert captured['explanation'] == "Plot revenue."
        assert captured['additions'] == ["Color the bars blue.", "Drop null rows first."]
        # fold_additions is non-committal: cell is unchanged.
        cell = notebook.nb.cells[idx]
        assert cell.metadata['explanation'] == "Plot revenue."
        assert len(cell.metadata['additions']) == 2

    def test_fold_additions_no_additions_returns_base_without_ai(self, notebook, monkeypatch):
        idx = _add_action_cell(notebook, "Plot revenue.")

        def boom(*a, **k):
            raise AssertionError("AI should not be called when there are no additions")

        monkeypatch.setitem(pb.AI_PROVIDERS['gemini'], 'fold', boom)
        assert notebook.fold_additions("key", idx, ai_provider='gemini') == "Plot revenue."
