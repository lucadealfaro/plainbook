import { createApp, ref, onMounted, onBeforeUnmount, nextTick, getCurrentInstance } from './vue.esm-browser.js';

import AppNavbar from './AppNavbar.js';
import NotebookCell from './NotebookCell.js';
import CellInsertionZone from './CellInsertionZone.js';
import SettingsModal from './SettingsModal.js';
import InfoModal from './InfoModal.js';
import UiError from './UiError.js';
import InputFile from './InputFile.js';

createApp({
    components: { AppNavbar, NotebookCell, CellInsertionZone, SettingsModal, InfoModal, UiError, InputFile },
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

        // Configure global error handler
        const app = getCurrentInstance().appContext.app;
        app.config.errorHandler = (err, instance, info) => {
            console.error("Global error:", err, instance, info);
            
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

        // For running a notebook.
        const running = ref(false);
        const lastRunIndex = ref(-1);
        const lastValidCodeCell = ref(-1);
        const lastValidOutput = ref(-1);
        const asRead = ref(true);

        // For settings modal
        const showSettings = ref(false);
        const geminiApiKey = ref('');
        // For info modal
        const showInfo = ref(false);

        const updateState = (state) => {
            if (!state) return;
            notebook_name.value = state.name;
            lastRunIndex.value = state.last_executed_cell;
            lastValidCodeCell.value = state.last_valid_code_cell;
            lastValidOutput.value = state.last_valid_output;
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
            const cell = notebook.value.cells[cellIndex];
            try {
                await apiCall('/edit_code', 'POST', { 
                    cell_index: cellIndex, 
                    source: content 
                });
                console.log('Code saved:', cellIndex);
                // There is code for the cell now. 
                cell.metadata.codegen = true;
            } catch (err) {
                throw new Error('Failed to save code', { cause: err });
            }
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

        const generateCode = async (cellIndex) => {
            if (!geminiApiKey.value) {
                throw new Error('Gemini API key is not set. Please set it in the settings.');
            };
            asRead.value = false;
            const r = await apiCall('/generate_code', 'POST', { cell_index: cellIndex });
            if (r.status == 'success') {
                if (notebook.value && notebook.value.cells[cellIndex]) {
                    const cell = notebook.value.cells[cellIndex];
                    cell.source = r.code;
                    cell.metadata.codegen = true;
                    console.log('Code generated for cell:', cellIndex);
                }
            } else if (r.status == 'cancelled') {
                console.log('Code generation cancelled for cell:', cellIndex);
            } else {
                throw new Error(r.message || 'Code generation failed');
            }
        };

        const regenerateAllCode = async () => {
            if (!geminiApiKey.value) {
                throw new Error('Gemini API key is not set. Please set it in the settings.');
            };
            for (let i = 0; i < notebook.value.cells.length; i++) {
                if (notebook.value.cells[i].cell_type === 'code') {
                    await generateCode(i);
                }
            }
        };

        const regenerateAndRunAllCode = async () => {
            await regenerateAllCode();
            await runAllCells();
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

        // Runs cells up to the present one. 
        const runCell = async (cellIndex) => {
            asRead.value = false;
            if (!running.value) {
                running.value = true;
                if (lastRunIndex.value === cellIndex) {
                    // We rerun the same cell.
                    await runOneCell(cellIndex);
                } else if (lastRunIndex.value > cellIndex) {
                    // We need to run from the start up to cellIndex
                    await resetKernel();
                    for (let i = 0; i <= cellIndex; i++) {
                        await runOneCell(i);
                    }
                    lastRunIndex.value = cellIndex;
                } else {
                    // We run from the last run cell to the current one. 
                    for (let i = lastRunIndex.value + 1; i <= cellIndex; i++) {
                        await runOneCell(i);
                    }
                    lastRunIndex.value = cellIndex;
                }
                running.value = false;
            }
        };

        const saveExplanationAndRun = async (content, cellIndex) => {
            await sendExplanationToServer(content, cellIndex);
            await generateCode(cellIndex);
            await runCell(cellIndex);
        };

        // Runs all cells in the notebook.
        const runAllCells = async () => {
            asRead.value = false;
            if (!running.value) {
                running.value = true;
                for (let i = lastRunIndex.value + 1; i < notebook.value.cells.length && running.value; i++) {
                    await runOneCell(i);
                }
                running.value = false;
                lastRunIndex.value = notebook.value.cells.length - 1;
            }
        };

        const resetAndRunAllCells = async () => {
            await resetKernel();
            await runAllCells();
        };

        // Function in charge of running one cell in the notebook.
        const runOneCell = async (cellIndex) => {
            if (cellIndex < 0 || cellIndex >= notebook.value.cells.length) return;
            const cell = notebook.value.cells[cellIndex];
            if (cell.cell_type !== 'code') return; // Only run code cells
            asRead.value = false;
            const r = await apiCall('/execute_cell', 'POST', { cell_index: cellIndex });
                if (r.status === 'error') {
                    throw new Error(r.message || 'Execution failed');
                } 
                // Update outputs in the notebook model
                if (notebook.value && notebook.value.cells[cellIndex]) {
                    notebook.value.cells[cellIndex].outputs = r.outputs;
                }                
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
        };

        const interruptKernel = async () => {
            try {
                await apiCall('/interrupt_kernel', 'POST');
                console.log('Kernel interrupted');
                running.value = false;
            } catch (err) {
                throw new Error('Interrupt error', { cause: err });
            }
        };

        const resetKernel = async () => {
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

        const saveSettings = async (newKey) => {
            // Save the Gemini API key to the server
            try {
                await apiCall('/set_key', 'POST', { gemini_api_key: geminiApiKey.value });
                console.log('API key saved successfully');
            } catch (err) {
                throw new Error('Error saving API key', { cause: err });
            }
            geminiApiKey.value = newKey;
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
            sendCodeToServer, saveExplanationAndRun,
            sendMarkdownToServer, generateCode, activeIndex, reloadNotebook,
            regenerateAllCode, regenerateAndRunAllCode,
            validateCode, dismissValidation, resetAndRunAllCells,
            setActiveCell, runCell, running, lastRunIndex, asRead, runAllCells, 
            interruptKernel, insertCell, markdownEditKey, lastValidCodeCell, lastValidOutput,
            saveSettings, showSettings, showInfo, 
            genError, uiError, closeUiError, debug, sendDebugRequest,
            explanationEditKey, deleteCell, moveCell, geminiApiKey };
    },
template: `#app-template`,
}).mount('#app');
