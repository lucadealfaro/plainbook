import abc
import atexit
import copy
import datetime
import json
import os
import threading

import nbformat

from .gemini import gemini_generate_code, gemini_validate_code
from .claude import claude_generate_code, claude_validate_code

AI_PROVIDERS = {
    "gemini": {"generate": gemini_generate_code, "validate": gemini_validate_code},
    "claude": {"generate": claude_generate_code, "validate": claude_validate_code},
}


class ExecutionError(Exception):
    """Custom exception for execution errors in Plainbook."""
    pass

def getlist(value):
    """Utility to ensure a value is a list."""
    if isinstance(value, list):
        return value
    else:
        return [value]

def tostring(value):
    """Utility to ensure a value is a string."""
    if isinstance(value, str):
        return value
    elif isinstance(value, list):
        return "".join(value)
    else:
        return str(value)

VARIABLE_INSPECTION_CODE = """
import json
import types

def _get_var_info():
    pd = None
    try: import pandas as pd
    except: pass
    np = None
    try: import numpy as np
    except: pass

    var_info = {}
    for name, obj in list(globals().items()):
        if name.startswith('_') or isinstance(obj, types.ModuleType) or \
           isinstance(obj, types.FunctionType) or name == 'VARIABLE_INSPECTION_CODE':
            continue
        try:
            info = {"type": type(obj).__name__}
            if pd and isinstance(obj, pd.DataFrame):
                info["columns"] = [{"name": str(c), "dtype": str(d)} for c, d in obj.dtypes.items()]
                info["shape"] = obj.shape
            elif pd and isinstance(obj, pd.Series):
                info["dtype"] = str(obj.dtype)
                info["len"] = len(obj)
            elif np and isinstance(obj, np.ndarray):
                info["shape"] = obj.shape
                info["dtype"] = str(obj.dtype)
            elif hasattr(obj, '__len__') and not isinstance(obj, (str, bytes)):
                info["len"] = len(obj)
            var_info[name] = info
        except:
            continue
    return var_info

print(json.dumps(_get_var_info()))
"""

PREVIOUS_CODE_EXPLANATION_CHANGED = """
PREVIOUS CODE CELL:
This is the previous code for the cell.
The explanation of what needs generating has changed, so the code needs to be revised.

{code_string}
"""

PREVIOUS_CODE_NEEDS_REVISION = """
PREVIOUS CELL CODE:
This is the previous code for the cell; it might need revision as some of the previous code may have changed.

{code_string}
"""


class PlainbookAbstract(abc.ABC):
    """Abstract base class for Plainbook implementations.
    Subclasses must implement the kernel-specific methods."""

    def __init__(self, notebook_path, debug=False):
        print(f"Initializing Plainbook for {notebook_path}...")
        self.path = notebook_path
        self.debug = debug
        self.name = os.path.splitext(os.path.basename(notebook_path))[0]
        self.nb = None
        self._lock = threading.Lock()
        # Status variables.
        self.last_executed_cell = -1
        self.last_valid_code_cell = -1
        self.last_valid_output_cell = -1
        # Loads the notebook from disk.
        self._load_notebook()
        self._filter_input_files()
        # AI request tracker, so we can interrupt if needed.
        self.ai_request_pending = False

    def _finalize_init(self):
        """Called by subclasses after their kernel is ready."""
        self.default_variables = self._get_variables()
        atexit.register(self._shutdown)

    # Abstract methods that subclasses must implement

    @abc.abstractmethod
    def execute_cell(self, index):
        """Executes a code cell by index and returns (outputs, details)."""
        ...

    @abc.abstractmethod
    def _reset_kernel(self):
        """Resets the kernel to a clean state."""
        ...

    @abc.abstractmethod
    def _invalidate_execution(self, index):
        """Invalidates execution from the given cell index onward."""
        ...

    @abc.abstractmethod
    def interrupt_kernel(self):
        """Interrupts the currently running execution."""
        ...

    @abc.abstractmethod
    def _get_variables(self):
        """Returns a dictionary of variables and their information in the kernel."""
        ...

    @abc.abstractmethod
    def _shutdown(self):
        """Cleanly shuts down the kernel."""
        ...

    # Notebook I/O

    def _load_notebook(self):
        """Loads the notebook from the specified path. If the file is missing, create an empty notebook."""
        try:
            with open(self.path) as f:
                self.nb = nbformat.read(f, as_version=4)
                for cell in self.nb.cells:
                    cell.source = tostring(cell.source)
                    if cell.cell_type == 'code':
                        if 'explanation' not in cell.metadata:
                            cell.metadata['explanation'] = cell.source
                            cell.metadata['explanation_timestamp'] = datetime.datetime.now().isoformat()
                        else:
                            cell.metadata['explanation'] = tostring(cell.metadata['explanation'])
                        if cell.metadata.get('code_timestamp') is None:
                            cell.metadata['code_timestamp'] = datetime.datetime.now().isoformat()
                        if cell.metadata.get('explanation_timestamp') is None:
                            cell.metadata['explanation_timestamp'] = datetime.datetime.now().isoformat()
        except (FileNotFoundError, OSError):
            # Ensure parent directory exists
            parent = os.path.dirname(self.path) or "."
            os.makedirs(parent, exist_ok=True)
            # Create an empty notebook and persist it
            self.nb = nbformat.v4.new_notebook()
            self.nb.cells = []
            self.nb.metadata = {}
            self.nb.metadata['input_files'] = []
            self.nb.metadata['is_locked'] = False
            with open(self.path, "w") as f:
                nbformat.write(self.nb, f)
        self.last_executed_cell = -1 # When we load, we need to re-execute from the start. 
        self.last_valid_code_cell = self.nb.metadata.get('last_valid_code_cell', -1)
        self.last_valid_output_cell = self.nb.metadata.get('last_valid_output', -1)

    def _filter_input_files(self):
        """Filters the input files from notebook metadata."""
        if 'input_files' in self.nb.metadata:
            input_files = self.nb.metadata['input_files']
            # Keeps only files whose path exists.
            present_input_files = []
            missing_input_files = []
            for f in input_files:
                if os.path.isfile(f.get('path', '')):
                    present_input_files.append(f)
                else:
                    missing_input_files.append(f)
            self.nb.metadata['input_files'] = present_input_files
            self.nb.metadata['missing_input_files'] = missing_input_files

    def _write(self):
        self.nb.metadata['last_valid_code_cell'] = self.last_valid_code_cell
        self.nb.metadata['last_valid_output'] = self.last_valid_output_cell
        with open(self.path, "w") as f:
            nbformat.write(self.nb, f)

    # State and JSON access

    def get_state(self):
        """Returns a dictionary representing the notebook state."""
        try:
            assert self.last_valid_code_cell >= self.last_valid_output_cell, (
                f"last_valid_code_cell {self.last_valid_code_cell}, "
                f"last_valid_output {self.last_valid_output_cell} ")
        except AssertionError as e:
            print(f"State violation: {e}")
            if not self.debug:
                raise e
        state = {
            'name': self.name,
            'path': self.path,
            'num_cells': len(self.nb.cells),
            'last_executed_cell': self.last_executed_cell,
            'last_valid_code_cell': self.last_valid_code_cell,
            'last_valid_output_cell': self.last_valid_output_cell,
            'is_locked': self.nb.metadata.get('is_locked', False),
        }
        if self.debug:
            print("State: ", json.dumps(state, indent=2))
        return state


    def get_cell_json(self, index):
        """Returns the JSON representation of a cell by index."""
        if index < 0 or index >= len(self.nb.cells):
            raise IndexError("Cell index out of range")
        return self.nb.cells[index]

    def get_json(self):
        """Returns the JSON representation of the entire notebook."""
        return self.nb

    # Public kernel reset wrapper

    def reset_kernel(self):
        """Resets the kernel."""
        print("Request to reset kernel received...")
        with self._lock:
            print("Resetting kernel...")
            self._reset_kernel()

    # Cell insertion, deletion, and movement methods

    def lock(self, is_locked):
        """Locks or unlocks the notebook."""
        with self._lock:
            self.nb.metadata['is_locked'] = is_locked
            self._write()


    def insert_cell(self, index, cell_type):
        """Insert a new cell at index with given type ('markdown' or 'code'). Returns the cell json."""
        with self._lock:
            assert cell_type in ('markdown', 'code')
            assert 0 <= index <= len(self.nb.cells)
            if cell_type == 'markdown':
                new_cell = nbformat.v4.new_markdown_cell(source="")
            else:
                new_cell = nbformat.v4.new_code_cell(source="", execution_count=None, outputs=[])
                new_cell.metadata['explanation'] = []
                new_cell.metadata['explanation_timestamp'] = datetime.datetime.now().isoformat()
            self.nb.cells.insert(index, new_cell)
            # Inserting code cells before the last executed cell requires invalidation.
            if cell_type == 'code':
                if index <= self.last_executed_cell:
                    self._invalidate_execution(index)
                self.last_valid_code_cell = min(self.last_valid_code_cell, index - 1)
                self.last_valid_output_cell = min(self.last_valid_output_cell, index - 1)
            self._write()
            return new_cell, index


    def delete_cell(self, index):
        """Delete the cell at the given index."""
        with self._lock:
            if index < 0 or index >= len(self.nb.cells):
                raise IndexError("Cell index out of range")
            cell = self.nb.cells[index]
            # Update execution pointer: invalidate if code was executed, otherwise shift index
            if index <= self.last_executed_cell:
                if cell.cell_type == 'code':
                    self._invalidate_execution(index)
                else:
                    self.last_executed_cell -= 1
            # Update validation pointer: cap if code cell, shift if markdown cell
            if cell.cell_type == 'code':
                self.last_valid_code_cell = min(self.last_valid_code_cell, index - 1)
                self.last_valid_output_cell = min(self.last_valid_output_cell, index - 1)
            else:
                if index <= self.last_valid_code_cell:
                    self.last_valid_code_cell -= 1
                if index <= self.last_valid_output_cell:
                    self.last_valid_output_cell -= 1
            # Finally, delete the cell
            del self.nb.cells[index]
            self._write()


    def move_cell(self, index, new_index):
        """Move a cell from index to new_index."""
        with self._lock:
            n = len(self.nb.cells)
            assert 0 <= index < n, "Cell index out of range"
            assert 0 <= new_index <= n, "New index out of range"
            cell = self.nb.cells.pop(index)
            self.nb.cells.insert(new_index, cell)
            if cell.cell_type == 'code':
                affected_idx = min(index, new_index)
                if self.last_executed_cell >= affected_idx:
                    self._invalidate_execution(affected_idx)
                self.last_valid_code_cell = min(self.last_valid_code_cell, affected_idx - 1)
                self.last_valid_output_cell = min(self.last_valid_output_cell, affected_idx - 1)
            else:
                # Adjust pointers for markdown cell movement
                if self.last_executed_cell >= index:
                    self.last_executed_cell -= 1
                if self.last_executed_cell >= new_index:
                    self.last_executed_cell += 1
                # Adjust validation pointer
                if self.last_valid_code_cell >= index:
                    self.last_valid_code_cell -= 1
                if self.last_valid_code_cell >= new_index:
                    self.last_valid_code_cell += 1
                # Adjusts output pointer.
                if self.last_valid_output_cell >= index:
                    self.last_valid_output_cell -= 1
                if self.last_valid_output_cell >= new_index:
                    self.last_valid_output_cell += 1
            self._write()

    # Cell editing methods

    def set_cell_source(self, index, source):
        """Sets the source code of a cell at the given index."""
        with self._lock:
            assert 0 <= index < len(self.nb.cells)
            cell = self.nb.cells[index]
            cell.source = source
            cell.metadata['code_timestamp'] = datetime.datetime.now().isoformat()
            if cell.cell_type == 'code':
                # Reset outputs and execution count on code cell edit
                cell.outputs = []
                if index <= self.last_executed_cell:
                    self._invalidate_execution(index)
                # The user has updated the code.  We will assume this
                # cell to be valid, if it was before.
                # However, any following code cells are now invalid.
                self.last_valid_code_cell = min(self.last_valid_code_cell, index)
                # The output is now stale.
                self.last_valid_output_cell = min(self.last_valid_output_cell, index - 1)
            self._write()


    def set_cell_explanation(self, index, explanation):
        """Sets the explanation of a code cell at the given index."""
        with self._lock:
            assert 0 <= index < len(self.nb.cells)
            cell = self.nb.cells[index]
            assert cell.cell_type == 'code'
            cell.metadata['explanation'] = explanation
            cell.metadata['explanation_timestamp'] = datetime.datetime.now().isoformat()
            # The cell code is now considered stale.
            self.last_valid_code_cell = min(self.last_valid_code_cell, index - 1)
            self.last_valid_output_cell = min(self.last_valid_output_cell, index - 1)
            self._write()


    # Methods to support AI

    def _get_cell_for_ai(self, index):
        """Returns the content of a cell for AI processing.
        Needs to be called with the lock held."""
        cell = self.nb.cells[index]
        if cell.cell_type == 'code':
            explanation = cell.metadata.get('explanation', "")
            explanation = ["# " + line for line in explanation.splitlines(keepends=True)]
            explanation_text = "".join(explanation) + "\n"
            source_code = cell.source + "\n"
            return explanation_text + source_code
        elif cell.cell_type == 'markdown':
            commented_lines = ["# " + line for line in cell.source.splitlines(keepends=True)]
            return "".join(commented_lines) + "\n"
        else:
            return "\n"


    def _get_cell_json_for_ai(self, index):
        """Returns the content of a cell for AI processing, in JSON format.
        Needs to be called with the lock held."""
        cell = self.nb.cells[index]
        new_cell = copy.deepcopy(cell)
        if cell.cell_type == 'code':
            explanation = cell.metadata.get('explanation', "")
            explanation = ["# " + line for line in explanation.splitlines(keepends=True)]
            explanation_text = "".join(explanation) + "\n"
            new_cell.source = explanation_text + cell.source
        return new_cell


    def _get_variables_for_ai(self, index):
        """Returns a formatted text summary of variables in the kernel
        that are defined just _before_ the cell at index is executed."""

        assert 0 <= index < len(self.nb.cells)
        # Finds the last code cell before index.
        prev_code_cell_idx = -1
        for i in range(index - 1, -1, -1):
            cell = self.nb.cells[i]
            if cell.cell_type == 'code':
                prev_code_cell_idx = i
                break
        if prev_code_cell_idx == -1:
            return ""
        variables = self.nb.cells[prev_code_cell_idx].metadata.get('variables', {})
        lines = []
        for name, info in variables.items():
            if name in self.default_variables:
                continue
            v_type = info.get('type', 'unknown')
            details = []
            if 'shape' in info:
                details.append(f"shape: {info['shape']}")
            elif 'len' in info:
                details.append(f"length: {info['len']}")
            if 'dtype' in info:
                details.append(f"dtype: {info['dtype']}")
            summary = f"- {name} ({v_type}" + (f", {', '.join(details)}" if details else "") + ")"
            lines.append(summary)
            if 'columns' in info:
                lines.append("  Columns:")
                for col in info['columns']:
                    lines.append(f"  * {col['name']} ({col['dtype']})")
        return "\n".join(lines)


    def debug_request(self, nb):
        with self._lock:
            self.nb = nbformat.reads(nb, as_version=4)


    def _get_preceding_code_for_ai(self, index):
        """Returns the concatenated source code of all previous code cells for context."""
        previous_code = [self._get_cell_for_ai(i) for i in range(index)]
        return "\n".join(previous_code)


    def _get_preceding_code_json_for_ai(self, index):
        """Returns the JSON representation of all previous code cells for context."""
        cells = [self._get_cell_json_for_ai(i) for i in range(index)]
        nb = nbformat.v4.new_notebook()
        nb.cells = cells
        nb_json = nbformat.writes(nb, indent=4)
        return nb_json


    def _get_cell_code_for_ai(self, index):
        """Returns the source code of the cell at index for context."""
        cell = self.nb.cells[index]
        if cell.cell_type != 'code' or cell.source is None or cell.source.strip() == "":
            return None
        code_string = self._get_cell_for_ai(index)
        if cell.metadata['explanation_timestamp'] < cell.metadata['code_timestamp']:
            return PREVIOUS_CODE_NEEDS_REVISION.format(code_string=code_string)
        else:
            return PREVIOUS_CODE_EXPLANATION_CHANGED.format(code_string=code_string)


    def generate_code_cell(self, api_key, index, ai_provider="gemini", validation_feedback=None):
        """Generates code for the cell at index using the specified AI provider."""
        with self._lock:
            assert 0 <= index < len(self.nb.cells)
            cell = self.nb.cells[index]
            assert cell.cell_type == 'code'
            # We can generate code only when:
            # - Output is up to date for the previous code cell.
            # - The code itself is up to date at least for the previous code cell.
            last_code_cell_idx = -1
            for i in range(index - 1, -1, -1):
                if self.nb.cells[i].cell_type == 'code':
                    last_code_cell_idx = i
                    break
            if last_code_cell_idx > 0 and self.last_valid_output_cell < last_code_cell_idx:
                raise RuntimeError("Cannot generate code: previous output must be valid.")
            # Gets code context.
            instructions = cell.metadata.get('explanation')
            files_context = self._get_files_context()
            error_context = self._get_error_context(index)
            variable_context = self._get_variables_for_ai(index)
            preceding_code = self._get_preceding_code_json_for_ai(index)
            previous_code = self._get_cell_code_for_ai(index)
            # Mark that an AI request is pending
            if self.ai_request_pending:
                raise RuntimeError("An AI request is already pending.")
            try:
                self.ai_request_pending = True
                generate_fn = AI_PROVIDERS[ai_provider]["generate"]
                new_code = generate_fn(
                    api_key,
                    preceding_code=preceding_code,
                    previous_code=previous_code,
                    instructions=instructions,
                    file_context=files_context, error_context=error_context,
                    variable_context=variable_context,
                    validation_context=validation_feedback,
                    debug=self.debug)
                # If we are still in a request, update the cell.
                if self.ai_request_pending:
                    cell.source = new_code
                    cell.metadata['code_timestamp'] = datetime.datetime.now().isoformat()
                    # Reset outputs and execution count
                    cell.outputs = []
                    if index <= self.last_executed_cell:
                        self._invalidate_execution(index)
                    # No output is valid after this.
                    self.last_valid_output_cell = min(self.last_valid_output_cell, index - 1)
                    self._write()
                    # Sets last valid code cell to this cell.
                    self.last_valid_code_cell = index
                    return new_code, True
                else:
                    # The request was cancelled, return the current code.
                    return None, False
            finally:
                self.ai_request_pending = False


    def cancel_ai_request(self):
        """Cancels any ongoing AI request by interrupting the kernel."""
        self.ai_request_pending = False


    def validate_code_cell(self, api_key, index, ai_provider="gemini"):
        """Validates the code in the cell at index using the specified AI provider."""
        with self._lock:
            if self.ai_request_pending:
                raise RuntimeError("An AI request is already pending.")
            self.ai_request_pending = True
            assert 0 <= index < len(self.nb.cells)
            cell = self.nb.cells[index]
            assert cell.cell_type == 'code'
            code_to_validate = cell.source
            instructions = cell.metadata.get('explanation')
            previous_code = self._get_preceding_code_json_for_ai(index)
            variable_context = self._get_variables_for_ai(index)
            try:
                validate_fn = AI_PROVIDERS[ai_provider]["validate"]
                validation_result = validate_fn(api_key, previous_code, code_to_validate,
                                                instructions, variable_context=variable_context,
                                                debug=self.debug)
                validation_result['is_hidden'] = False
                cell.metadata['validation'] = validation_result
                self._write()
                return validation_result
            finally:
                self.ai_request_pending = False


    def set_validation_visibility(self, cell_index, is_hidden):
        """Sets the visibility of the validation message for a given cell."""
        with self._lock:
            assert 0 <= cell_index < len(self.nb.cells)
            cell = self.nb.cells[cell_index]
            assert cell.cell_type == 'code'
            if 'validation' not in cell.metadata:
                cell.metadata['validation'] = {}
            cell.metadata['validation']['is_hidden'] = is_hidden
            self._write()


    def set_input_files(self, files, missing_files=[]):
        """Sets the input files for the notebook."""
        with self._lock:
            self.nb.metadata['input_files'] = files
            self.nb.metadata['missing_input_files'] = missing_files
            self._write()


    def get_input_files(self):
        """Returns the input files for the notebook."""
        with self._lock:
            return dict(
                input_files=self.nb.metadata.get('input_files', []),
                missing_input_files=self.nb.metadata.get('missing_input_files', [])
            )


    def _get_files_context(self):
        """Builds the AI context including input files."""
        context_parts = [
            "Here is a list of file names and paths. "
            "The user may mention input files; to access them, the full path should be used."
            ]
        for file in self.nb.metadata.get('input_files', []):
            context_parts.append(f"* File name: {file['name']} path: {file['path']}\n")
        return "\n".join(context_parts) + "\n"


    def _get_error_context(self, cell_index):
        """If the cell has an error, include its traceback as context."""
        context_parts = [
            "The previous attempt to run this cell resulted in this error traceback:"
        ]
        cell = self.nb.cells[cell_index]
        if cell.cell_type != 'code':
            return None
        for output in reversed(getlist(cell.get('outputs', []))):
            if output.output_type == 'error':
                traceback = context_parts + getlist(output.get('traceback', []))
                return "\n".join(traceback)
        return None
