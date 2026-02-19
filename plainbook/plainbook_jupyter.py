import asyncio
import json
import threading

# Notebook imports
from jupyter_client import KernelManager
from nbclient import NotebookClient
from nbclient.util import run_sync

from .plainbook_base import PlainbookAbstract, ExecutionError, VARIABLE_INSPECTION_CODE


class PlainbookJupyter(PlainbookAbstract):
    """Plainbook implementation using the standard Jupyter kernel."""

    def __init__(self, notebook_path, debug=False):
        super().__init__(notebook_path, debug)
        # Start Jupyter kernel
        self.km = KernelManager()
        self.km.start_kernel()
        self.kc = self.km.client()
        self.kc.start_channels()
        self.client = NotebookClient(nb=self.nb, km=self.km, kc=self.kc)
        self.client.setup_kernel()
        assert self.km.is_alive(), "Kernel failed to start"
        assert self.client is not None, "Notebook client failed to start"
        self._finalize_init()

    # Jupyter-specific methods

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
            # For some reason, the client may have forgotten the kernel client
            # due to threading.
            self._heal_client()
            self.client.execute_cell(cell, index)
            self.last_executed_cell = index
            self.last_valid_output_cell = max(index, self.last_valid_output_cell)
            # Saves the information about the variables.
            # This is used for AI context if we need to regenerate code.
            cell.metadata['variables'] = self._get_variables()
            self._write()
            return cell.outputs, 'ok'

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
        self.kc = self.km.client()
        # 5. Start channels on the NEW client
        self.kc.start_channels()
        # 5b. Wait for the kernel to respond to a heartbeat
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

    def _invalidate_execution(self, index):
        """For Jupyter, any invalidation requires a full kernel reset."""
        self._reset_kernel()

    def interrupt_kernel(self):
        if self.km and self.km.is_alive():
            if self.debug:
                print("Interrupting kernel...")
            self.km.interrupt_kernel()

    def _shutdown(self):
        # 1. Shutdown the Kernel Client (Channels)
        if hasattr(self, 'kc') and self.kc:
            try:
                self.kc.stop_channels()
            except Exception as e:
                print(f"Error stopping channels: {e}")

        # 2. Shutdown the Kernel Manager (The actual process)
        if hasattr(self, 'km') and self.km:
            try:
                self.km.shutdown_kernel(now=True)
                if hasattr(self.km, 'context') and self.km.context:
                    self.km.context.destroy(linger=0)
            except Exception as e:
                print(f"Error shutting down kernel process: {e}")

        # 3. Handle the Event Loop
        try:
            loop = asyncio.get_event_loop()
            if loop.is_running():
                for task in asyncio.all_tasks(loop):
                    task.cancel()
                loop.stop()
            if not loop.is_closed():
                loop.close()
        except Exception:
            pass

        # 4. Final Cleanup of threads
        for thread in threading.enumerate():
            if thread is not threading.current_thread() and thread.daemon is False:
                print(f"Warning: Non-daemon thread {thread.name} still active.")
