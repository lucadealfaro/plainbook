import atexit
import copy
import datetime
import json
import os
import re
import secrets
import socket
import subprocess
import sys
import threading
import time
import uuid

import nbformat
import requests

from .ai_common import get_session_tokens
from .gemini import gemini_generate_code, gemini_validate_code, gemini_generate_cell_name, gemini_generate_test_code, gemini_generate_unit_test_code
from .claude import claude_generate_code, claude_validate_code, claude_generate_cell_name, claude_generate_test_code, claude_generate_unit_test_code

AI_PROVIDERS = {
    "gemini": {"generate": gemini_generate_code, "validate": gemini_validate_code, "name": gemini_generate_cell_name, "generate_test": gemini_generate_test_code, "generate_unit_test": gemini_generate_unit_test_code},
    "claude": {"generate": claude_generate_code, "validate": claude_validate_code, "name": claude_generate_cell_name, "generate_test": claude_generate_test_code, "generate_unit_test": claude_generate_unit_test_code},
}

MAX_OUTPUT_CHARS_FOR_AI = 2000


class ExecutionError(Exception):
    """Custom exception for execution errors in Plainbook."""
    pass

class CellExecutionError(Exception):
    """Raised when a cell execution produces a runtime error."""
    def __init__(self, traceback="", ename="", evalue=""):
        self.traceback = traceback
        self.ename = ename
        self.evalue = evalue
        super().__init__(f"{ename}: {evalue}")

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


def _generate_random_name():
    """Generates a random pronounceable name like 'bakace_runabi'."""
    import random
    vowels = 'aeiou'
    consonants = 'bcdfghjklmnpqrstvwxyz'
    def _random_word():
        return ''.join(random.choice(consonants) + random.choice(vowels) for _ in range(3))
    return _random_word() + '_' + _random_word()


class Plainbook:
    """Plainbook implementation backed by the snapshot kernel."""

    def __init__(self, notebook_path, debug=False, dump_ai_requests=False):
        print(f"Starting Plainbook for {notebook_path}...")
        self.path = notebook_path
        self.debug = debug
        self.dump_ai_requests = dump_ai_requests
        self.name = os.path.splitext(os.path.basename(notebook_path))[0]
        self.nb = None
        self._lock = threading.Lock()
        # Status variables.
        self.last_executed_cell = -1
        self.last_valid_code_cell = -1
        self.last_valid_output_cell = -1
        self.last_valid_test_cell = -1
        # Loads the notebook from disk.
        self._load_notebook()
        self._filter_input_files()
        # AI request tracker, so we can interrupt if needed.
        self.ai_request_pending = False
        # Start the snapshot kernel.
        self._sk_token = secrets.token_hex(16)
        self._sk_port = self._find_free_port(start=9100)
        self._sk_base_url = f"http://127.0.0.1:{self._sk_port}"
        self._current_exec_id = None
        self._cell_states = {}
        self._unit_test_states = {}     # "{cell_id}:{test_name}:{role}" -> kernel state name
        self._unit_test_validity = {}   # (cell_id, test_name) -> {5 boolean flags}
        self._sk_process = subprocess.Popen(
            [sys.executable, "-m", "snapshot_kernel.main",
             "--bind", f"127.0.0.1:{self._sk_port}",
             "--token", self._sk_token],
            stdout=None if debug else subprocess.PIPE,
            stderr=None if debug else subprocess.PIPE,
        )
        self._wait_for_server()
        self.default_variables = self._get_variables()
        atexit.register(self._shutdown)

    # Compatibility properties for main.py assertions

    @property
    def kc(self):
        return self

    @property
    def km(self):
        return self

    def is_alive(self):
        return self._sk_process is not None and self._sk_process.poll() is None

    # Snapshot kernel HTTP helpers

    def _sk_request(self, method, path, json_body=None):
        """Send a request to the snapshot kernel server."""
        url = f"{self._sk_base_url}{path}"
        params = {"token": self._sk_token}
        resp = requests.request(method, url, params=params, json=json_body, timeout=300)
        resp.raise_for_status()
        return resp.json()

    def _find_free_port(self, start=9100):
        """Scan for a free port starting from start."""
        port = start
        while True:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                try:
                    s.bind(('127.0.0.1', port))
                    return port
                except OSError:
                    port += 1

    def _wait_for_server(self, timeout=10):
        """Poll GET /states until the snapshot kernel server is ready."""
        deadline = time.time() + timeout
        while time.time() < deadline:
            try:
                self._sk_request("GET", "/states")
                if self.debug:
                    print(f"Snapshot kernel server ready on port {self._sk_port}")
                return
            except Exception:
                time.sleep(0.2)
        raise RuntimeError(
            f"Snapshot kernel server failed to start within {timeout}s on port {self._sk_port}"
        )

    def _find_input_state(self, index):
        """Walk backwards to find the snapshot state name to execute cell `index` against.
        Returns 'initial' if no previous code cell has been executed."""
        for i in range(index - 1, -1, -1):
            cell = self.nb.cells[i]
            if cell.cell_type == 'code' and i <= self.last_executed_cell:
                state = self._cell_states.get(cell.id)
                if state:
                    return state
        return "initial"

    # Unit test validity tracking

    _UT_CASCADE = ['setup_code', 'setup_output', 'target_output', 'test_code', 'test_output']
    _UT_STATE_ROLES = {'setup_output': 'setup', 'target_output': 'target', 'test_output': 'test'}

    def _ut_state_key(self, cell_index, test_name, role):
        return f"{self.nb.cells[cell_index].id}:{test_name}:{role}"

    def _get_ut_validity(self, cell_index, test_name):
        """Get or create validity dict for a unit test."""
        key = (self.nb.cells[cell_index].id, test_name)
        if key not in self._unit_test_validity:
            self._unit_test_validity[key] = {
                'setup_code_valid': False,
                'setup_output_valid': False,
                'target_output_valid': False,
                'test_code_valid': False,
                'test_output_valid': False,
            }
        return self._unit_test_validity[key]

    def _invalidate_unit_test(self, cell_index, test_name, from_point):
        """Cascade invalidation from from_point onward for a unit test."""
        v = self._get_ut_validity(cell_index, test_name)
        start = self._UT_CASCADE.index(from_point)
        for point in self._UT_CASCADE[start:]:
            v[point + '_valid'] = False
            if point in self._UT_STATE_ROLES:
                sk = self._ut_state_key(cell_index, test_name, self._UT_STATE_ROLES[point])
                if sk in self._unit_test_states:
                    try:
                        self._sk_request("DELETE", f"/states/{self._unit_test_states[sk]}")
                    except Exception:
                        pass
                    del self._unit_test_states[sk]

    def _invalidate_all_unit_tests(self, cell_index, from_point):
        """Invalidate all unit tests for a cell from from_point onward."""
        cell = self.nb.cells[cell_index]
        tests = cell.metadata.get('unit_tests', {})
        for test_name in tests:
            self._invalidate_unit_test(cell_index, test_name, from_point)

    def get_unit_test_state(self, cell_index):
        """Returns validity flags for all unit tests of a specific target cell."""
        cell = self.nb.cells[cell_index]
        tests = cell.metadata.get('unit_tests', {})
        result = {}
        for test_name in tests:
            v = self._get_ut_validity(cell_index, test_name)
            result[test_name] = {
                'setup': {'code_valid': v['setup_code_valid'], 'output_valid': v['setup_output_valid']},
                'target': {'output_valid': v['target_output_valid']},
                'test': {'code_valid': v['test_code_valid'], 'output_valid': v['test_output_valid']},
            }
        return result

    # Kernel methods

    def execute_cell(self, index):
        """Executes a code cell by index against the appropriate snapshot."""
        with self._lock:
            if index < 0 or index >= len(self.nb.cells):
                raise ExecutionError("Cell index out of range")
            if index > self.last_valid_code_cell:
                raise ExecutionError("Executed a cell that is not valid")
            cell = self.nb.cells[index]
            if cell.cell_type != 'code':
                return None, "Not a code cell"
            if index <= min(self.last_executed_cell, self.last_valid_output_cell):
                return cell.outputs, "Cached"
            # Checks that all intervening cells between last_executed_cell and index are non-code.
            for i in range(self.last_executed_cell + 1, index):
                if self.nb.cells[i].cell_type == 'code':
                    raise ExecutionError("Cannot execute cell out of order")

            input_state = self._find_input_state(index)
            cell_id = cell.id
            if cell_id in self._cell_states:
                new_state_name = self._cell_states[cell_id]
            else:
                new_state_name = uuid.uuid4().hex
                existing_names = set(self._cell_states.values())
                while new_state_name in existing_names:
                    new_state_name = uuid.uuid4().hex
                self._cell_states[cell_id] = new_state_name
            exec_id = uuid.uuid4().hex
            self._current_exec_id = exec_id

            try:
                result = self._sk_request("POST", "/execute", {
                    "code": cell.source,
                    "exec_id": exec_id,
                    "state_name": input_state,
                    "new_state_name": new_state_name,
                })
            finally:
                self._current_exec_id = None

            # Convert outputs to nbformat objects
            outputs = []
            for out in result.get("output", []):
                outputs.append(nbformat.from_dict(out))
            cell.outputs = outputs

            if result.get("error"):
                err = result["error"]
                # Build an error output matching Jupyter format
                error_output = nbformat.from_dict({
                    "output_type": "error",
                    "ename": err.get("ename", "Error"),
                    "evalue": err.get("evalue", ""),
                    "traceback": err.get("traceback", []),
                })
                # Only append if not already in outputs
                if not any(o.get("output_type") == "error" for o in cell.outputs):
                    cell.outputs.append(error_output)
                self._write()
                raise CellExecutionError(
                    traceback="\n".join(err.get("traceback", [])),
                    ename=err.get("ename", "Error"),
                    evalue=err.get("evalue", ""),
                )

            # Success: update execution pointer
            self.last_executed_cell = index
            self.last_valid_output_cell = max(index, self.last_valid_output_cell)
            # Get variables for AI context
            cell.metadata['variables'] = self._get_variables()
            self._write()
            return cell.outputs, 'ok'

    def _get_variables(self, state_name=None):
        """Execute the variable inspection code against a given or last executed state."""
        if state_name is None:
            # Find the most recent valid state
            for i in range(len(self.nb.cells) - 1, -1, -1):
                cell = self.nb.cells[i]
                if cell.cell_type == 'code' and i <= self.last_executed_cell:
                    state_name = self._cell_states.get(cell.id)
                    if state_name:
                        break
        if not state_name:
            return {}

        temp_state = uuid.uuid4().hex
        try:
            result = self._sk_request("POST", "/execute", {
                "code": VARIABLE_INSPECTION_CODE,
                "exec_id": uuid.uuid4().hex,
                "state_name": state_name,
                "new_state_name": temp_state,
            })
            # Parse stdout from the output
            result_json = ""
            for out in result.get("output", []):
                if out.get("output_type") == "stream" and out.get("name") == "stdout":
                    result_json += out.get("text", "")
            # Clean up temp state
            try:
                self._sk_request("DELETE", f"/states/{temp_state}")
            except Exception:
                pass
            return json.loads(result_json)
        except (json.JSONDecodeError, TypeError, Exception):
            # Clean up temp state on error
            try:
                self._sk_request("DELETE", f"/states/{temp_state}")
            except Exception:
                pass
            return {}

    def _reset_kernel(self):
        """Reset the snapshot kernel: clear all states, reset pointers."""
        self._sk_request("POST", "/reset")
        self.last_executed_cell = -1
        self._cell_states.clear()
        self._unit_test_states.clear()
        self._unit_test_validity.clear()
        if self.debug:
            print("Snapshot kernel reset complete.")

    def _invalidate_execution(self, index):
        """Delete snapshot states from cell index onward. Preserves earlier snapshots."""
        self._invalidate_from(index)

    def _invalidate_from(self, index):
        """Delete snapshot states from cell index onward.
        Dict entries are kept so state names can be reused on re-execution."""
        for i in range(index, len(self.nb.cells)):
            cell = self.nb.cells[i]
            state_name = self._cell_states.get(cell.id)
            if state_name:
                try:
                    self._sk_request("DELETE", f"/states/{state_name}")
                except Exception:
                    pass
                # Keep dict entry — name will be reused on re-execution
            # Invalidate unit tests for cells at or after the invalidation point
            if cell.metadata.get('unit_tests'):
                self._invalidate_all_unit_tests(i, 'setup_output')
        self.last_executed_cell = min(self.last_executed_cell, index - 1)

    def interrupt_kernel(self):
        """Interrupt the currently running execution."""
        exec_id = self._current_exec_id
        if exec_id:
            if self.debug:
                print(f"Interrupting execution {exec_id}...")
            try:
                self._sk_request("POST", "/interrupt", {"exec_id": exec_id})
            except Exception as e:
                if self.debug:
                    print(f"Error interrupting: {e}")

    def _shutdown(self):
        """Terminate the snapshot kernel subprocess."""
        if self.debug:
            print(f"Shutting down snapshot kernel for {self.name}...")
        if hasattr(self, '_sk_process') and self._sk_process:
            try:
                self._sk_process.terminate()
                self._sk_process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self._sk_process.kill()
                self._sk_process.wait()
            except Exception as e:
                print(f"Error shutting down snapshot kernel: {e}")

    # Notebook I/O

    def _load_notebook(self):
        """Loads the notebook from the specified path. If the file is missing, create an empty notebook."""
        try:
            with open(self.path) as f:
                self.nb = nbformat.read(f, as_version=4)
                for cell in self.nb.cells:
                    cell.source = tostring(cell.source)
                    if cell.cell_type in ('code', 'test'):
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
            self.nb.metadata['share_output_with_ai'] = True
            self.nb.metadata['ai_instructions'] = ''
            with open(self.path, "w") as f:
                nbformat.write(self.nb, f)
        self.last_executed_cell = -1 # When we load, we need to re-execute from the start.
        self.last_valid_code_cell = self.nb.metadata.get('last_valid_code_cell', -1)
        self.last_valid_output_cell = self.nb.metadata.get('last_valid_output', -1)
        self.last_valid_test_cell = self.nb.metadata.get('last_valid_test_cell', -1)

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
        self.nb.metadata['last_valid_test_cell'] = self.last_valid_test_cell
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
            'last_valid_test_cell': self.last_valid_test_cell,
            'is_locked': self.nb.metadata.get('is_locked', False),
            'share_output_with_ai': self.nb.metadata.get('share_output_with_ai', True),
            'ai_tokens': get_session_tokens(),
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
        if self.debug:
            print("Request to reset kernel received...")
        with self._lock:
            if self.debug:
                print("Resetting kernel...")
            self._reset_kernel()

    # Cell insertion, deletion, and movement methods

    def lock(self, is_locked):
        """Locks or unlocks the notebook."""
        with self._lock:
            self.nb.metadata['is_locked'] = is_locked
            self._write()

    def set_share_output_with_ai(self, share):
        """Sets whether cell outputs are shared with AI."""
        with self._lock:
            self.nb.metadata['share_output_with_ai'] = share
            self._write()

    def insert_cell(self, index, cell_type):
        """Insert a new cell at index with given type ('markdown', 'code', or 'test'). Returns the cell json."""
        with self._lock:
            assert cell_type in ('markdown', 'code', 'test')
            assert 0 <= index <= len(self.nb.cells)
            if cell_type == 'markdown':
                new_cell = nbformat.v4.new_markdown_cell(source="")
            elif cell_type == 'test':
                new_cell = nbformat.v4.new_code_cell(source="", execution_count=None, outputs=[])
                new_cell.cell_type = 'test'
                new_cell.metadata['explanation'] = []
                new_cell.metadata['explanation_timestamp'] = datetime.datetime.now().isoformat()
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
                self.last_valid_test_cell = min(self.last_valid_test_cell, index - 1)
            elif cell_type == 'test':
                self.last_valid_test_cell = min(self.last_valid_test_cell, index - 1)
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
                    # Test and markdown cells are not in the main execution chain
                    self.last_executed_cell -= 1
            # Update validation pointers
            if cell.cell_type == 'code':
                self.last_valid_code_cell = min(self.last_valid_code_cell, index - 1)
                self.last_valid_output_cell = min(self.last_valid_output_cell, index - 1)
                self.last_valid_test_cell = min(self.last_valid_test_cell, index - 1)
            elif cell.cell_type == 'test':
                self.last_valid_test_cell = min(self.last_valid_test_cell, index - 1)
                # Shift code/output pointers since test cells are not in the main chain
                if index <= self.last_valid_code_cell:
                    self.last_valid_code_cell -= 1
                if index <= self.last_valid_output_cell:
                    self.last_valid_output_cell -= 1
            else:
                # Markdown cell: shift all pointers
                if index <= self.last_valid_code_cell:
                    self.last_valid_code_cell -= 1
                if index <= self.last_valid_output_cell:
                    self.last_valid_output_cell -= 1
                if index <= self.last_valid_test_cell:
                    self.last_valid_test_cell -= 1
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
                self.last_valid_test_cell = min(self.last_valid_test_cell, affected_idx - 1)
            elif cell.cell_type == 'test':
                # Test cells are not in the main execution chain; shift code/output/executed pointers
                if self.last_executed_cell >= index:
                    self.last_executed_cell -= 1
                if self.last_executed_cell >= new_index:
                    self.last_executed_cell += 1
                if self.last_valid_code_cell >= index:
                    self.last_valid_code_cell -= 1
                if self.last_valid_code_cell >= new_index:
                    self.last_valid_code_cell += 1
                if self.last_valid_output_cell >= index:
                    self.last_valid_output_cell -= 1
                if self.last_valid_output_cell >= new_index:
                    self.last_valid_output_cell += 1
                # Cap test validity at the affected range
                self.last_valid_test_cell = min(self.last_valid_test_cell, min(index, new_index) - 1)
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
                # Shift test pointer for markdown movement
                if self.last_valid_test_cell >= index:
                    self.last_valid_test_cell -= 1
                if self.last_valid_test_cell >= new_index:
                    self.last_valid_test_cell += 1
            self._write()

    # Cell editing methods

    def set_cell_source(self, index, source):
        """Sets the source code of a cell at the given index."""
        with self._lock:
            assert 0 <= index < len(self.nb.cells)
            cell = self.nb.cells[index]
            cell.source = source
            cell.metadata['code_timestamp'] = datetime.datetime.now().isoformat()
            if cell.cell_type == 'test':
                cell.outputs = []
                # The user has updated the test code; assume this cell valid, following invalid.
                self.last_valid_test_cell = min(self.last_valid_test_cell, index)
            elif cell.cell_type == 'code':
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
                self.last_valid_test_cell = min(self.last_valid_test_cell, index - 1)
            self._write()


    def clear_cell_code(self, index):
        """Clears the source code of a code or test cell and marks its code as invalid."""
        with self._lock:
            assert 0 <= index < len(self.nb.cells)
            cell = self.nb.cells[index]
            assert cell.cell_type in ('code', 'test')
            cell.source = ''
            cell.outputs = []
            if cell.cell_type == 'test':
                self.last_valid_test_cell = min(self.last_valid_test_cell, index - 1)
            else:
                if index <= self.last_executed_cell:
                    self._invalidate_execution(index)
                self.last_valid_code_cell = min(self.last_valid_code_cell, index - 1)
                self.last_valid_output_cell = min(self.last_valid_output_cell, index - 1)
                self.last_valid_test_cell = min(self.last_valid_test_cell, index - 1)
            self._write()

    def set_cell_explanation(self, index, explanation):
        """Sets the explanation of a code or test cell at the given index."""
        with self._lock:
            assert 0 <= index < len(self.nb.cells)
            cell = self.nb.cells[index]
            assert cell.cell_type in ('code', 'test')
            cell.metadata['explanation'] = explanation
            cell.metadata['explanation_timestamp'] = datetime.datetime.now().isoformat()
            if cell.cell_type == 'test':
                self.last_valid_test_cell = min(self.last_valid_test_cell, index - 1)
            else:
                # The cell code is now considered stale.
                self.last_valid_code_cell = min(self.last_valid_code_cell, index - 1)
                self.last_valid_output_cell = min(self.last_valid_output_cell, index - 1)
                self.last_valid_test_cell = min(self.last_valid_test_cell, index - 1)
                # Invalidate unit tests: target explanation changed
                if cell.metadata.get('unit_tests'):
                    self._invalidate_all_unit_tests(index, 'target_output')
            self._write()


    # Unit test metadata methods (stubs for Phase 1)

    def save_unit_tests(self, cell_index, unit_tests):
        """Save the full unit_tests dict to cell metadata."""
        with self._lock:
            assert 0 <= cell_index < len(self.nb.cells)
            cell = self.nb.cells[cell_index]
            cell_id = cell.id
            # Clear validity entries for this cell
            for k in [k for k in self._unit_test_validity if k[0] == cell_id]:
                del self._unit_test_validity[k]
            # Clear and delete kernel state entries for this cell
            for sk in [sk for sk in self._unit_test_states if sk.startswith(f"{cell_id}:")]:
                try:
                    self._sk_request("DELETE", f"/states/{self._unit_test_states[sk]}")
                except Exception:
                    pass
                del self._unit_test_states[sk]
            cell.metadata['unit_tests'] = unit_tests
            self._write()

    def save_unit_test_explanation(self, cell_index, test_name, role, explanation):
        """Update the explanation of a unit test sub-cell."""
        with self._lock:
            assert 0 <= cell_index < len(self.nb.cells)
            cell = self.nb.cells[cell_index]
            tests = cell.metadata.get('unit_tests', {})
            assert test_name in tests
            assert role in ('setup', 'test')
            tests[test_name][role]['metadata']['explanation'] = explanation
            tests[test_name][role]['metadata']['explanation_timestamp'] = datetime.datetime.now().isoformat()
            # Invalidate from the appropriate point
            if role == 'setup':
                self._invalidate_unit_test(cell_index, test_name, 'setup_code')
            else:
                self._invalidate_unit_test(cell_index, test_name, 'test_code')
            self._write()

    def save_unit_test_code(self, cell_index, test_name, role, source):
        """Update the source code of a unit test sub-cell."""
        with self._lock:
            assert 0 <= cell_index < len(self.nb.cells)
            cell = self.nb.cells[cell_index]
            tests = cell.metadata.get('unit_tests', {})
            assert test_name in tests
            assert role in ('setup', 'test')
            tests[test_name][role]['source'] = source
            tests[test_name][role]['metadata']['code_timestamp'] = datetime.datetime.now().isoformat()
            # Invalidate from the appropriate point
            if role == 'setup':
                self._invalidate_unit_test(cell_index, test_name, 'setup_output')
            else:
                self._invalidate_unit_test(cell_index, test_name, 'test_output')
            self._write()

    def clear_unit_test_code(self, cell_index, test_name, role):
        """Clear the source code and outputs of a unit test sub-cell."""
        with self._lock:
            assert 0 <= cell_index < len(self.nb.cells)
            cell = self.nb.cells[cell_index]
            tests = cell.metadata.get('unit_tests', {})
            assert test_name in tests
            assert role in ('setup', 'test')
            tests[test_name][role]['source'] = ''
            tests[test_name][role]['outputs'] = []
            # Invalidate from the appropriate point
            if role == 'setup':
                self._invalidate_unit_test(cell_index, test_name, 'setup_code')
            else:
                self._invalidate_unit_test(cell_index, test_name, 'test_code')
            self._write()

    # Unit test execution and generation

    def execute_unit_test_cell(self, cell_index, test_name, role):
        """Execute a unit test sub-cell (setup, target, or test)."""
        with self._lock:
            assert 0 <= cell_index < len(self.nb.cells)
            cell = self.nb.cells[cell_index]
            tests = cell.metadata.get('unit_tests', {})
            assert test_name in tests
            assert role in ('setup', 'target', 'test')
            unit_test = tests[test_name]

            # Determine input state
            if role == 'setup':
                input_state = self._find_input_state(cell_index)
            elif role == 'target':
                setup_key = self._ut_state_key(cell_index, test_name, 'setup')
                if setup_key not in self._unit_test_states:
                    raise ExecutionError("Setup must be executed before target")
                input_state = self._unit_test_states[setup_key]
            else:  # test
                target_key = self._ut_state_key(cell_index, test_name, 'target')
                if target_key not in self._unit_test_states:
                    raise ExecutionError("Target must be executed before test")
                input_state = self._unit_test_states[target_key]

            # Determine source code
            if role == 'setup':
                source = unit_test['setup'].get('source', '')
                # Handle empty setup: skip execution, just record the input state
                if not source.strip():
                    setup_key = self._ut_state_key(cell_index, test_name, 'setup')
                    self._unit_test_states[setup_key] = input_state
                    v = self._get_ut_validity(cell_index, test_name)
                    v['setup_output_valid'] = True
                    unit_test['setup']['outputs'] = []
                    self._write()
                    return []
            elif role == 'target':
                source = cell.source
            else:
                source = unit_test['test'].get('source', '')

            # Allocate/reuse state name guaranteeing uniqueness across all unit test sub-cells and main cells.
            state_key = self._ut_state_key(cell_index, test_name, role)
            if state_key in self._unit_test_states:
                new_state_name = self._unit_test_states[state_key]
            else:
                existing_names = set(self._cell_states.values()) | set(self._unit_test_states.values())
                new_state_name = uuid.uuid4().hex
                while new_state_name in existing_names:
                    new_state_name = uuid.uuid4().hex
                self._unit_test_states[state_key] = new_state_name

            exec_id = uuid.uuid4().hex
            self._current_exec_id = exec_id
            try:
                result = self._sk_request("POST", "/execute", {
                    "code": source,
                    "exec_id": exec_id,
                    "state_name": input_state,
                    "new_state_name": new_state_name,
                })
            finally:
                self._current_exec_id = None

            # Convert outputs
            outputs = []
            for out in result.get("output", []):
                outputs.append(nbformat.from_dict(out))

            # Store outputs in appropriate location
            if role == 'setup':
                unit_test['setup']['outputs'] = outputs
            elif role == 'target':
                if 'target' not in unit_test:
                    unit_test['target'] = {}
                unit_test['target']['outputs'] = outputs
            else:
                unit_test['test']['outputs'] = outputs

            if result.get("error"):
                err = result["error"]
                error_output = nbformat.from_dict({
                    "output_type": "error",
                    "ename": err.get("ename", "Error"),
                    "evalue": err.get("evalue", ""),
                    "traceback": err.get("traceback", []),
                })
                if role == 'setup':
                    if not any(o.get("output_type") == "error" for o in unit_test['setup']['outputs']):
                        unit_test['setup']['outputs'].append(error_output)
                elif role == 'target':
                    if not any(o.get("output_type") == "error" for o in unit_test['target']['outputs']):
                        unit_test['target']['outputs'].append(error_output)
                else:
                    if not any(o.get("output_type") == "error" for o in unit_test['test']['outputs']):
                        unit_test['test']['outputs'].append(error_output)
                self._write()
                raise CellExecutionError(
                    traceback="\n".join(err.get("traceback", [])),
                    ename=err.get("ename", "Error"),
                    evalue=err.get("evalue", ""),
                )

            # Get variables and store them
            variables = self._get_variables(state_name=new_state_name)
            if role == 'target':
                unit_test['target']['variables'] = variables
            elif role == 'setup':
                unit_test['setup']['metadata']['variables'] = variables
            else:
                # For test, add success message
                outputs.append(nbformat.from_dict({
                    "output_type": "stream",
                    "name": "stdout",
                    "text": "The test passed.\n",
                }))
                if role == 'test':
                    unit_test['test']['outputs'] = outputs

            # Set validity flag
            v = self._get_ut_validity(cell_index, test_name)
            if role == 'setup':
                v['setup_output_valid'] = True
            elif role == 'target':
                v['target_output_valid'] = True
            else:
                v['test_output_valid'] = True

            self._write()
            return outputs


    def _format_ut_subcell_for_ai(self, cell_or_dict, label):
        """Format a unit test sub-cell (or main cell) for AI context.
        Works with both nbformat cell objects (for target) and plain dicts (for setup/test).
        Returns a string like '# Explanation: ...\ncode...' or None if empty."""
        # Handle both nbformat objects (attribute access) and plain dicts
        if hasattr(cell_or_dict, 'metadata'):
            explanation = cell_or_dict.metadata.get('explanation', '')
            source = cell_or_dict.source or ''
        else:
            explanation = cell_or_dict.get('metadata', {}).get('explanation', '')
            source = cell_or_dict.get('source', '')
        if not explanation and not source:
            return None
        parts = []
        if explanation:
            parts.append(f"# {label.capitalize()} explanation: {explanation}")
        if source:
            parts.append(f"# {label.capitalize()} code:\n{source}")
        return "\n".join(parts)

    def _ut_extract_error_context(self, outputs):
        """Extract error traceback from unit test sub-cell outputs."""
        for output in reversed(outputs):
            if output.get('output_type') == 'error':
                return ("The previous attempt to run this cell resulted in this error traceback:\n"
                        + "\n".join(getlist(output.get('traceback', []))))
        return None

 
    # Methods to support AI


    def _filter_outputs_for_ai(self, outputs):
        """Filters cell outputs to remove images and oversized data before
        sending to AI. Returns a new list of filtered output items."""
        media_keys = {'image/png', 'image/jpeg', 'image/gif', 'image/svg+xml',
                      'image/bmp', 'image/webp', 'application/pdf'}
        filtered = []
        for output in outputs:
            output_type = output.get('output_type', '')
            if output_type in ('display_data', 'execute_result'):
                data = output.get('data', {})
                data = {k: v for k, v in data.items() if k not in media_keys}
                if not data:
                    continue
                output = copy.copy(output)
                output['data'] = data
            if len(json.dumps(output, default=str)) > MAX_OUTPUT_CHARS_FOR_AI:
                continue
            filtered.append(output)
        return filtered


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
        if not self.nb.metadata.get('share_output_with_ai', True):
            new_cell.outputs = []
        else:
            new_cell.outputs = self._filter_outputs_for_ai(new_cell.outputs)
        return new_cell


    def _format_variables_for_ai(self, variables):
        """Format a variables dict into a text summary for AI context."""
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

    def _get_target_accessed_variables(self, source):
        """Return the set of variable names accessed (read) by the given source code,
        excluding builtins and names that are only assigned."""
        import ast
        import builtins
        try:
            tree = ast.parse(source)
        except SyntaxError:
            return set()
        loaded = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.Name):
                if isinstance(node.ctx, ast.Load):
                    loaded.add(node.id)
        builtin_names = set(dir(builtins))
        return loaded - builtin_names


    def _get_previous_code_cell_index(self, index):
        """Returns the index of the last code cell before the given index, or -1 if none exists."""
        assert 0 <= index < len(self.nb.cells)
        for i in range(index - 1, -1, -1):
            if self.nb.cells[i].cell_type == 'code':
                return i
        return -1


    def _get_previous_code_cell(self, index):
        """Returns the last code cell before the given index, or None if none exists."""
        prev_index = self._get_previous_code_cell_index(index)
        return self.nb.cells[prev_index] if prev_index >= 0 else None
    

    def _get_variables_for_ai(self, cell):
        """Returns a formatted text summary of variables in the kernel
        that are defined just _before_ the cell at index is executed."""
        variables = cell.metadata.get('variables', {})
        return self._format_variables_for_ai(variables)


    def debug_request(self, nb):
        with self._lock:
            self.nb = nbformat.reads(nb, as_version=4)


    def _get_preceding_code_json_for_ai(self, index, include_all_variables=True):
        """Returns the JSON representation of all previous code cells for context.
        If include_all_variables is False, strip variables metadata and outputs
        from all cells, to reduce prompt size."""
        cells = [self._get_cell_json_for_ai(i) for i in range(index)
                 if self.nb.cells[i].cell_type != 'test']
        if not include_all_variables:
            # Strips variables and outputs from previous cels. 
            # Find the last code cell and strip variables/outputs from all others.
            for i, cell in enumerate(cells):
                if 'variables' in cell.metadata:
                    cell.metadata.pop('variables', None)
                cell.outputs = []
        nb = nbformat.v4.new_notebook()
        nb.cells = cells
        nb_json = nbformat.writes(nb, indent=4)
        return nb_json


    def _get_cell_w_change_noted(self, cell):
        """Returns the source code of the cell at index for context."""
        if cell.cell_type != 'code' or cell.source is None or cell.source.strip() == "":
            return None
        code_string = self._get_cell_json_for_ai(cell)
        if cell.metadata['explanation_timestamp'] < cell.metadata['code_timestamp']:
            return PREVIOUS_CODE_NEEDS_REVISION.format(code_string=code_string)
        else:
            return PREVIOUS_CODE_EXPLANATION_CHANGED.format(code_string=code_string)


    def _is_previous_code_and_output_valid(self, index):
        last_code_cell_idx = self._get_previous_code_cell_index(index)
        if last_code_cell_idx < 0:
            return True # No previous code.
        # If we share output with AI, then we need valid output, but in any case we need valid variables.  
        return self.last_valid_output_cell >= last_code_cell_idx
            

    def generate_code_cell(self, api_key, index, ai_provider="gemini", model=None, validation_feedback=None):
        """Generates code for the cell at index using the specified AI provider."""
        with self._lock:
            assert 0 <= index < len(self.nb.cells)
            cell = self.nb.cells[index]
            assert cell.cell_type == 'code'
            if not self._is_previous_code_and_output_valid(index):
                raise RuntimeError("Cannot generate code: previous output must be valid.")
            # Gets code context.
            instructions = cell.metadata.get('explanation')
            ai_instructions = self.nb.metadata.get('ai_instructions', '')
            if ai_instructions:
                instructions = instructions + "\n\nADDITIONAL INSTRUCTIONS:\n" + ai_instructions
            files_context = self._get_files_context()
            previous_code_cell = self._get_previous_code_cell(index)
            error_context = self._get_error_context(index)
            variable_context = self._get_variables_for_ai(previous_code_cell) if previous_code_cell else ""
            preceding_code = self._get_preceding_code_json_for_ai(index, include_all_variables=False)
            previous_code = self._get_cell_w_change_noted(cell)
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
                    model=model,
                    debug=self.debug,
                    dump_ai_requests=self.dump_ai_requests)
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
                    # Invalidate unit tests: target code changed
                    if cell.metadata.get('unit_tests'):
                        self._invalidate_all_unit_tests(index, 'target_output')
                    self._write()
                    # Sets last valid code cell to this cell.
                    self.last_valid_code_cell = index
                    return new_code, True
                else:
                    # The request was cancelled, return the current code.
                    return None, False
            finally:
                self.ai_request_pending = False


    def generate_test_code(self, api_key, index, ai_provider="gemini", model=None, validation_feedback=None):
        """Generates test code for a test cell using the specified AI provider."""
        with self._lock:
            assert 0 <= index < len(self.nb.cells)
            cell = self.nb.cells[index]
            assert cell.cell_type == 'test'
            # We need the previous code cells to have valid output so the AI
            # has variable context available.
            if not self._is_previous_code_and_output_valid(index):
                raise RuntimeError("Cannot generate test code: previous output must be valid.")
            # Build context for the AI.
            instructions = cell.metadata.get('explanation')
            ai_instructions = self.nb.metadata.get('ai_instructions', '')
            if ai_instructions:
                instructions = instructions + "\n\nADDITIONAL INSTRUCTIONS:\n" + ai_instructions
            files_context = self._get_files_context()
            error_context = self._get_error_context(index)
            previous_code_cell = self._get_previous_code_cell(index)
            variable_context = self._get_variables_for_ai(previous_code_cell) if previous_code_cell else ""
            preceding_code = self._get_preceding_code_json_for_ai(index)
            previous_code = self._get_cell_w_change_noted(cell)
            # Mark that an AI request is pending.
            if self.ai_request_pending:
                raise RuntimeError("An AI request is already pending.")
            try:
                self.ai_request_pending = True
                generate_fn = AI_PROVIDERS[ai_provider]["generate_test"]
                new_code = generate_fn(
                    api_key,
                    preceding_code=preceding_code,
                    previous_code=previous_code,
                    instructions=instructions,
                    file_context=files_context,
                    error_context=error_context,
                    variable_context=variable_context,
                    validation_context=validation_feedback,
                    model=model,
                    debug=self.debug,
                    dump_ai_requests=self.dump_ai_requests)
                if self.ai_request_pending:
                    cell.source = new_code
                    cell.metadata['code_timestamp'] = datetime.datetime.now().isoformat()
                    cell.outputs = []
                    self.last_valid_test_cell = index
                    self._write()
                    return new_code, True
                else:
                    return None, False
            finally:
                self.ai_request_pending = False


    def execute_test_cell(self, index):
        """Executes a test cell using multistate_execute."""
        with self._lock:
            if index < 0 or index >= len(self.nb.cells):
                raise ExecutionError("Cell index out of range")
            cell = self.nb.cells[index]
            if cell.cell_type != 'test':
                return None

            # Build state mapping from named code cells before this index
            state_mapping = {}
            default_state = None
            for i in range(index):
                c = self.nb.cells[i]
                if c.cell_type == 'code':
                    name = c.metadata.get('name')
                    if name and c.id in self._cell_states:
                        state_mapping[f"__state__{name}"] = self._cell_states[c.id]
                    if c.id in self._cell_states:
                        default_state = self._cell_states[c.id]

            exec_id = uuid.uuid4().hex
            self._current_exec_id = exec_id
            try:
                result = self._sk_request("POST", "/multistate_execute", {
                    "code": cell.source,
                    "exec_id": exec_id,
                    "state_mapping": state_mapping,
                    "default_state": default_state,
                })
            finally:
                self._current_exec_id = None

            # Convert outputs to nbformat objects
            outputs = []
            for out in result.get("output", []):
                outputs.append(nbformat.from_dict(out))
            cell.outputs = outputs

            if result.get("error"):
                err = result["error"]
                error_output = nbformat.from_dict({
                    "output_type": "error",
                    "ename": err.get("ename", "Error"),
                    "evalue": err.get("evalue", ""),
                    "traceback": err.get("traceback", []),
                })
                if not any(o.get("output_type") == "error" for o in cell.outputs):
                    cell.outputs.append(error_output)
                self._write()
                raise CellExecutionError(
                    traceback="\n".join(err.get("traceback", [])),
                    ename=err.get("ename", "Error"),
                    evalue=err.get("evalue", ""),
                )

            cell.outputs.append(nbformat.from_dict({
                "output_type": "stream",
                "name": "stdout",
                "text": "The test passed.\n",
            }))
            self._write()
            return cell.outputs


    def generate_unit_test_cell(self, api_key, cell_index, test_name, role,
                                ai_provider="gemini", model=None, validation_feedback=None):
        """Generate code for a unit test sub-cell."""
        if role == 'target':
            return self.generate_code_cell(api_key, cell_index,
                                           ai_provider=ai_provider, model=model,
                                           validation_feedback=validation_feedback)
        assert role in ('setup', 'test'), f"Invalid role: {role}"

        with self._lock:
            assert 0 <= cell_index < len(self.nb.cells)
            target_cell = self.nb.cells[cell_index]
            tests = target_cell.metadata.get('unit_tests', {})
            assert test_name in tests
            unit_test = tests[test_name]
            # Gets the validity status for the unit test.
            test_validity = self._get_ut_validity(cell_index, test_name)

            if self.ai_request_pending:
                raise RuntimeError("An AI request is already pending.")

            # First, check that we can generate code for this role based 
            # on validity of previous code and outputs.
            # For setup, we need the prior cell code to be valid, but also we need the 
            # code of the target cell itself to be valid, so we can know which variables it reads.
            if not self._is_previous_code_and_output_valid(cell_index):
                raise RuntimeError("Cannot generate unit test code: status prior to target cell must be ready for generation.")
            if self.last_valid_code_cell < cell_index:
                raise RuntimeError("Cannot generate unit test code: target code cell code is not valid.")
            if role == 'test':
                # For a test cell, we also need the target output to be valid. 
                if not test_validity['target_output_valid']:
                    raise RuntimeError(f"Missing prerequisite for unit test code generation: role: {role}, validity: {test_validity}.")

            # Common context
            sub_cell = unit_test[role]
            ai_instructions = self.nb.metadata.get('ai_instructions', '')
            instructions = sub_cell['metadata'].get('explanation', '')
            if ai_instructions:
                instructions = instructions + "\n\nADDITIONAL INSTRUCTIONS:\n" + ai_instructions
            files_context = self._get_files_context()
            error_context = self._ut_extract_error_context(sub_cell.get('outputs', []))
            preceding_code = self._get_preceding_code_json_for_ai(cell_index, include_all_variables=False)

            # Previous code for the sub-cell being generated
            existing_source = sub_cell.get('source', '').strip()
            previous_code = (PREVIOUS_CODE_EXPLANATION_CHANGED.format(code_string=existing_source)
                             if existing_source else None)

            # Role-specific context
            if role == 'setup':
                previous_code_cell = self._get_previous_code_cell(cell_index)
                variable_context = self._get_variables_for_ai(previous_code_cell) if previous_code_cell else ""
                # Compute variables the target cell accesses that come from previous cells
                prev_variables = previous_code_cell.metadata.get('variables', {}) if previous_code_cell else {}
                prev_var_names = set(prev_variables.keys()) - set(self.default_variables.keys())
                target_accessed = self._get_target_accessed_variables(target_cell.source or '')
                relevant_vars = prev_var_names & target_accessed
                if relevant_vars:
                    relevant_info = {k: v for k, v in prev_variables.items() if k in relevant_vars}
                    variables_for_target_context = self._format_variables_for_ai(relevant_info)
                else:
                    variables_for_target_context = None
                setup_cell_context = None  # We're generating setup; previous_code already covers it
                target_cell_context = self._format_ut_subcell_for_ai(target_cell, 'target')
                test_cell_context = None
            else:
                # Role is 'test'.
                target_variables = unit_test.get('target', {}).get('variables', {})
                variable_context = self._format_variables_for_ai(target_variables)
                variables_for_target_context = None  # Only used for setup
                setup_cell_context = self._format_ut_subcell_for_ai(unit_test['setup'], 'setup')
                target_cell_context = self._format_ut_subcell_for_ai(target_cell, 'target')
                test_cell_context = None  # We're generating test; previous_code already covers it

            generate_fn = AI_PROVIDERS[ai_provider]["generate_unit_test"]

            # Call AI
            try:
                self.ai_request_pending = True
                new_code = generate_fn(
                    api_key,
                    preceding_code=preceding_code,
                    previous_code=previous_code,
                    instructions=instructions,
                    file_context=files_context,
                    error_context=error_context,
                    variable_context=variable_context,
                    validation_context=validation_feedback,
                    setup_cell_context=setup_cell_context,
                    target_cell_context=target_cell_context,
                    test_cell_context=test_cell_context,
                    variables_for_target_context=variables_for_target_context,
                    role=role,
                    model=model,
                    debug=self.debug,
                    dump_ai_requests=self.dump_ai_requests)
                if self.ai_request_pending:
                    sub_cell['source'] = new_code
                    sub_cell['metadata']['code_timestamp'] = datetime.datetime.now().isoformat()
                    sub_cell['outputs'] = []
                    test_validity = self._get_ut_validity(cell_index, test_name)
                    test_validity[f'{role}_code_valid'] = True
                    self._invalidate_unit_test(cell_index, test_name,
                                               'setup_output' if role == 'setup' else 'test_output')
                    self._write()
                    return new_code, True
                else:
                    return None, False
            finally:
                self.ai_request_pending = False


    def cancel_ai_request(self):
        """Cancels any ongoing AI request by interrupting the kernel."""
        self.ai_request_pending = False


    def validate_code_cell(self, api_key, index, ai_provider="gemini", model=None):
        """Validates the code in the cell at index using the specified AI provider."""
        with self._lock:
            if self.ai_request_pending:
                raise RuntimeError("An AI request is already pending.")
            self.ai_request_pending = True
            assert 0 <= index < len(self.nb.cells)
            cell = self.nb.cells[index]
            assert cell.cell_type in ('code', 'test')
            code_to_validate = cell.source
            instructions = cell.metadata.get('explanation')
            ai_instructions = self.nb.metadata.get('ai_instructions', '')
            if ai_instructions:
                instructions = instructions + "\n\nADDITIONAL INSTRUCTIONS:\n" + ai_instructions
            previous_code = self._get_preceding_code_json_for_ai(index, include_all_variables=(cell.cell_type == 'test'))
            previous_code_cell = self._get_previous_code_cell(index)
            variable_context = self._get_variables_for_ai(previous_code_cell) if previous_code_cell else ""
            try:
                validate_fn = AI_PROVIDERS[ai_provider]["validate"]
                validation_result = validate_fn(api_key, previous_code, code_to_validate,
                                                instructions, variable_context=variable_context,
                                                model=model, debug=self.debug,
                                                dump_ai_requests=self.dump_ai_requests)
                if self.ai_request_pending:
                    validation_result['is_hidden'] = False
                    cell.metadata['validation'] = validation_result
                    self._write()
                    return validation_result
                else:
                    return None
            finally:
                self.ai_request_pending = False


    def set_validation_visibility(self, cell_index, is_hidden):
        """Sets the visibility of the validation message for a given cell."""
        with self._lock:
            assert 0 <= cell_index < len(self.nb.cells)
            cell = self.nb.cells[cell_index]
            assert cell.cell_type in ('code', 'test'), f"Only code and test cells can have validation; got {cell.cell_type}"
            if 'validation' not in cell.metadata:
                cell.metadata['validation'] = {}
            cell.metadata['validation']['is_hidden'] = is_hidden
            self._write()


    def clear_outputs(self):
        """Clears all cell outputs and resets the last valid output index."""
        with self._lock:
            for cell in self.nb.cells:
                if cell.cell_type in ('code', 'test'):
                    cell.outputs = []
            self.last_valid_output_cell = -1
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


    def set_ai_instructions(self, instructions):
        """Sets the notebook-wide AI instructions."""
        with self._lock:
            self.nb.metadata['ai_instructions'] = instructions
            self._write()

    def get_ai_instructions(self):
        """Returns the notebook-wide AI instructions."""
        with self._lock:
            return self.nb.metadata.get('ai_instructions', '')

    def _get_files_context(self):
        """Builds the AI context including input files."""
        context_parts = [
            "Here is a list of file names and paths. "
            "The user may mention input files; to access them, the full path should be used."
            ]
        for file in self.nb.metadata.get('input_files', []):
            context_parts.append(f"* File name: {file['name']} path: {file['path']}\n")
        return "\n".join(context_parts) + "\n"


    def _get_existing_cell_names(self):
        """Returns a set of all cell names currently in the notebook.
        Must be called with self._lock held."""
        names = set()
        for cell in self.nb.cells:
            name = cell.metadata.get('name')
            if name:
                names.add(name)
        return names

    def _make_unique_name(self, name, existing_names):
        """Appends _1, _2, etc. if name already exists."""
        if name not in existing_names:
            return name
        counter = 1
        while f"{name}_{counter}" in existing_names:
            counter += 1
        return f"{name}_{counter}"

    def generate_cell_name(self, api_key, index, ai_provider, model=None):
        """Generates a unique name for a code cell based on its explanation."""
        with self._lock:
            cell = self.nb.cells[index]
            if cell.metadata.get('name'):
                return cell.metadata['name']  # Already has a name
            explanation = cell.metadata.get('explanation', '')
            if not explanation.strip():
                return None
            name_fn = AI_PROVIDERS[ai_provider]["name"]
        # Call AI outside the lock (network I/O)
        raw_name = name_fn(api_key, explanation, model=model, debug=self.debug, dump_ai_requests=self.dump_ai_requests)
        if not raw_name:
            raw_name = _generate_random_name()
        # Sanitize: split into words, keep first 3, lowercase, remove punctuation, join with underscores
        words = raw_name.split()[:3]
        words = [re.sub(r'[^a-z0-9]', '', w.lower()) for w in words]
        words = [w for w in words if w]  # Remove empty strings
        sanitized = '_'.join(words)
        if not sanitized:
            sanitized = 'cell'
        with self._lock:
            # Re-check in case another thread set it
            if cell.metadata.get('name'):
                return cell.metadata['name']
            existing = self._get_existing_cell_names()
            unique_name = self._make_unique_name(sanitized, existing)
            cell.metadata['name'] = unique_name
            self._write()
            return unique_name

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
