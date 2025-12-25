import atexit
import asyncio
import os
import threading

# Notebook imports
from jupyter_client import KernelManager
from nbclient import NotebookClient
from nbclient.exceptions import CellExecutionError
import nbformat


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
            print(f"Executing cell {index} with last executed cell {self.last_executed_cell}...")
            if index < 0 or index >= len(self.nb.cells):
                raise IndexError("Cell index out of range")
            cell = self.nb.cells[index]
            if cell.cell_type != 'code':
                return None, "Not a code cell"
            if index <= self.last_executed_cell:
                return cell.outputs, "Cached"
            if index > self.last_executed_cell + 1:
                raise ExecutionError("Cannot execute cell out of order")
            try:
                # For some reason, the client may have forgotten the kernel client
                # due to threading. 
                self._heal_client()
                self.client.execute_cell(cell, index)
                self.last_executed_cell = index
                return cell.outputs, 'ok'
            except CellExecutionError as e:
                raise ExecutionError(f"Error executing cell {index}: {str(e)}")
            
    def reset_kernel(self):
        """Resets the kernel."""
        with self._lock:
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
            print("Kernel reset successfully.")
            
    def interrupt_kernel(self):
        if self.km and self.km.is_alive():
            print("Interrupting kernel...")
            self.km.interrupt_kernel()
                        
    def get_cell_json(self, index):
        """Returns the JSON representation of a cell by index."""
        if index < 0 or index >= len(self.nb.cells):
            raise IndexError("Cell index out of range")
        return self.nb.cells[index]
    
    def get_json(self):
        """Returns the JSON representation of the entire notebook."""
        return self.nb
        
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
