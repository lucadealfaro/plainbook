import json
import secrets
import socket
import subprocess
import sys
import time
import uuid

import nbformat
import requests

from .plainbook_base import (
    PlainbookAbstract, ExecutionError, VARIABLE_INSPECTION_CODE
)


class Plainbook_SnapshotKernel(PlainbookAbstract):
    """Plainbook implementation using the snapshot kernel.

    Snapshot state names are stored in an in-memory dictionary (self._cell_states)
    mapping cell.id to state name. This avoids persisting stale state names to disk
    when the notebook is saved. Re-execution starts from the snapshot before the
    affected cell rather than requiring a full kernel restart.
    """

    def __init__(self, notebook_path, debug=False):
        super().__init__(notebook_path, debug)
        self._sk_token = secrets.token_hex(16)
        self._sk_port = self._find_free_port(start=9100)
        self._sk_base_url = f"http://127.0.0.1:{self._sk_port}"
        self._current_exec_id = None
        self._cell_states = {}
        self._sk_process = subprocess.Popen(
            [sys.executable, "-m", "snapshot_kernel.main",
             "--bind", f"127.0.0.1:{self._sk_port}",
             "--token", self._sk_token],
            stdout=None if debug else subprocess.PIPE,
            stderr=None if debug else subprocess.PIPE,
        )
        self._wait_for_server()
        self._finalize_init()

    # Compatibility properties for main.py assertions

    @property
    def kc(self):
        return self

    @property
    def km(self):
        return self

    def is_alive(self):
        return self._sk_process is not None and self._sk_process.poll() is None

    # HTTP helpers

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

    # Finding the input state for a cell

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

    # Abstract method implementations

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
                # Raise CellExecutionError-compatible exception for main.py
                from nbclient.exceptions import CellExecutionError
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

    def _get_variables(self):
        """Execute the variable inspection code against the last executed state."""
        # Find the most recent valid state
        state_name = None
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
