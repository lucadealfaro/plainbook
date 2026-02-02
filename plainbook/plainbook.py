import atexit
import asyncio
import json
import os
import threading
from functools import wraps
from types import SimpleNamespace

# Notebook imports
from jupyter_client import KernelManager
from nbclient import NotebookClient
from nbclient.exceptions import CellExecutionError
import nbformat
from nbclient.util import run_sync

from .gemini import gemini_generate_code, gemini_validate_code

def add_state(func):
    @wraps(func)
    def wrapper(self, *args, **kwargs):
        r = func(self, *args, **kwargs)
        s = self.get_state()
        return SimpleNamespace(r=r, s=s)
    return wrapper

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

    
class Plainbook(object):
    """This class implements an Plainbook and its operations."""
    
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
        self.last_valid_output = -1
        # Loads the notebook from disk.
        self._load_notebook()
        self._filter_input_files()
        # Starts the kernel.
        self.km = KernelManager()
        self.km.start_kernel()
        self.kc = self.km.client()
        self.kc.start_channels()
        self.client = NotebookClient(nb=self.nb, km=self.km, kc=self.kc)
        self.client.setup_kernel()
        assert self.km.is_alive(), "Kernel failed to start"
        assert self.client is not None, "Notebook client failed to start"
        # AI request tracker, so we can interrupt if needed.
        self.ai_request_pending = False
        # We track the default variables, so we do not include them in the context.
        self.default_variables = self._get_variables()
        # Register the cleanup function
        atexit.register(self._shutdown)

    def _load_notebook(self):
        """Loads the notebook from the specified path. If the file is missing, create an empty notebook."""
        try:
            with open(self.path) as f:
                self.nb = nbformat.read(f, as_version=4)
                for cell in self.nb.cells:
                    cell.source = tostring(cell.source)
                    if cell.cell_type == 'code':
                        if 'explanation' not in cell.metadata:
                            cell.metadata['explanation'] = ""
                        else:
                            cell.metadata['explanation'] = tostring(cell.metadata['explanation'])
                        if 'codegen' not in cell.metadata:
                            cell.metadata['codegen'] = False                        
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
        self.last_executed_cell = self.nb.metadata.get('last_executed_cell', -1)
        self.last_valid_code_cell = self.nb.metadata.get('last_valid_code_cell', -1) 
        self.last_valid_output = self.nb.metadata.get('last_valid_output', -1)
                  
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
        self.nb.metadata['last_executed_cell'] = self.last_executed_cell
        self.nb.metadata['last_valid_code_cell'] = self.last_valid_code_cell
        self.nb.metadata['last_valid_output'] = self.last_valid_output
        with open(self.path, "w") as f:
            nbformat.write(self.nb, f)
            
    def get_state(self):
        """Returns a dictionary representing the notebook state."""
        return {
            'name': self.name,
            'path': self.path,
            'num_cells': len(self.nb.cells),
            'last_executed_cell': self.last_executed_cell,
            'last_valid_code_cell': self.last_valid_code_cell,
            'last_valid_output': self.last_valid_output,
            'is_locked': self.nb.metadata.get('is_locked', False),
        }
                
    def get_cell_json(self, index):
        """Returns the JSON representation of a cell by index."""
        if index < 0 or index >= len(self.nb.cells):
            raise IndexError("Cell index out of range")
        return self.nb.cells[index]
    
    def get_json(self):
        """Returns the JSON representation of the entire notebook."""
        return self.nb
    
    # Execution-related methods
                    
    def _heal_client(self):
        # 1. Ensure the NotebookClient has the KernelClient reference
        if self.client.kc is None:
            self.client.kc = self.kc
        # 2. HEALING STEP: Check if sockets are actually alive
        # If the shell_channel socket is None, the channels have dropped.
        try:
            if not self.kc.shell_channel.socket:
                print("Re-starting dropped channels...")
                self.kc.start_channels()
        except (AttributeError, RuntimeError):
            # In case the channel object itself isn't fully initialized
            self.kc.start_channels()
        # 3. Ensure the NotebookClient internal state is synchronized
        # This re-binds the internal managers used by async_execute_cell
        if not hasattr(self.client, 'km') or self.client.km is None:
            self.client.km = self.km
            
    def _get_variables(self):
        """Returns a dictionary of variables and their information in the kernel."""
        self._heal_client()
        self.client.kc.execute(VARIABLE_INSPECTION_CODE)
        
        result_json = ""
        try:
            while True:
                msg = self.client.kc.get_iopub_msg(timeout=5)
                if msg['msg_type'] == 'stream' and msg['content']['name'] == 'stdout':
                    result_json += msg['content']['text']
                if msg['msg_type'] == 'status' and msg['content']['execution_state'] == 'idle':
                    break
        except Exception:
            pass
        try:
            return json.loads(result_json)
        except (json.JSONDecodeError, TypeError):
            return {}
    
    def execute_cell(self, index):
        """Executes a code cell by index and returns the output."""
        with self._lock:
            if index < 0 or index >= len(self.nb.cells):
                raise ExecutionError("Cell index out of range")
            cell = self.nb.cells[index]
            if cell.cell_type != 'code':
                return None, "Not a code cell"
            if index <= self.last_executed_cell:
                return cell.outputs, "Cached"
            # Checks that all intervening cells between last_executed_cell and index are non-code.
            for i in range(self.last_executed_cell + 1, index):
                if self.nb.cells[i].cell_type == 'code':
                    raise ExecutionError("Cannot execute cell out of order")
            # For some reason, the client may have forgotten the kernel client
            # due to threading. 
            self._heal_client()
            self.client.execute_cell(cell, index)
            self.last_executed_cell = index
            self.last_valid_output = index
            # Saves the information about the variables. 
            # This is used for AI context if we need to regenerate code.
            cell.metadata['variables'] = self._get_variables()
            self._write()
            return cell.outputs, 'ok'
            
    def reset_kernel(self):
        """Resets the kernel."""
        print("Request to reset kernel received...")
        with self._lock:
            print("Resetting kernel...")
            self._reset_kernel()
            
    def _reset_kernel(self):        
        self._heal_client()
        if self.debug:
            print("Resetting kernel and creating new client...")
        # 1. Properly stop and discard the old client
        if self.kc:
            try:
                self.kc.stop_channels()
            except Exception:
                pass # Already stopped or dead
        # 2. Shutdown the old kernel process
        if self.km:
            self.km.shutdown_kernel(now=True)
        if hasattr(self.km, 'context') and self.km.context:
            try:
                self.km.context.destroy(linger=0)
            except Exception:
                pass
        # 3. Initialize a NEW KernelManager
        self.km = KernelManager()
        self.km.start_kernel()
        # 4. OBTAIN A NEW CLIENT INSTANCE
        # Overwriting self.kc with a fresh object is mandatory here.
        self.kc = self.km.client()
        # 5. Start channels on the NEW client (this will NOT error)
        self.kc.start_channels()
        # 5b. Wait for the kernel to respond to a heartbeat
        # This prevents the iopub_channel.get_msg hang.
        try:
            self.kc.wait_for_ready(timeout=5) 
        except Exception as e:
            print(f"Kernel failed to become ready: {e}")
            raise e
        # 6. Update the NotebookClient with the new references
        self.client.km = self.km
        self.client.kc = self.kc
        # 7. Re-initialize the internal async state
        self.client.setup_kernel()
        self.last_executed_cell = -1
        # Note that we do not reset last_valid_code_cell or last_valid_output,
        # as the code is still valid, just not executed.
        if self.debug:
            print("Kernel reset complete.")
            
    def interrupt_kernel(self):
        if self.km and self.km.is_alive():
            if self.debug:
                print("Interrupting kernel...")
            self.km.interrupt_kernel()
                        
    def _old_shutdown(self):
            """Cleanly shuts down the kernel and closes channels."""
            print(f"Shutting down kernel for {self.name}...")
            try:
                if hasattr(self, 'kc'):
                    self.kc.stop_channels()
                if hasattr(self, 'km'):
                    self.km.shutdown_kernel(now=True)
            except Exception as e:
                print(f"Error during kernel shutdown: {e}")
            try:
                loop = asyncio.get_event_loop()
                if loop.is_running():
                    loop.stop()
                # Closing the loop prevents the ResourceWarning
                if not loop.is_closed():
                    loop.close()
            except RuntimeError:
                # Loop already closed or doesn't exist
                pass

    def _shutdown(self):
        # 1. Shutdown the Kernel Client (Channels)
        if hasattr(self, 'kc') and self.kc:
            try:
                # If using Async client, this should ideally be awaited
                self.kc.stop_channels()
            except Exception as e:
                print(f"Error stopping channels: {e}")

        # 2. Shutdown the Kernel Manager (The actual process)
        if hasattr(self, 'km') and self.km:
            try:
                # Ensure the process is killed
                self.km.shutdown_kernel(now=True)
                
                # Explicitly cleanup the ZMQ context to release ports/threads
                if hasattr(self.km, 'context') and self.km.context:
                    self.km.context.destroy(linger=0)
            except Exception as e:
                print(f"Error shutting down kernel process: {e}")

        # 3. Handle the Event Loop (Only if you are the owner)
        try:
            loop = asyncio.get_event_loop()
            if loop.is_running():
                # Stop any pending tasks before stopping the loop
                for task in asyncio.all_tasks(loop):
                    task.cancel()
                loop.stop()
            if not loop.is_closed():
                loop.close()
        except Exception:
            pass

        # 4. Final Cleanup of threads (Optional but safe)
        # This prevents 'threading' from waiting for non-daemon threads to exit
        for thread in threading.enumerate():
            if thread is not threading.current_thread() and thread.daemon is False:
                print(f"Warning: Non-daemon thread {thread.name} still active.")

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
                new_cell.metadata['codegen'] = False
            self.nb.cells.insert(index, new_cell)
            # Inserting code cells before the last executed cell requires resetting the kernel.
            if cell_type == 'code':
                if index <= self.last_executed_cell:
                    self._reset_kernel()
                self.last_valid_code_cell = min(self.last_valid_code_cell, index - 1)
                self.last_valid_output = min(self.last_valid_output, index - 1)
            self._write()
            return new_cell, index
    
    
    def delete_cell(self, index):
        """Delete the cell at the given index."""
        with self._lock:
            if index < 0 or index >= len(self.nb.cells):
                raise IndexError("Cell index out of range")
            cell = self.nb.cells[index]
            # Update execution pointer: reset kernel if code was executed, otherwise shift index
            if index <= self.last_executed_cell:
                if cell.cell_type == 'code':
                    self._reset_kernel()
                else:
                    self.last_executed_cell -= 1
            # Update validation pointer: cap if code cell, shift if markdown cell
            if cell.cell_type == 'code':
                self.last_valid_code_cell = min(self.last_valid_code_cell, index - 1)
                self.last_valid_output = min(self.last_valid_output, index - 1)
            else:
                if index <= self.last_valid_code_cell:
                    self.last_valid_code_cell -= 1
                if index <= self.last_valid_output:
                    self.last_valid_output -= 1
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
                    # Moving a code cell that has been executed may require a reset.
                    # TODO: More fine-grained logic could be applied here, to check if all 
                    # intervening cells are non-code.
                    self._reset_kernel()
                self.last_valid_code_cell = min(self.last_valid_code_cell, affected_idx - 1)
                self.last_valid_output = min(self.last_valid_output, affected_idx - 1)
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
                if self.last_valid_output >= index:
                    self.last_valid_output -= 1
                if self.last_valid_output >= new_index:
                    self.last_valid_output += 1
            self._write()
            
    # Cell editing methods
    
    def set_cell_source(self, index, source):
        """Sets the source code of a cell at the given index."""
        with self._lock:
            assert 0 <= index < len(self.nb.cells)
            cell = self.nb.cells[index]
            cell.source = source
            if cell.cell_type == 'code':
                cell.metadata['codegen'] = False
                # Reset outputs and execution count on code cell edit
                cell.outputs = []
                if index <= self.last_executed_cell:
                    # We need to restart. 
                    self._reset_kernel()
                # The user has updated the code.  We will assume this 
                # cell to be valid, if it was before. 
                # However, any following code cells are now invalid.
                self.last_valid_code_cell = min(self.last_valid_code_cell, index)
                # The output is now stale. 
                self.last_valid_output = min(self.last_valid_output, index - 1)
            self._write()


    def set_cell_explanation(self, index, explanation):
        """Sets the explanation of a code cell at the given index."""
        with self._lock:
            assert 0 <= index < len(self.nb.cells)
            cell = self.nb.cells[index]
            assert cell.cell_type == 'code'
            cell.metadata['explanation'] = explanation
            cell.metadata['codegen'] = False
            # The cell code is now considered stale. 
            self.last_valid_code_cell = min(self.last_valid_code_cell, index - 1)
            self.last_valid_output = min(self.last_valid_output, index - 1)
            self._write()
            
            
    # Methods to support AI
    
    def _get_cell_for_ai(self, index):
        """Returns the JSON of a cell for AI processing.
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
                
    def _get_variables_for_ai(self, index):
        """Returns a formatted text summary of variables in the kernel 
        that are defined just _before_ the cell at index is executed. 
        This is used to provide context for the code at the current cell."""

        assert 0 <= index < len(self.nb.cells)
        # Finds the last code cell before index.
        prev_code_cell_idx = -1
        for i in range(index - 1, -1, -1):
            cell = self.nb.cells[i]
            if cell.cell_type == 'code':
                prev_code_cell_idx = i
                break
        if prev_code_cell_idx == -1:
            # There are no previous code cells, so no variables.
            return ""
        variables = self.nb.cells[prev_code_cell_idx].metadata.get('variables', {})
        lines = []
        for name, info in variables.items():
            # Skip default variables. 
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
            

    def _get_code_for_ai(self, index):
        """Returns the concatenated source code of all previous code cells for context."""
        previous_code = [self._get_cell_for_ai(i) for i in range(index)]
        return "\n".join(previous_code)
        

    def generate_code_cell(self, api_key, index):
        """Generates code for the cell at index using Gemini."""
        with self._lock:
            assert 0 <= index < len(self.nb.cells)
            cell = self.nb.cells[index]
            assert cell.cell_type == 'code'
            # We can generate code only when: 
            # - Execution is up to date for the previous code cell.
            # - The code itself is up to date at least for the previous code cell.
            # To check this, let's find the last code cell before index.
            last_code_cell_idx = -1
            for i in range(index - 1, -1, -1):
                if self.nb.cells[i].cell_type == 'code':
                    last_code_cell_idx = i
                    break
            # if self.last_valid_code_cell < last_code_cell_idx:
            #     raise RuntimeError("Cannot generate code: previous code must all be valid.")
            # if self.last_executed_cell < last_code_cell_idx:
            #     raise RuntimeError("Cannot generate code: the previous code cell was not executed.")
                        
            # TODO: We need also to get the previous outputs. 
            instructions = cell.metadata.get('explanation')
            files_context = self._get_files_context()
            error_context = self._get_error_context(index)
            variable_context = self._get_variables_for_ai(index)
            previous_code = self._get_code_for_ai(index)
            # Mark that an AI request is pending
            if self.ai_request_pending:
                raise RuntimeError("An AI request is already pending.")
            try:
                self.ai_request_pending = True
                new_code = gemini_generate_code(
                    api_key, previous_code=previous_code, instructions=instructions,
                    file_context=files_context, error_context=error_context,
                    variable_context=variable_context, 
                    debug=self.debug)
                # If we are still in a request, update the cell.
                if self.ai_request_pending:
                    cell.source = new_code
                    cell.metadata['codegen'] = True
                    # Reset outputs and execution count
                    cell.outputs = []
                    if index <= self.last_executed_cell:
                        self._reset_kernel()
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

        
    def validate_code_cell(self, api_key, index):
        """Validates the code in the cell at index using Gemini."""
        with self._lock:
            if self.ai_request_pending:
                raise RuntimeError("An AI request is already pending.")
            self.ai_request_pending = True
            assert 0 <= index < len(self.nb.cells)
            cell = self.nb.cells[index]
            assert cell.cell_type == 'code'
            code_to_validate = cell.source
            instructions = cell.metadata.get('explanation')
            previous_code = self._get_code_for_ai(index)
            variable_context = self._get_variables_for_ai(index)
            try:
                validation_result = gemini_validate_code(api_key, previous_code, code_to_validate, 
                                                         instructions, variable_context=variable_context,
                                                         debug=self.debug)
                # For uniformity, usesless to have the various AI code take care of this.
                validation_result['is_hidden'] = False
                cell.metadata['validation'] = validation_result
                self._write() # For persistence
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
    