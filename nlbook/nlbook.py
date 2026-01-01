import atexit
import asyncio
import os
import threading

# Notebook imports
from jupyter_client import KernelManager
from nbclient import NotebookClient
from nbclient.exceptions import CellExecutionError
import nbformat

from .gemini import generate_notebook_cell


class ExecutionError(Exception):
    """Custom exception for execution errors in LNBook."""
    pass

class NLBook(object):
    """This class implements an LNBook and its operations."""
    
    def __init__(self, notebook_path):
        print(f"Initializing LNBook for {notebook_path}...")
        self.path = notebook_path
        self.name = os.path.splitext(os.path.basename(notebook_path))[0]
        self.nb = None
        self._lock = threading.Lock()
        self.last_executed_cell = -1
        self.load_notebook()
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
        # Register the cleanup function
        atexit.register(self._shutdown)

    def load_notebook(self):
        """Loads the notebook from the specified path."""
        with open(self.path) as f:
            self.nb = nbformat.read(f, as_version=4)
            # DEBUG: Adds explanations to each code cell.
            for cell in self.nb.cells:
                if cell.cell_type == 'code':
                    explanation = [
                        "This cell does something interesting.\n",
                        " * It is nice to look at\n",
                        " * It might be even interesting to understand\n",
                    ]
                    cell.metadata['explanation'] = explanation
            self.last_executed_cell = self.nb.metadata.get('last_executed_cell', -1)
                    
    def _write(self):
        self.nb.metadata['last_executed_cell'] = self.last_executed_cell
        pass # For now, we do not write back to disk.
    
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
            if index > self.last_executed_cell + 1:
                raise ExecutionError("Cannot execute cell out of order")
            # For some reason, the client may have forgotten the kernel client
            # due to threading. 
            self._heal_client()
            self.client.execute_cell(cell, index)
            self.last_executed_cell = index
            self._write()
            return cell.outputs, 'ok'
            
    def reset_kernel(self):
        """Resets the kernel."""
        with self._lock:
            self._reset_kernel()
            
    def _reset_kernel(self):        
        self._heal_client()
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
        # 6. Update the NotebookClient with the new references
        self.client.km = self.km
        self.client.kc = self.kc
        # 7. Re-initialize the internal async state
        self.client.setup_kernel()
        self.last_executed_cell = -1
            
    def interrupt_kernel(self):
        if self.km and self.km.is_alive():
            print("Interrupting kernel...")
            self.km.interrupt_kernel()
                        
    def _shutdown(self):
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

    # Cell insertion, deletion, and movement methods

    def insert_cell(self, index, cell_type):
        """Insert a new cell at index with given type ('markdown' or 'code'). Returns the cell json."""
        with self._lock:
            assert cell_type in ('markdown', 'code')
            assert 0 <= index <= len(self.nb.cells)
            if cell_type == 'markdown':
                new_cell = nbformat.v4.new_markdown_cell(source="")
            else:
                new_cell = nbformat.v4.new_code_cell(source="", execution_count=None, outputs=[])
                new_cell.metadata['explanation'] = ["Write the explanation here.\n"]
            self.nb.cells.insert(index, new_cell)
            # Inserting code cells before the last executed cell requires resetting the kernel.
            if cell_type == 'code' and index <= self.last_executed_cell:
                self._reset_kernel()
            self._write()
            return new_cell, index
    
    def delete_cell(self, index):
        """Delete the cell at the given index."""
        with self._lock:
            if index < 0 or index >= len(self.nb.cells):
                raise IndexError("Cell index out of range")
            cell = self.nb.cells[index]
            if self.last_executed_cell >= index:
                if cell.cell_type == 'code':
                    # Deleting a code cell that has been executed requires a reset.
                    self._reset_kernel()
                else:
                    # Adjust the last executed cell index
                    self.last_executed_cell -= 1
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
                if self.last_executed_cell >= min(index, new_index):
                    # Moving a code cell that has been executed may require a reset.
                    # TODO: More fine-grained logic could be applied here, to check if all 
                    # intervening cells are non-code.
                    self._reset_kernel()
            else:
                # Adjust the last executed cell index if needed.
                if self.last_executed_cell >= index:
                    self.last_executed_cell -= 1
                if self.last_executed_cell >= new_index:
                    self.last_executed_cell += 1
            self._write()
            
    # Cell editing methods
    
    def set_cell_source(self, index, source):
        """Sets the source code of a cell at the given index."""
        with self._lock:
            assert 0 <= index < len(self.nb.cells)
            self.nb.cells[index].source = source
            if self.nb.cells[index].cell_type == 'code':
                # Reset outputs and execution count on code cell edit
                self.nb.cells[index].outputs = []
                if index <= self.last_executed_cell:
                    # We need to restart. 
                    self._reset_kernel()
            self._write()

    def set_cell_explanation(self, index, explanation):
        """Sets the explanation of a code cell at the given index."""
        with self._lock:
            assert 0 <= index < len(self.nb.cells)
            cell = self.nb.cells[index]
            assert cell.cell_type == 'code'
            cell.metadata['explanation'] = explanation
            self._write()
            
    # Methods to support AI
    
    def _get_cell_for_ai(self, index):
        """Returns the JSON of a cell for AI processing.
        Needs to be called with the lock held."""
        cell = self.nb.cells[index]
        if cell.cell_type == 'code':
            explanation = cell.metadata.get('explanation', [])
            explanation = ["# " + line for line in explanation]
            explanation_text = "\n".join(explanation) + "\n"
            code_text = "\n".join(cell.source)
            return explanation_text + code_text
        elif cell.cell_type == 'markdown':
            return "\n".join(["# " + line for line in cell.source])
        else:
            return ""

    def _get_code_for_ai(self, index):
        """Returns the concatenated source code of all previous code cells for context."""
        previous_code = [self._get_cell_for_ai(i) for i in range(index)]
        return "\n".join(previous_code)
        
    def generate_cell(self, index, api_key):
        """Generates code for the cell at index using Gemini."""
        with self._lock:
            if self.ai_request_pending:
                raise RuntimeError("An AI request is already pending.")
            self.ai_request_pending = True
            assert 0 <= index < len(self.nb.cells)
            cell = self.nb.cells[index]
            assert cell.cell_type == 'code'
            instructions = cell.metadata.get('explanation')
            previous_code = self._get_code_for_ai(index)
            # Mark that an AI request is pending
            try:
                new_code = generate_notebook_cell(api_key, previous_code, instructions)
                # If we are still in a request, update the cell.
                if self.ai_request_pending:
                    cell.source = new_code
                    # Reset outputs and execution count
                    cell.outputs = []
                    if index <= self.last_executed_cell:
                        self._reset_kernel()
                    self._write()
                    return new_code
                else:
                    return None
            finally:
                self.ai_request_pending = False

    def cancel_ai_request(self):
        """Cancels any ongoing AI request by interrupting the kernel."""
        self.ai_request_pending = False
        
        