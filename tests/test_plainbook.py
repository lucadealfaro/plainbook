import pytest
from plainbook.plainbook import CellExecutionError, ExecutionError, Plainbook


@pytest.fixture
def notebook(tmp_notebook_path):
    """Creates a Plainbook instance and shuts it down after the test."""
    nb = Plainbook(tmp_notebook_path)
    yield nb
    nb._shutdown()


def _add_code_cell(notebook, source, index=None):
    """Insert a code cell with source and mark it valid for execution."""
    if index is None:
        index = len(notebook.nb.cells)
    cell, idx = notebook.insert_cell(index, 'code')
    notebook.set_cell_source(idx, source)
    notebook.last_valid_code_cell = max(notebook.last_valid_code_cell, idx)
    return idx


def _add_markdown_cell(notebook, source, index=None):
    """Insert a markdown cell with source."""
    if index is None:
        index = len(notebook.nb.cells)
    cell, idx = notebook.insert_cell(index, 'markdown')
    notebook.set_cell_source(idx, source)
    return idx


def _add_test_cell(notebook, source, index=None):
    """Insert a test cell with source."""
    if index is None:
        index = len(notebook.nb.cells)
    cell, idx = notebook.insert_cell(index, 'test')
    notebook.set_cell_source(idx, source)
    return idx


# === Notebook lifecycle ===


class TestNotebookLifecycle:

    def test_create_empty_notebook(self, notebook):
        """Creating from non-existent path yields an empty notebook."""
        assert len(notebook.nb.cells) == 0
        assert notebook.last_executed_cell == -1

    def test_get_state(self, notebook):
        """get_state returns all expected keys."""
        state = notebook.get_state()
        expected_keys = {
            'name', 'path', 'num_cells',
            'last_executed_cell', 'last_valid_code_cell',
            'last_valid_output_cell', 'last_valid_test_cell', 'is_locked',
            'share_output_with_ai', 'ai_tokens',
        }
        assert set(state.keys()) == expected_keys
        assert state['num_cells'] == 0
        assert state['last_executed_cell'] == -1
        assert state['is_locked'] is False

    def test_get_json(self, notebook):
        """get_json returns the notebook object."""
        nb_json = notebook.get_json()
        assert hasattr(nb_json, 'cells')
        assert len(nb_json.cells) == 0

    def test_get_cell_json(self, notebook):
        """get_cell_json returns cell by index."""
        _add_code_cell(notebook, 'x = 1')
        cell = notebook.get_cell_json(0)
        assert cell.cell_type == 'code'
        assert cell.source == 'x = 1'

    def test_get_cell_json_out_of_range(self, notebook):
        """get_cell_json raises IndexError for invalid index."""
        with pytest.raises(IndexError):
            notebook.get_cell_json(0)


# === Cell manipulation ===


class TestCellManipulation:

    def test_insert_code_cell(self, notebook):
        cell, idx = notebook.insert_cell(0, 'code')
        assert idx == 0
        assert cell.cell_type == 'code'
        assert len(notebook.nb.cells) == 1

    def test_insert_markdown_cell(self, notebook):
        cell, idx = notebook.insert_cell(0, 'markdown')
        assert idx == 0
        assert cell.cell_type == 'markdown'
        assert len(notebook.nb.cells) == 1

    def test_delete_code_cell(self, notebook):
        _add_code_cell(notebook, 'x = 1')
        assert len(notebook.nb.cells) == 1
        notebook.delete_cell(0)
        assert len(notebook.nb.cells) == 0

    def test_delete_markdown_cell(self, notebook):
        _add_markdown_cell(notebook, '# Title')
        assert len(notebook.nb.cells) == 1
        notebook.delete_cell(0)
        assert len(notebook.nb.cells) == 0

    def test_delete_out_of_range(self, notebook):
        with pytest.raises(IndexError):
            notebook.delete_cell(0)

    def test_move_cell(self, notebook):
        _add_code_cell(notebook, 'a = 1')
        _add_code_cell(notebook, 'b = 2')
        assert notebook.nb.cells[0].source == 'a = 1'
        assert notebook.nb.cells[1].source == 'b = 2'
        notebook.move_cell(0, 1)
        assert notebook.nb.cells[0].source == 'b = 2'
        assert notebook.nb.cells[1].source == 'a = 1'

    def test_set_cell_source_code(self, notebook):
        _add_code_cell(notebook, 'x = 1')
        notebook.set_cell_source(0, 'x = 2')
        assert notebook.nb.cells[0].source == 'x = 2'

    def test_set_cell_source_markdown(self, notebook):
        _add_markdown_cell(notebook, '# Title')
        notebook.set_cell_source(0, '# New Title')
        assert notebook.nb.cells[0].source == '# New Title'

    def test_set_cell_explanation(self, notebook):
        _add_code_cell(notebook, 'x = 1')
        notebook.set_cell_explanation(0, 'Set x to 1')
        assert notebook.nb.cells[0].metadata['explanation'] == 'Set x to 1'

    def test_lock_unlock(self, notebook):
        assert notebook.get_state()['is_locked'] is False
        notebook.lock(True)
        assert notebook.get_state()['is_locked'] is True
        notebook.lock(False)
        assert notebook.get_state()['is_locked'] is False


# === Execution ===


class TestExecution:

    def test_execute_simple_cell(self, notebook):
        """Execute x = 1; print(x) and verify stdout output."""
        idx = _add_code_cell(notebook, 'x = 1\nprint(x)')
        outputs, status = notebook.execute_cell(idx)
        assert status == 'ok'
        assert len(outputs) > 0
        text = ''.join(
            o.get('text', '') for o in outputs if o.get('output_type') == 'stream'
        )
        assert '1' in text

    def test_execute_multiple_cells(self, notebook):
        """Execute two cells; the second uses the first's variable."""
        _add_code_cell(notebook, 'x = 42')
        _add_code_cell(notebook, 'print(x + 1)')
        notebook.execute_cell(0)
        outputs, status = notebook.execute_cell(1)
        assert status == 'ok'
        text = ''.join(
            o.get('text', '') for o in outputs if o.get('output_type') == 'stream'
        )
        assert '43' in text

    def test_execute_error_cell(self, notebook):
        """Executing a cell with a runtime error raises CellExecutionError."""
        idx = _add_code_cell(notebook, '1/0')
        with pytest.raises(CellExecutionError):
            notebook.execute_cell(idx)

    def test_execute_error_does_not_advance(self, notebook):
        """Executing a cell with error doesn't advance last_executed_cell."""
        _add_code_cell(notebook, 'x = 1')
        _add_code_cell(notebook, '1/0')
        notebook.execute_cell(0)
        assert notebook.last_executed_cell == 0
        with pytest.raises(CellExecutionError):
            notebook.execute_cell(1)
        assert notebook.last_executed_cell == 0

    def test_cached_execution(self, notebook):
        """Re-executing an already-executed cell returns Cached."""
        idx = _add_code_cell(notebook, 'x = 1')
        notebook.execute_cell(idx)
        outputs, status = notebook.execute_cell(idx)
        assert status == 'Cached'

    def test_out_of_order_execution(self, notebook):
        """Skipping an unexecuted code cell raises ExecutionError."""
        _add_code_cell(notebook, 'x = 1')
        _add_code_cell(notebook, 'y = 2')
        _add_code_cell(notebook, 'z = 3')
        notebook.execute_cell(0)
        with pytest.raises(ExecutionError, match="out of order"):
            notebook.execute_cell(2)

    def test_edit_executed_cell_invalidates(self, notebook):
        """Editing an executed cell's source triggers invalidation."""
        idx = _add_code_cell(notebook, 'x = 1')
        notebook.execute_cell(idx)
        assert notebook.last_executed_cell == 0
        notebook.set_cell_source(0, 'x = 2')
        # Snapshot kernel: _invalidate_from(0) sets last_executed_cell = min(0, -1) = -1
        assert notebook.last_executed_cell == -1

    def test_insert_code_before_executed_invalidates(self, notebook):
        """Inserting a code cell before executed cells triggers invalidation."""
        _add_code_cell(notebook, 'x = 1')
        notebook.execute_cell(0)
        assert notebook.last_executed_cell == 0
        notebook.insert_cell(0, 'code')
        assert notebook.last_executed_cell == -1

    def test_delete_executed_code_cell_invalidates(self, notebook):
        """Deleting an executed code cell triggers invalidation."""
        _add_code_cell(notebook, 'x = 1')
        _add_code_cell(notebook, 'y = 2')
        notebook.execute_cell(0)
        notebook.execute_cell(1)
        assert notebook.last_executed_cell == 1
        notebook.delete_cell(0)
        assert notebook.last_executed_cell == -1

    def test_execute_markdown_cell(self, notebook):
        """Executing a markdown cell returns 'Not a code cell'."""
        _add_markdown_cell(notebook, '# Hello')
        _add_code_cell(notebook, 'x = 1')  # makes last_valid_code_cell >= 0
        outputs, status = notebook.execute_cell(0)
        assert outputs is None
        assert status == 'Not a code cell'

    def test_execute_not_valid_cell(self, notebook):
        """Executing a cell beyond last_valid_code_cell raises ExecutionError."""
        notebook.insert_cell(0, 'code')
        with pytest.raises(ExecutionError, match="not valid"):
            notebook.execute_cell(0)


class TestTestExecution:

    def test_execute_test_cell_simple(self, notebook):
        """Execute a test cell that asserts a simple condition."""
        _add_code_cell(notebook, 'x = 1')
        notebook.execute_cell(0)
        idx = _add_test_cell(notebook, 'assert 1 == 1')
        outputs = notebook.execute_test_cell(idx)
        assert not any(o.get('output_type') == 'error' for o in outputs)

    def test_execute_test_cell_failure(self, notebook):
        """Execute a test cell that fails its assertion."""
        _add_code_cell(notebook, 'x = 1')
        notebook.execute_cell(0)
        idx = _add_test_cell(notebook, 'assert 1 == 2')
        with pytest.raises(CellExecutionError) as excinfo:
            notebook.execute_test_cell(idx)
        assert 'AssertionError' in str(excinfo.value)
        # Check that outputs contains the error
        cell = notebook.nb.cells[idx]
        assert any(o.get('output_type') == 'error' for o in cell.outputs)

    def test_execute_test_cell_state_access(self, notebook):
        """Execute a test cell that accesses state from a named code cell."""
        idx_c = _add_code_cell(notebook, 'x = 42')
        notebook.nb.cells[idx_c].metadata['name'] = 'my_cell'
        notebook.execute_cell(idx_c)

        idx_t = _add_test_cell(notebook, 'assert __state__my_cell.x == 42')
        outputs = notebook.execute_test_cell(idx_t)
        assert not any(o.get('output_type') == 'error' for o in outputs)

    def test_execute_test_cell_multiple_states(self, notebook):
        """Execute a test cell that accesses state from multiple named code cells."""
        idx0 = _add_code_cell(notebook, 'a = 10')
        notebook.nb.cells[idx0].metadata['name'] = 'cell0'
        notebook.execute_cell(idx0)

        idx1 = _add_code_cell(notebook, 'b = 20')
        notebook.nb.cells[idx1].metadata['name'] = 'cell1'
        notebook.execute_cell(idx1)

        idx_t = _add_test_cell(notebook, 'assert __state__cell0.a + __state__cell1.b == 30')
        outputs = notebook.execute_test_cell(idx_t)
        assert not any(o.get('output_type') == 'error' for o in outputs)

    def test_execute_test_cell_invalid_state_access(self, notebook):
        """Assertion fails when accessing state that doesn't exist or is wrong."""
        idx_c = _add_code_cell(notebook, 'x = 42')
        notebook.nb.cells[idx_c].metadata['name'] = 'my_cell'
        notebook.execute_cell(idx_c)

        idx_t = _add_test_cell(notebook, 'assert __state__my_cell.x == 100')
        with pytest.raises(CellExecutionError):
            notebook.execute_test_cell(idx_t)


# === Kernel operations ===


class TestKernelOps:

    def test_reset_kernel(self, notebook):
        idx = _add_code_cell(notebook, 'x = 1')
        notebook.execute_cell(idx)
        assert notebook.last_executed_cell == 0
        notebook.reset_kernel()
        assert notebook.last_executed_cell == -1

    def test_interrupt_kernel(self, notebook):
        """interrupt_kernel should not crash."""
        notebook.interrupt_kernel()


# === Metadata ===


class TestMetadata:

    def test_set_get_input_files(self, notebook):
        files = [{'name': 'data.csv', 'path': '/tmp/data.csv'}]
        missing = [{'name': 'gone.csv', 'path': '/tmp/gone.csv'}]
        notebook.set_input_files(files, missing)
        result = notebook.get_input_files()
        assert result['input_files'] == files
        assert result['missing_input_files'] == missing

    def test_set_validation_visibility(self, notebook):
        _add_code_cell(notebook, 'x = 1')
        notebook.set_validation_visibility(0, True)
        assert notebook.nb.cells[0].metadata['validation']['is_hidden'] is True
        notebook.set_validation_visibility(0, False)
        assert notebook.nb.cells[0].metadata['validation']['is_hidden'] is False


# === Snapshot-kernel-specific tests ===


class TestSnapshotKernelSpecific:

    def test_is_alive(self, notebook):
        """Snapshot kernel subprocess is running after init."""
        assert notebook.is_alive() is True

    def test_kc_compat(self, notebook):
        """kc property returns self for compatibility."""
        assert notebook.kc is not None
        assert notebook.kc is notebook

    def test_km_compat(self, notebook):
        """km property returns self with is_alive() for compatibility."""
        assert notebook.km is not None
        assert notebook.km.is_alive() is True

    def test_selective_invalidation(self, notebook):
        """Editing cell 1's source preserves cell 0's snapshot, clears 1-2."""
        _add_code_cell(notebook, 'x = 1')
        _add_code_cell(notebook, 'y = x + 1')
        _add_code_cell(notebook, 'z = y + 1')

        notebook.execute_cell(0)
        notebook.execute_cell(1)
        notebook.execute_cell(2)

        state_0 = notebook._cell_states.get(notebook.nb.cells[0].id)
        assert state_0 is not None
        assert notebook._cell_states.get(notebook.nb.cells[1].id) is not None
        assert notebook._cell_states.get(notebook.nb.cells[2].id) is not None

        # Edit cell 1 -> invalidates cells 1-2, preserves cell 0
        notebook.set_cell_source(1, 'y = x + 10')
        notebook.last_valid_code_cell = max(notebook.last_valid_code_cell, 1)

        # Cell 0's state is preserved
        assert notebook._cell_states.get(notebook.nb.cells[0].id) == state_0
        # Cells 1-2 keep their dict entries (for name reuse), but
        # last_executed_cell == 0 means they are not valid in the kernel
        assert notebook.last_executed_cell == 0

    def test_reexecute_from_snapshot(self, notebook):
        """After invalidation, re-execute cell 1 from cell 0's preserved snapshot."""
        _add_code_cell(notebook, 'x = 1')
        _add_code_cell(notebook, 'y = x + 1\nprint(y)')

        notebook.execute_cell(0)
        notebook.execute_cell(1)

        # Edit cell 1, invalidating it but preserving cell 0's state
        notebook.set_cell_source(1, 'y = x + 10\nprint(y)')
        notebook.last_valid_code_cell = max(notebook.last_valid_code_cell, 1)

        # Re-execute from cell 0's snapshot
        outputs, status = notebook.execute_cell(1)
        assert status == 'ok'
        text = ''.join(
            o.get('text', '') for o in outputs if o.get('output_type') == 'stream'
        )
        assert '11' in text

    def test_snapshot_state_stored_after_execution(self, notebook):
        """Each executed code cell stores its state name in _cell_states."""
        _add_code_cell(notebook, 'x = 1')
        assert notebook._cell_states.get(notebook.nb.cells[0].id) is None
        notebook.execute_cell(0)
        assert notebook._cell_states.get(notebook.nb.cells[0].id) is not None

    def test_reset_clears_all_snapshot_states(self, notebook):
        """reset_kernel clears _cell_states dictionary."""
        _add_code_cell(notebook, 'x = 1')
        _add_code_cell(notebook, 'y = 2')
        notebook.execute_cell(0)
        notebook.execute_cell(1)
        assert notebook._cell_states.get(notebook.nb.cells[0].id) is not None

        notebook.reset_kernel()

        assert len(notebook._cell_states) == 0
        assert notebook.last_executed_cell == -1


# === Unit test validity propagation ===


def _all_valid():
    """Return a validity dict with all flags True."""
    return {
        'setup_code_valid': True,
        'setup_output_valid': True,
        'target_output_valid': True,
        'test_code_valid': True,
        'test_output_valid': True,
    }


def _attach_unit_test(notebook, cell_index, test_name='test1'):
    """Attach a unit test with all-valid flags to a cell."""
    cell = notebook.nb.cells[cell_index]
    if 'unit_tests' not in cell.metadata:
        cell.metadata['unit_tests'] = {}
    cell.metadata['unit_tests'][test_name] = {
        'validity': _all_valid(),
        'cells': {
            'setup': {'cell_type': 'code', 'source': '', 'metadata': {}},
            'test': {'cell_type': 'code', 'source': '', 'metadata': {}},
        },
    }


def _is_all_valid(notebook, cell_index, test_name='test1'):
    """Check if all validity flags are True for a unit test."""
    v = notebook.nb.cells[cell_index].metadata['unit_tests'][test_name]['validity']
    return all(v.values())


def _is_invalid_from(notebook, cell_index, from_point, test_name='test1'):
    """Check that flags from from_point onward are False, earlier ones are True."""
    cascade = ['setup_code', 'setup_output', 'target_output', 'test_code', 'test_output']
    v = notebook.nb.cells[cell_index].metadata['unit_tests'][test_name]['validity']
    start = cascade.index(from_point)
    for i, point in enumerate(cascade):
        if i < start:
            if not v[point + '_valid']:
                return False
        else:
            if v[point + '_valid']:
                return False
    return True


class TestUnitTestInvalidationPropagation:
    """Tests that upstream changes properly invalidate downstream unit tests."""

    def test_set_explanation_upstream_invalidates_downstream_ut(self, notebook):
        """Changing cell A's explanation invalidates unit tests on cell C."""
        _add_code_cell(notebook, 'x = 1')  # cell 0 (A)
        _add_code_cell(notebook, 'y = x + 1')  # cell 1 (B)
        _add_code_cell(notebook, 'z = y + 1')  # cell 2 (C)
        _attach_unit_test(notebook, 2)
        assert _is_all_valid(notebook, 2)

        notebook.set_cell_explanation(0, 'Set x to 10')

        assert _is_invalid_from(notebook, 2, 'setup_code')

    def test_set_explanation_own_cell_invalidates_own_ut(self, notebook):
        """Changing cell C's own explanation invalidates its unit tests."""
        _add_code_cell(notebook, 'x = 1')  # cell 0
        _add_code_cell(notebook, 'y = x + 1')  # cell 1
        _attach_unit_test(notebook, 1)
        assert _is_all_valid(notebook, 1)

        notebook.set_cell_explanation(1, 'Changed explanation')

        assert _is_invalid_from(notebook, 1, 'setup_code')

    def test_set_explanation_does_not_invalidate_upstream_ut(self, notebook):
        """Changing cell B's explanation does NOT invalidate unit tests on cell A."""
        _add_code_cell(notebook, 'x = 1')  # cell 0 (A)
        _add_code_cell(notebook, 'y = x + 1')  # cell 1 (B)
        _attach_unit_test(notebook, 0)
        assert _is_all_valid(notebook, 0)

        notebook.set_cell_explanation(1, 'Changed explanation')

        assert _is_all_valid(notebook, 0)

    def test_set_source_invalidates_via_invalidate_from(self, notebook):
        """Editing cell B's code invalidates unit tests on cell C from setup_code."""
        _add_code_cell(notebook, 'x = 1')  # cell 0
        _add_code_cell(notebook, 'y = x + 1')  # cell 1
        _add_code_cell(notebook, 'z = y + 1')  # cell 2
        notebook.execute_cell(0)
        notebook.execute_cell(1)
        notebook.execute_cell(2)
        _attach_unit_test(notebook, 2)
        assert _is_all_valid(notebook, 2)

        notebook.set_cell_source(1, 'y = x + 10')

        # _invalidate_from(1) should invalidate from setup_code
        assert _is_invalid_from(notebook, 2, 'setup_code')

    def test_invalidate_from_uses_setup_code_not_setup_output(self, notebook):
        """_invalidate_from invalidates from setup_code, not setup_output."""
        _add_code_cell(notebook, 'x = 1')  # cell 0
        _add_code_cell(notebook, 'y = x + 1')  # cell 1
        notebook.execute_cell(0)
        notebook.execute_cell(1)
        _attach_unit_test(notebook, 1)
        assert _is_all_valid(notebook, 1)

        notebook.set_cell_source(0, 'x = 10')

        assert _is_invalid_from(notebook, 1, 'setup_code')

    def test_set_explanation_invalidates_multiple_downstream(self, notebook):
        """Changing cell A's explanation invalidates unit tests on both B and C."""
        _add_code_cell(notebook, 'x = 1')  # cell 0
        _add_code_cell(notebook, 'y = x + 1')  # cell 1
        _add_code_cell(notebook, 'z = y + 1')  # cell 2
        _attach_unit_test(notebook, 1)
        _attach_unit_test(notebook, 2)
        assert _is_all_valid(notebook, 1)
        assert _is_all_valid(notebook, 2)

        notebook.set_cell_explanation(0, 'Changed explanation')

        assert _is_invalid_from(notebook, 1, 'setup_code')
        assert _is_invalid_from(notebook, 2, 'setup_code')

    def test_generate_code_invalidates_downstream_ut_without_execution(self, notebook):
        """generate_code_cell invalidates downstream unit tests even if cell was never executed.

        We can't call generate_code_cell directly (needs AI), so we verify the
        invalidation logic by calling the internal path: set code + invalidate downstream.
        Instead, we test the set_cell_source path which also goes through _invalidate_from
        when the cell was executed."""
        _add_code_cell(notebook, 'x = 1')  # cell 0
        _add_code_cell(notebook, 'y = x + 1')  # cell 1
        _add_code_cell(notebook, 'z = y + 1')  # cell 2
        # Execute all cells
        notebook.execute_cell(0)
        notebook.execute_cell(1)
        notebook.execute_cell(2)
        _attach_unit_test(notebook, 2)
        assert _is_all_valid(notebook, 2)

        # Edit cell 0 source triggers _invalidate_from(0) which should
        # invalidate cell 2's unit tests from setup_code
        notebook.set_cell_source(0, 'x = 10')

        assert _is_invalid_from(notebook, 2, 'setup_code')

    def test_double_invalidation_is_idempotent(self, notebook):
        """Invalidating already-invalid tests is a no-op (idempotent)."""
        _add_code_cell(notebook, 'x = 1')  # cell 0
        _add_code_cell(notebook, 'y = x + 1')  # cell 1
        _attach_unit_test(notebook, 1)

        notebook.set_cell_explanation(0, 'First change')
        assert _is_invalid_from(notebook, 1, 'setup_code')

        # Second invalidation should not crash or change anything
        notebook.set_cell_explanation(0, 'Second change')
        assert _is_invalid_from(notebook, 1, 'setup_code')

    def test_set_explanation_test_cell_does_not_invalidate_code_cell_ut(self, notebook):
        """Changing a test cell's explanation does not invalidate code cell unit tests."""
        _add_code_cell(notebook, 'x = 1')  # cell 0
        _attach_unit_test(notebook, 0)
        _add_test_cell(notebook, 'assert True')  # cell 1
        assert _is_all_valid(notebook, 0)

        notebook.set_cell_explanation(1, 'Changed test explanation')

        # Unit tests on cell 0 should be unaffected
        assert _is_all_valid(notebook, 0)


class TestUnitTestSubCellExplanation:
    """Tests that changing a unit test sub-cell explanation invalidates
    validity flags and kernel states."""

    def test_setup_explanation_change_invalidates_all_from_setup_code(self, notebook):
        """Changing setup cell explanation invalidates all validity flags from setup_code."""
        idx = _add_code_cell(notebook, 'x = 1')
        _attach_unit_test(notebook, idx)
        assert _is_all_valid(notebook, idx)

        notebook.save_unit_test_explanation(idx, 'test1', 'setup', 'New setup explanation')

        assert _is_invalid_from(notebook, idx, 'setup_code')

    def test_setup_explanation_change_deletes_kernel_states(self, notebook):
        """Changing setup explanation deletes kernel states for setup, target, and test."""
        idx = _add_code_cell(notebook, 'x = 1')
        _attach_unit_test(notebook, idx)
        # Simulate kernel states being stored
        cell_id = notebook.nb.cells[idx].id
        notebook._unit_test_states[f"{cell_id}:test1:setup"] = "state_setup"
        notebook._unit_test_states[f"{cell_id}:test1:target"] = "state_target"
        notebook._unit_test_states[f"{cell_id}:test1:test"] = "state_test"

        notebook.save_unit_test_explanation(idx, 'test1', 'setup', 'New setup explanation')

        # All three kernel states should be deleted
        assert f"{cell_id}:test1:setup" not in notebook._unit_test_states
        assert f"{cell_id}:test1:target" not in notebook._unit_test_states
        assert f"{cell_id}:test1:test" not in notebook._unit_test_states

    def test_test_explanation_change_invalidates_from_test_code(self, notebook):
        """Changing test cell explanation invalidates from test_code only."""
        idx = _add_code_cell(notebook, 'x = 1')
        _attach_unit_test(notebook, idx)
        assert _is_all_valid(notebook, idx)

        notebook.save_unit_test_explanation(idx, 'test1', 'test', 'New test explanation')

        assert _is_invalid_from(notebook, idx, 'test_code')

    def test_test_explanation_change_preserves_setup_and_target_states(self, notebook):
        """Changing test explanation preserves setup and target kernel states."""
        idx = _add_code_cell(notebook, 'x = 1')
        _attach_unit_test(notebook, idx)
        cell_id = notebook.nb.cells[idx].id
        notebook._unit_test_states[f"{cell_id}:test1:setup"] = "state_setup"
        notebook._unit_test_states[f"{cell_id}:test1:target"] = "state_target"
        notebook._unit_test_states[f"{cell_id}:test1:test"] = "state_test"

        notebook.save_unit_test_explanation(idx, 'test1', 'test', 'New test explanation')

        # Setup and target states should be preserved
        assert f"{cell_id}:test1:setup" in notebook._unit_test_states
        assert f"{cell_id}:test1:target" in notebook._unit_test_states
        # Test state should be deleted
        assert f"{cell_id}:test1:test" not in notebook._unit_test_states


class TestUnitTestCodeRegenAndClear:
    """Tests that regenerating or clearing unit test sub-cell code
    properly invalidates validity flags and kernel states."""

    def _setup_with_kernel_states(self, notebook):
        """Helper: create a code cell with a unit test and fake kernel states."""
        idx = _add_code_cell(notebook, 'x = 1')
        _attach_unit_test(notebook, idx)
        cell_id = notebook.nb.cells[idx].id
        notebook._unit_test_states[f"{cell_id}:test1:setup"] = "state_setup"
        notebook._unit_test_states[f"{cell_id}:test1:target"] = "state_target"
        notebook._unit_test_states[f"{cell_id}:test1:test"] = "state_test"
        return idx, cell_id

    # --- save_unit_test_code (user edits code directly) ---

    def test_save_setup_code_invalidates_from_setup_output(self, notebook):
        """Saving setup code invalidates from setup_output (code itself stays valid)."""
        idx, _ = self._setup_with_kernel_states(notebook)
        notebook.save_unit_test_code(idx, 'test1', 'setup', 'new_var = 1')
        assert _is_invalid_from(notebook, idx, 'setup_output')

    def test_save_setup_code_deletes_all_kernel_states(self, notebook):
        """Saving setup code deletes kernel states for setup, target, and test."""
        idx, cell_id = self._setup_with_kernel_states(notebook)
        notebook.save_unit_test_code(idx, 'test1', 'setup', 'new_var = 1')
        assert f"{cell_id}:test1:setup" not in notebook._unit_test_states
        assert f"{cell_id}:test1:target" not in notebook._unit_test_states
        assert f"{cell_id}:test1:test" not in notebook._unit_test_states

    def test_save_test_code_invalidates_from_test_output(self, notebook):
        """Saving test code invalidates from test_output only."""
        idx, _ = self._setup_with_kernel_states(notebook)
        notebook.save_unit_test_code(idx, 'test1', 'test', 'assert True')
        assert _is_invalid_from(notebook, idx, 'test_output')

    def test_save_test_code_preserves_setup_and_target_states(self, notebook):
        """Saving test code only deletes test kernel state, not setup or target."""
        idx, cell_id = self._setup_with_kernel_states(notebook)
        notebook.save_unit_test_code(idx, 'test1', 'test', 'assert True')
        assert f"{cell_id}:test1:setup" in notebook._unit_test_states
        assert f"{cell_id}:test1:target" in notebook._unit_test_states
        assert f"{cell_id}:test1:test" not in notebook._unit_test_states

    # --- clear_unit_test_code ---

    def test_clear_setup_code_invalidates_from_setup_code(self, notebook):
        """Clearing setup code invalidates from setup_code."""
        idx, _ = self._setup_with_kernel_states(notebook)
        notebook.clear_unit_test_code(idx, 'test1', 'setup')
        assert _is_invalid_from(notebook, idx, 'setup_code')

    def test_clear_setup_code_deletes_all_kernel_states(self, notebook):
        """Clearing setup code deletes all kernel states."""
        idx, cell_id = self._setup_with_kernel_states(notebook)
        notebook.clear_unit_test_code(idx, 'test1', 'setup')
        assert f"{cell_id}:test1:setup" not in notebook._unit_test_states
        assert f"{cell_id}:test1:target" not in notebook._unit_test_states
        assert f"{cell_id}:test1:test" not in notebook._unit_test_states

    def test_clear_test_code_invalidates_from_test_code(self, notebook):
        """Clearing test code invalidates from test_code."""
        idx, _ = self._setup_with_kernel_states(notebook)
        notebook.clear_unit_test_code(idx, 'test1', 'test')
        assert _is_invalid_from(notebook, idx, 'test_code')

    def test_clear_test_code_preserves_setup_and_target_states(self, notebook):
        """Clearing test code only deletes test kernel state."""
        idx, cell_id = self._setup_with_kernel_states(notebook)
        notebook.clear_unit_test_code(idx, 'test1', 'test')
        assert f"{cell_id}:test1:setup" in notebook._unit_test_states
        assert f"{cell_id}:test1:target" in notebook._unit_test_states
        assert f"{cell_id}:test1:test" not in notebook._unit_test_states


class TestUnitTestValidationVisibility:
    """Tests for set_unit_test_validation_visibility."""

    def test_set_visibility_setup(self, notebook):
        """Setting validation visibility on setup sub-cell stores correctly."""
        idx = _add_code_cell(notebook, 'x = 1')
        _attach_unit_test(notebook, idx)
        cell = notebook.nb.cells[idx]
        cell.metadata['unit_tests']['test1']['cells']['setup']['metadata']['validation'] = {
            'is_valid': True, 'message': 'ok', 'is_hidden': False
        }
        notebook.set_unit_test_validation_visibility(idx, 'test1', 'setup', True)
        v = cell.metadata['unit_tests']['test1']['cells']['setup']['metadata']['validation']
        assert v['is_hidden'] is True

    def test_set_visibility_test(self, notebook):
        """Setting validation visibility on test sub-cell stores correctly."""
        idx = _add_code_cell(notebook, 'x = 1')
        _attach_unit_test(notebook, idx)
        cell = notebook.nb.cells[idx]
        cell.metadata['unit_tests']['test1']['cells']['test']['metadata']['validation'] = {
            'is_valid': False, 'message': 'bad', 'is_hidden': False
        }
        notebook.set_unit_test_validation_visibility(idx, 'test1', 'test', True)
        v = cell.metadata['unit_tests']['test1']['cells']['test']['metadata']['validation']
        assert v['is_hidden'] is True

    def test_set_visibility_creates_validation_dict_if_missing(self, notebook):
        """If no validation dict exists, it is created with just is_hidden."""
        idx = _add_code_cell(notebook, 'x = 1')
        _attach_unit_test(notebook, idx)
        notebook.set_unit_test_validation_visibility(idx, 'test1', 'setup', True)
        v = notebook.nb.cells[idx].metadata['unit_tests']['test1']['cells']['setup']['metadata']['validation']
        assert v['is_hidden'] is True
