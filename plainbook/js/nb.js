import { createApp, ref, onMounted, onBeforeUnmount, nextTick, getCurrentInstance } from './vue.esm-browser.js';

import AppNavbar from './AppNavbar.js';
import NotebookCell from './NotebookCell.js';
import CellInsertionZone from './CellInsertionZone.js';
import SettingsModal from './SettingsModal.js';
import InfoModal from './InfoModal.js';
import UiError from './UiError.js';
import InputFile from './InputFile.js';
import NotebookHelp from './NotebookHelp.js';

createApp({
    components: { AppNavbar, NotebookCell, CellInsertionZone, SettingsModal, InfoModal, UiError, InputFile, NotebookHelp },
    setup() {
        // Extract token from URL
        const urlParams = new URLSearchParams(window.location.search);
        const authToken = urlParams.get('token');

        // 1. Initialize notebook as null
        const notebook = ref(null);
        const notebook_name = ref('');
        const loading = ref(true);
        const error = ref(null);
        const uiError = ref(null); // Error bar state
        const activeIndex = ref(-1);
        const markdownEditKey = ref({});
        const explanationEditKey = ref({});
        const isLocked = ref(false);
        const debug = ref(false);
        // For running a notebook.
        const running = ref(false);
        const last_executed_cell_index = ref(-1);
        const last_valid_code_cell_index = ref(-1);
        const last_valid_output_cell_index = ref(-1);
        const asRead = ref(true);
        // Track pending save operations so ui_* functions can wait for them.
        let pendingSaves = [];

        const trackSave = (savePromise) => {
            pendingSaves.push(savePromise);
            const cleanup = () => {
                const idx = pendingSaves.indexOf(savePromise);
                if (idx !== -1) pendingSaves.splice(idx, 1);
            };
            savePromise.then(cleanup, cleanup);
        };

        const waitForPendingSaves = async () => {
            if (pendingSaves.length > 0) {
                await Promise.allSettled([...pendingSaves]);
            }
        };

        // Dispatch flush-edits event so any in-progress editor saves its content.
        // dispatchEvent is synchronous: all listeners complete before this returns,
        // so tracked saves are visible to waitForPendingSaves() immediately after.
        const flushActiveEdits = () => {
            window.dispatchEvent(new Event('plainbook:flush-edits'));
        };

        // For settings modal
        const showSettings = ref(false);
        const geminiApiKey = ref('');
        const claudeApiKey = ref('');
        // For info modal
        const showInfo = ref(false);

        // Configure global error handler
        const app = getCurrentInstance().appContext.app;

        app.config.errorHandler = (err, instance, info) => {
            console.error("Global error:", err, instance, info);
            running.value = false;
            
            const formatError = (e) => {
                const msg = e.message || String(e);
                const stack = e.stack || '';
                return stack.includes(msg) ? stack : `${msg}\n${stack}`;
            };

            let display = formatError(err);
            // Recursively append the stack traces of the causes
            for (let cause = err.cause; cause; cause = cause.cause) {
                display += `\n\nCaused by: ${formatError(cause)}`;
            }
            console.log(display);
            uiError.value = err.message || String(err);
        };

        const updateState = (state) => {
            if (!state) return;
            console.log('Updating state:', state);
            notebook_name.value = state.name;
            last_executed_cell_index.value = state.last_executed_cell;
            last_valid_code_cell_index.value = state.last_valid_code_cell;
            last_valid_output_cell_index.value = state.last_valid_output_cell;
            isLocked.value = state.is_locked;
            if (notebook.value && notebook.value.metadata) {
                notebook.value.metadata.is_locked = state.is_locked;
            }
        };

        const apiCall = async (url, method = 'GET', body = null) => {
            const options = {
                method,
                headers: { 'Content-Type': 'application/json' }
            };
            if (body) options.body = JSON.stringify(body);
            
            const separator = url.includes('?') ? '&' : '?';
            const response = await fetch(`${url}${separator}token=${authToken}`, options);
            if (!response.ok) throw new Error(`API Error: ${response.statusText}`);
            
            const r = await response.json();
            if (r.state) updateState(r.state);
            return r;
        };

        // 2. Define the fetch logic
        const fetchNotebook = async () => {
            try {
                loading.value = true;
                const r = await apiCall('/get_notebook');
                notebook.value = r.nb;
                geminiApiKey.value = r.gemini_api_key || '';
                claudeApiKey.value = r.claude_api_key || '';
                debug.value = r.debug || false;
            } catch (err) {
                error.value = err.message;
                throw new Error("Error in loading notebook", { cause: err });
            } finally {
                loading.value = false;
                asRead.value = true;
            }
        };

        const reloadNotebook = async () => {
            await fetchNotebook();
        }

        const bumpKey = (dictRef, idx) => {
            dictRef.value = { ...dictRef.value, [idx]: (dictRef.value[idx] || 0) + 1 };
        };

        const sendDebugRequest = async () => {
            try {
                await apiCall('/debug_request', 'POST', { notebook: notebook.value });
                console.log('Debug request sent');
            } catch (err) {
                throw new Error('Debug request error', { cause: err });
            }
        };

        const sendExplanationToServer = async (content, cellIndex) => {
            asRead.value = false;
            const savePromise = (async () => {
                try {
                    await apiCall('/edit_explanation', 'POST', {
                        cell_index: cellIndex,
                        explanation: content
                    });
                    if (notebook.value && notebook.value.cells[cellIndex]) {
                        notebook.value.cells[cellIndex].metadata.explanation = content;
                    }
                    console.log('Explanation saved:', cellIndex);
                } catch (err) {
                    throw new Error('Failed to save explanation', { cause: err });
                }
            })();
            trackSave(savePromise);
            return savePromise;
        };

        const lockNotebook = async (shouldLock) => {
            try {
                await apiCall('/lock_notebook', 'POST', { is_locked: shouldLock });
                console.log('Notebook locked:', shouldLock);
            } catch (err) {
                throw new Error('Failed to lock notebook', { cause: err });
            }
        };

        const sendCodeToServer = async (content, cellIndex) => {
            asRead.value = false;
            const savePromise = (async () => {
                try {
                    await apiCall('/edit_code', 'POST', {
                        cell_index: cellIndex,
                        source: content
                    });
                    console.log('Code saved:', cellIndex);
                } catch (err) {
                    throw new Error('Failed to save code', { cause: err });
                }
            })();
            trackSave(savePromise);
            return savePromise;
        };

        const sendMarkdownToServer = async (content, cellIndex) => {
            asRead.value = false;
            try {
                await apiCall('/edit_markdown', 'POST', { 
                    cell_index: cellIndex, 
                    source: content 
                });
                console.log('Markdown saved:', cellIndex);
                if (notebook.value && notebook.value.cells[cellIndex]) {
                    notebook.value.cells[cellIndex].source = content;
                }
            } catch (err) {
                throw new Error('Failed to save markdown', { cause: err });
            }
        };


        const validateCode = async (cellIndex) => {
            if (!geminiApiKey.value) {
                throw new Error('Gemini API key is not set. Please set it in the settings.');
            };
            asRead.value = false;
            try {
                const r = await apiCall('/validate_code', 'POST', { cell_index: cellIndex });
                if (notebook.value && notebook.value.cells[cellIndex]) {
                    notebook.value.cells[cellIndex].metadata.validation = r.validation;
                    console.log('Code validation received for cell:', cellIndex, r.validation);
                }
            } catch (err) {
                throw new Error('Failed to validate code', { cause: err });
            }
        };

        const dismissValidation = async (cellIndex) => {
            try {
                await apiCall('/set_validation_visibility', 'POST', { cell_index: cellIndex, is_hidden: true });
                console.log('Validation dismissed:', cellIndex);
                if (notebook.value && notebook.value.cells[cellIndex]) {
                    notebook.value.cells[cellIndex].metadata.validation.is_hidden = true;
                }
            } catch (err) {
                throw new Error('Failed to dismiss validation', { cause: err });
            }
        };

        const setActiveCell = (idx, shouldScroll = false) => { 
            activeIndex.value = idx; 
            if (shouldScroll) {
                nextTick(() => {
                    const cells = document.querySelectorAll('.notebook-cell');
                    if (cells[idx]) {
                        cells[idx].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                    }
                });
            }
        };

        const insertCell = async (position, cellType) => {
            asRead.value = false;
            try {
                const r = await apiCall('/insert_cell', 'POST', { 
                    cell_type: cellType, 
                    index: position 
                });
                if (r.status !== 'success') throw new Error(r.message || 'Insert failed');
                const { cell, index } = r;
                if (notebook.value) {
                    notebook.value.cells.splice(index, 0, cell);
                    activeIndex.value = index;
                    // Wait for Vue to render the new component before bumping the key
                    nextTick(() => {
                        if (cellType === 'markdown') {
                            bumpKey(markdownEditKey, index);
                        } else {
                            bumpKey(explanationEditKey, index);
                        }
                    });
                }
            } catch (err) {
                throw new Error('Failed to insert cell', { cause: err });
            }
        };

        const deleteCell = async (cellIndex) => {
            asRead.value = false;
            try {
                const r = await apiCall('/delete_cell', 'POST', { cell_index: cellIndex });
                if (r.status !== 'success') throw new Error(r.message || 'Delete failed');
                if (notebook.value) {
                    notebook.value.cells.splice(cellIndex, 1);
                    // Adjust active index
                    const total = notebook.value.cells.length;
                    if (total === 0) {
                        activeIndex.value = -1;
                    } else if (activeIndex.value >= total) {
                        activeIndex.value = total - 1;
                    }
                }
            } catch (err) {
                throw new Error('Failed to delete cell', { cause: err });
            }
        };

        const moveCell = async (cellIndex, direction) => {
            asRead.value = false;
            const newIndex = cellIndex + direction;
            const total = notebook.value?.cells?.length ?? 0;
            if (newIndex < 0 || newIndex >= total) return;
            try {
                const r = await apiCall('/move_cell', 'POST', { cell_index: cellIndex, new_index: newIndex });
                if (r.status !== 'success') throw new Error(r.message || 'Move failed');
                if (notebook.value) {
                    const [cell] = notebook.value.cells.splice(cellIndex, 1);
                    notebook.value.cells.splice(newIndex, 0, cell);
                    activeIndex.value = newIndex;
                }
            } catch (err) {
                throw new Error('Failed to move cell', { cause: err });
            }
        };

        const isEditingField = (el) => {
            if (!el) return false;
            const tag = el.tagName;
            return el.isContentEditable || tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT' || tag === 'OPTION';
        };

        
        // Generate code up to the current cell. 
        const generateCode = async (cellIndex) => {
            if (!geminiApiKey.value) {
                throw new Error('Gemini API key is not set. Please set it in the settings.');
            };
            asRead.value = false;
            for (let i = last_valid_code_cell_index.value + 1; i <= cellIndex; i++) {
                if (!running.value) return; // Stop if running has been cancelled
                await generateCodeOneCell(i);
            }
        };
        
        
        // Function in charge of generating code for one cell.
        const generateCodeOneCell = async (cellIndex, force = false) => {
            const cell = notebook.value.cells[cellIndex];
            if (cell.cell_type !== 'code') return; // Only code cells
            if (!force && last_valid_code_cell_index.value >= cellIndex) return; // Already valid code
            // If I don't have valid outputs for the previous cell, I need to run it first. 
            // Those outputs are needed as context for code generation.
            if (last_valid_output_cell_index.value < cellIndex - 1 && cellIndex > 0) {
                await runCells(cellIndex - 1);
            }
            if (!running.value) return; // Stop if running has been cancelled
            asRead.value = false;
            const r = await apiCall('/generate_code', 'POST', { cell_index: cellIndex });
            if (r.status == 'success') {
                if (notebook.value && notebook.value.cells[cellIndex]) {
                    cell.source = r.code;
                    console.log('Code generated for cell:', cellIndex);
                }
            } else if (r.status == 'cancelled') {
                console.log('Code generation cancelled for cell:', cellIndex);
            } else {
                throw new Error(r.message || 'Code generation failed');
            }
        };


        // Executes cells up to the current cell. 
        const runCells = async (cellIndex) => {
            asRead.value = false;
            // First, to execute this cell we need to have valid code for it. 
            if (last_valid_code_cell_index.value < cellIndex) {
                await generateCode(cellIndex);
            }
            if (last_executed_cell_index.value === cellIndex) {
                // We can be asked to rerun the same cell again. 
                await runOneCell(cellIndex);
            } else if (last_executed_cell_index.value > cellIndex) {
                // Or, we may have executed further cells, and so be in need of a restart. 
                // We need to run from the start up to cellIndex
                await ui_resetKernel();
                await runCells(cellIndex);
            } else {
                // We run from the last run cell to the current one. 
                for (let i = last_executed_cell_index.value + 1; i <= cellIndex; i++) {
                    if (!running.value) return; // Stop if running has been cancelled
                    // If the code is not valid, generate it first.
                    if (last_valid_code_cell_index.value < i) {
                        await generateCode(i);
                    }
                    if (!running.value) return; // Stop if running has been cancelled
                    // Runs this specific cell. 
                    await runOneCell(i);
                }
            }
        };


        // Function in charge of running one cell in the notebook.
        const runOneCell = async (cellIndex) => {
            if (cellIndex < 0 || cellIndex >= notebook.value.cells.length) return;
            const cell = notebook.value.cells[cellIndex];
            if (cell.cell_type !== 'code') return; // Only run code cells
            if (!running.value) return; // Stop if running has been cancelled
            asRead.value = false;
            const r = await apiCall('/execute_cell', 'POST', { cell_index: cellIndex });
                if (r.status === 'error') {
                    throw new Error(r.message || 'Execution failed');
                } 
                cell.outputs = r.outputs;
                console.log('Cell executed:', cellIndex, r.details);
                if (r.details === 'CellExecutionError') {
                    // The cell executed, but we have to stop other further
                    // cells from executing.
                    if(r.outputs[0].ename === 'ModuleNotFoundError') {
                        throw new Error('A package is required by this code cell. Please install the necessary packages via this command on your local environment: pip install ' + r.outputs[0].evalue.split("'")[1]);
                    } else if (r.outputs[0].ename === 'FileNotFoundError') {
                        throw new Error('The notebook cannot find a file it needs. Please select all the required input files using the selector at the top, so that the AI knows where to find them, and re-generate the code. If the files are already selected, you might want to refer to them in a more precise way, for instance citing their full name.');
                    } else {
                        throw new Error("Execution error: " + r.outputs[0].ename);
                    }
                }
        };


        // These are the UI functions that cause the "running" to display. 
        // The important fact is that these cannot be re-entrant.

        const ui_saveExplanationAndRun = async (content, cellIndex) => {
            await sendExplanationToServer(content, cellIndex);
            if (!running.value) {
                running.value = true;
                await generateCode(cellIndex);
                await runCells(cellIndex);
                running.value = false;
            }
        };


        const ui_runCell = async (cellIndex) => {
            flushActiveEdits();
            await waitForPendingSaves();
            if (!running.value) {
                running.value = true;
                await runCells(cellIndex);
                running.value = false;
            }
        };


        const ui_resetAndRunAllCells = async () => {
            asRead.value = false;
            flushActiveEdits();
            await waitForPendingSaves();
            if (!running.value) {
                running.value = true;
                await ui_resetKernel();
                await runCells(notebook.value.cells.length - 1);
                running.value = false;
            }
        };


        const ui_forceRegenerateCellCode = async (cellIndex) => {
            asRead.value = false;
            flushActiveEdits();
            await waitForPendingSaves();
            if (!running.value) {
                running.value = true;
                await generateCodeOneCell(cellIndex, true);
                running.value = false;
            }
        };


        const ui_interruptKernel = async () => {
            try {
                running.value = false;
                await apiCall('/interrupt_kernel', 'POST');
                console.log('Kernel interrupted');
            } catch (err) {
                throw new Error('Interrupt error', { cause: err });
            }
        };


        const ui_resetKernel = async () => {
            try {
                await apiCall('/reset_kernel', 'POST');
                console.log('Kernel reset');
            } catch (err) {
                throw new Error('Reset error', { cause: err });
            }
        };


        const handleKeydown = (e) => {
            const total = notebook.value?.cells?.length ?? 0;
            if (total === 0) return;

            if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                if (isEditingField(e.target)) return;
                e.preventDefault();
                const delta = e.key === 'ArrowDown' ? 1 : -1;
                const current = activeIndex.value < 0 ? 0 : activeIndex.value;
                const next = Math.min(Math.max(current + delta, 0), total - 1);
                if (next !== activeIndex.value) setActiveCell(next, true);
                return;
            }

            if (e.key === 'Enter' && e.shiftKey) {
                if (!notebook.value || activeIndex.value < 0) return;
                e.preventDefault();
                const next = Math.min(activeIndex.value + 1, total - 1);
                if (next !== activeIndex.value) setActiveCell(next);
            }
        };

        const saveSettings = async (keys) => {
            // Save the API keys to the server
            try {
                await apiCall('/set_key', 'POST', {
                    gemini_api_key: keys.gemini_api_key,
                    claude_api_key: keys.claude_api_key,
                });
                console.log('API keys saved successfully');
            } catch (err) {
                throw new Error('Error saving API keys', { cause: err });
            }
            geminiApiKey.value = keys.gemini_api_key;
            claudeApiKey.value = keys.claude_api_key;
        };

        const genError = () => {
            throw new Error('This is a generated error for testing purposes. This is a generated error for testing purposes. This is a generated error for testing purposes. This is a generated error for testing purposes. ');
        }

        const closeUiError = () => {
            uiError.value = null;
        };

        const handleClickOutside = (event) => {
            const container = document.querySelector('.notebook-container');
            if (container && !container.contains(event.target)) {
                activeIndex.value = -1;
            }
        };

        onMounted(() => {
            fetchNotebook();
            window.addEventListener('keydown', handleKeydown);
            window.addEventListener('click', handleClickOutside);
        });

        onBeforeUnmount(() => {
            window.removeEventListener('keydown', handleKeydown);
            window.removeEventListener('click', handleClickOutside);
        });

        return { notebook, notebook_name, loading, error, isLocked, lockNotebook,
            sendExplanationToServer, authToken,
            sendCodeToServer, ui_saveExplanationAndRun,
            sendMarkdownToServer, generateCode, activeIndex, reloadNotebook,
            validateCode, dismissValidation, ui_resetAndRunAllCells, ui_forceRegenerateCellCode,
            setActiveCell, ui_runCell, running, asRead,
            ui_interruptKernel, insertCell, markdownEditKey,
            last_executed_cell_index, last_valid_code_cell_index, last_valid_output_cell_index,
            saveSettings, showSettings, showInfo, 
            genError, uiError, closeUiError, debug, sendDebugRequest,
            explanationEditKey, deleteCell, moveCell, geminiApiKey, claudeApiKey };
    },

template: `#app-template`,
}).mount('#app');
