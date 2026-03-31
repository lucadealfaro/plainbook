import { createApp, ref, computed, onMounted, onBeforeUnmount, nextTick, getCurrentInstance } from './vue.esm-browser.js';

import AppNavbar from './AppNavbar.js';
import NotebookCell from './NotebookCell.js';
import CellInsertionZone from './CellInsertionZone.js';
import CellLabel from './CellLabel.js';
import SettingsModal from './SettingsModal.js';
import InfoModal from './InfoModal.js';
import TestHelpModal from './TestHelpModal.js';
import UiError from './UiError.js';
import PanelBar from './PanelBar.js';
import NotebookHelp from './NotebookHelp.js';
import UnitTestView from './UnitTestView.js';

createApp({
    components: { AppNavbar, NotebookCell, CellInsertionZone, CellLabel, SettingsModal, InfoModal, TestHelpModal, UiError, PanelBar, NotebookHelp, UnitTestView },
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
        const shareOutputWithAi = ref(true);
        const aiTokens = ref({input: 0, output: 0});
        const debug = ref(false);
        // For running a notebook.
        const running = ref(false);
        const runningActivity = ref({ type: null, cellIndex: null });
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
        // API keys are never stored client-side; only presence flags are used.
        const activeAiProvider = ref(null);
        const aiProviderRegistry = ref([]);
        const isCodespace = ref(false);
        const hasGeminiKey = ref(false);
        const hasClaudeKey = ref(false);
        const claudeViaBedrock = ref(false);

        const availableAiProviders = computed(() => {
            const apiKeys = {
                'gemini_api_key': hasGeminiKey.value,
                'claude_api_key': hasClaudeKey.value,
            };
            return aiProviderRegistry.value.filter(p => !!apiKeys[p.key_setting]);
        });

        // For info modal
        const showInfo = ref(false);

        // For test help modal
        const showTestHelp = ref(false);

        // Test cell state
        const last_valid_test_cell_index = ref(-1);

        // Configure global error handler
        const app = getCurrentInstance().appContext.app;

        app.config.errorHandler = (err, instance, info) => {
            console.error("Global error:", err, instance, info);
            running.value = false;
            runningActivity.value = { type: null, cellIndex: null };

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
            // Scroll to the cell that caused the error, if known.
            if (err.cellIndex != null) {
                nextTick(() => {
                    const cells = document.querySelectorAll('.notebook-cell');
                    if (cells[err.cellIndex]) {
                        cells[err.cellIndex].scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }
                });
            }
        };

        const updateState = (state) => {
            if (!state) return;
            console.log('Updating state:', state);
            notebook_name.value = state.name;
            last_executed_cell_index.value = state.last_executed_cell;
            last_valid_code_cell_index.value = state.last_valid_code_cell;
            last_valid_output_cell_index.value = state.last_valid_output_cell;
            last_valid_test_cell_index.value = state.last_valid_test_cell;
            isLocked.value = state.is_locked;
            shareOutputWithAi.value = state.share_output_with_ai;
            if (state.ai_tokens) {
                aiTokens.value = state.ai_tokens;
            }
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
            if (r.unit_test_state
                && r.unit_test_state.cell_index === unitTestTargetIndex.value) {
                unitTestValidity.value = r.unit_test_state.state;
            }
            return r;
        };

        // 2. Define the fetch logic
        const fetchNotebook = async () => {
            try {
                loading.value = true;
                const r = await apiCall('/get_notebook');
                notebook.value = r.nb;
                activeAiProvider.value = r.active_ai_provider || null;
                aiProviderRegistry.value = r.ai_providers || [];
                debug.value = r.debug || false;
                isCodespace.value = r.is_codespace || false;
                hasGeminiKey.value = r.has_gemini_key || false;
                hasClaudeKey.value = r.has_claude_key || false;
                claudeViaBedrock.value = r.claude_via_bedrock || false;
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

        const clearOutputs = async () => {
            try {
                await apiCall('/clear_outputs', 'POST');
                if (notebook.value) {
                    for (const cell of notebook.value.cells) {
                        if (cell.cell_type === 'code' || cell.cell_type === 'test') {
                            cell.outputs = [];
                            // Also clear unit test sub-cell outputs
                            for (const test of Object.values(cell.metadata?.unit_tests || {})) {
                                test.cells.setup.outputs = [];
                                if (test.cells.target) test.cells.target.outputs = [];
                                test.cells.test.outputs = [];
                            }
                        }
                    }
                }
                console.log('Outputs cleared');
            } catch (err) {
                throw new Error('Failed to clear outputs', { cause: err });
            }
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
                    const response = await apiCall('/edit_explanation', 'POST', {
                        cell_index: cellIndex,
                        explanation: content
                    });
                    if (notebook.value && notebook.value.cells[cellIndex]) {
                        notebook.value.cells[cellIndex].metadata.explanation = content;
                        if (response.cell_name) {
                            notebook.value.cells[cellIndex].metadata.name = response.cell_name;
                        }
                    }
                    console.log('Explanation saved:', cellIndex);
                    return response;
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

        const toggleShareOutput = async () => {
            try {
                const newVal = !shareOutputWithAi.value;
                await apiCall('/set_share_output', 'POST', { share: newVal });
            } catch (err) {
                throw new Error('Failed to toggle output sharing', { cause: err });
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

        const clearCellCode = async (cellIndex) => {
            asRead.value = false;
            try {
                await apiCall('/clear_code', 'POST', { cell_index: cellIndex });
                if (notebook.value && notebook.value.cells[cellIndex]) {
                    notebook.value.cells[cellIndex].source = '';
                    notebook.value.cells[cellIndex].outputs = [];
                }
                console.log('Code cleared:', cellIndex);
            } catch (err) {
                throw new Error('Failed to clear code', { cause: err });
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


        const validateCode = async (cellIndex) => {
            if (!activeAiProvider.value) {
                throw new Error('No AI provider is active. Please set an API key in Settings.');
            };
            asRead.value = false;
            const cell = notebook.value.cells[cellIndex];
            runningActivity.value = { type: 'validating', cellIndex, cellName: cell.metadata.name || null };
            try {
                const r = await apiCall('/validate_code', 'POST', { cell_index: cellIndex });
                if (r.status === 'cancelled') {
                    console.log('Validation cancelled for cell:', cellIndex);
                } else if (r.status === 'error') {
                    throw new Error(r.message || 'Validation failed');
                } else if (notebook.value && notebook.value.cells[cellIndex]) {
                    notebook.value.cells[cellIndex].metadata.validation = r.validation;
                    console.log('Code validation received for cell:', cellIndex, r.validation);
                }
            } catch (err) {
                throw new Error(err.message || 'Failed to validate code', { cause: err });
            }
        };

        const ui_validateCode = async (cellIndex) => {
            if (!running.value) {
                running.value = true;
                await validateCode(cellIndex);
                running.value = false;
                runningActivity.value = { type: null, cellIndex: null };
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

        const validateUnitTestCode = async (cellIndex, testName, role) => {
            if (!activeAiProvider.value) {
                throw new Error('No AI provider is active. Please set an API key in Settings.');
            }
            const cell = notebook.value.cells[cellIndex];
            runningActivity.value = { type: `unit-test-validate-${role}`, cellIndex, testName };
            try {
                const r = await apiCall('/validate_unit_test_code', 'POST', {
                    cell_index: cellIndex, test_name: testName, role: role
                });
                if (r.status === 'cancelled') {
                    console.log('Unit test validation cancelled:', cellIndex, testName, role);
                } else if (r.status === 'error') {
                    throw new Error(r.message || 'Validation failed');
                } else {
                    const test = cell.metadata.unit_tests[testName];
                    test.cells[role].metadata.validation = r.validation;
                    console.log('Unit test validation received:', cellIndex, testName, role, r.validation);
                }
            } catch (err) {
                throw new Error(err.message || 'Failed to validate unit test code', { cause: err });
            }
        };

        const ui_validateUnitTestCode = async (cellIndex, testName, role) => {
            if (!running.value) {
                running.value = true;
                try {
                    await validateUnitTestCode(cellIndex, testName, role);
                } finally {
                    running.value = false;
                    runningActivity.value = { type: null, cellIndex: null };
                }
            }
        };

        const dismissUnitTestValidation = async (cellIndex, testName, role) => {
            try {
                await apiCall('/set_unit_test_validation_visibility', 'POST', {
                    cell_index: cellIndex, test_name: testName, role: role, is_hidden: true
                });
                const test = notebook.value.cells[cellIndex].metadata.unit_tests[testName];
                test.cells[role].metadata.validation.is_hidden = true;
                console.log('Unit test validation dismissed:', cellIndex, testName, role);
            } catch (err) {
                throw new Error('Failed to dismiss unit test validation', { cause: err });
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
            flushActiveEdits();
            await waitForPendingSaves();
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
                        } else { // code or test
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
            if (!activeAiProvider.value) {
                throw new Error('No AI provider is active. Please set an API key in Settings.');
            };
            asRead.value = false;
            for (let i = last_valid_code_cell_index.value + 1; i <= cellIndex; i++) {
                if (!running.value) return; // Stop if running has been cancelled
                if (notebook.value.cells[i].cell_type !== 'code') continue; // Skip non-code cells
                await generateCodeOneCell(i);
            }
        };
        
        
        // Function in charge of generating code for one cell.
        const generateCodeOneCell = async (cellIndex, force = false, validationFeedback = null) => {
            const cell = notebook.value.cells[cellIndex];
            if (cell.cell_type !== 'code') return; // Only code cells
            if (!force && last_valid_code_cell_index.value >= cellIndex) return; // Already valid code
            // If I don't have valid outputs for the previous cell, I need to run it first.
            // Those outputs are needed as context for code generation.
            if (last_valid_output_cell_index.value < cellIndex - 1 && cellIndex > 0) {
                await runCells(cellIndex - 1);
            }
            if (!running.value) return; // Stop if running has been cancelled
            runningActivity.value = { type: 'generating', cellIndex, cellName: cell.metadata.name || null };
            asRead.value = false;
            const body = { cell_index: cellIndex };
            if (validationFeedback) {
                body.validation_feedback = validationFeedback;
            }
            const r = await apiCall('/generate_code', 'POST', body);
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
            runningActivity.value = { type: 'running', cellIndex, cellName: cell.metadata.name || null };
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
                    let err;
                    if(r.outputs[0].ename === 'ModuleNotFoundError') {
                        err = new Error('A package is required by this code cell. Please install the necessary packages via this command on your local environment: pip install ' + r.outputs[0].evalue.split("'")[1]);
                    } else if (r.outputs[0].ename === 'FileNotFoundError') {
                        err = new Error('The notebook cannot find a file it needs. Please select all the required input files using the selector at the top, so that the AI knows where to find them, and re-generate the code. If the files are already selected, you might want to refer to them in a more precise way, for instance citing their full name.');
                    } else {
                        err = new Error("Execution error: " + r.outputs[0].ename);
                    }
                    err.cellIndex = cellIndex;
                    throw err;
                }
        };


        // These are the UI functions that cause the "running" to display. 
        // The important fact is that these cannot be re-entrant.

        const ui_saveExplanationAndRun = async (content, cellIndex) => {
            const response = await sendExplanationToServer(content, cellIndex);
            // Defensive: ensure cell name is stored even if a concurrent
            // blur-triggered save consumed the name from a parallel request.
            if (response && response.cell_name
                    && notebook.value && notebook.value.cells[cellIndex]) {
                notebook.value.cells[cellIndex].metadata.name = response.cell_name;
            }
            if (!running.value) {
                running.value = true;
                await generateCode(cellIndex);
                await runCells(cellIndex);
                running.value = false;
                runningActivity.value = { type: null, cellIndex: null };
                const total = notebook.value?.cells?.length ?? 0;
                const next = Math.min(cellIndex + 1, total - 1);
                if (next !== cellIndex) setActiveCell(next, true);
            }
        };


        const ui_runCell = async (cellIndex) => {
            flushActiveEdits();
            await waitForPendingSaves();
            if (!running.value) {
                running.value = true;
                await runCells(cellIndex);
                running.value = false;
                runningActivity.value = { type: null, cellIndex: null };
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
                runningActivity.value = { type: null, cellIndex: null };
            }
        };


        const ui_forceRegenerateCellCode = async (cellIndex) => {
            asRead.value = false;
            flushActiveEdits();
            await waitForPendingSaves();
            if (!running.value) {
                running.value = true;
                // Check for failed validation to pass as context
                let validationFeedback = null;
                const cell = notebook.value.cells[cellIndex];
                const v = cell?.metadata?.validation;
                if (v && !v.is_hidden && !v.is_valid && v.message) {
                    validationFeedback = v.message;
                    dismissValidation(cellIndex);
                }
                await generateCodeOneCell(cellIndex, true, validationFeedback);
                running.value = false;
                runningActivity.value = { type: null, cellIndex: null };
            }
        };


        const ui_interruptKernel = async () => {
            try {
                running.value = false;
                runningActivity.value = { type: null, cellIndex: null };
                await Promise.all([
                    apiCall('/interrupt_kernel', 'POST'),
                    apiCall('/cancel_ai_request', 'POST'),
                ]);
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

        const restarting = ref(false);

        const ui_restart = async () => {
            restarting.value = true;
            try {
                await ui_resetKernel();
                await reloadNotebook();
            } finally {
                restarting.value = false;
            }
        };


        // Test cell functions

        const generateTestCodeOneCell = async (cellIndex, force = false, validationFeedback = null) => {
            const cell = notebook.value.cells[cellIndex];
            if (cell.cell_type !== 'test') return;
            if (!force && last_valid_test_cell_index.value >= cellIndex) return;
            if (!running.value) return;
            runningActivity.value = { type: 'generating', cellIndex, cellName: cell.metadata.name || null };
            asRead.value = false;
            const body = { cell_index: cellIndex };
            if (validationFeedback) {
                body.validation_feedback = validationFeedback;
            }
            const r = await apiCall('/generate_test_code', 'POST', body);
            if (r.status === 'success') {
                if (notebook.value && notebook.value.cells[cellIndex]) {
                    cell.source = r.code;
                    console.log('Test code generated for cell:', cellIndex);
                }
            } else if (r.status === 'cancelled') {
                console.log('Test code generation cancelled for cell:', cellIndex);
            } else {
                throw new Error(r.message || 'Test code generation failed');
            }
        };

        const runOneTest = async (cellIndex) => {
            if (cellIndex < 0 || cellIndex >= notebook.value.cells.length) return;
            const cell = notebook.value.cells[cellIndex];
            if (cell.cell_type !== 'test') return;
            if (!running.value) return;
            // Ensure all previous code cells are run
            // Find the last code cell before this test
            let lastCodeIdx = -1;
            for (let i = cellIndex - 1; i >= 0; i--) {
                if (notebook.value.cells[i].cell_type === 'code') {
                    lastCodeIdx = i;
                    break;
                }
            }
            if (lastCodeIdx >= 0 && last_executed_cell_index.value < lastCodeIdx) {
                await runCells(lastCodeIdx);
            }
            if (!running.value) return;
            // Generate test code if needed
            if (last_valid_test_cell_index.value < cellIndex) {
                await generateTestCodeOneCell(cellIndex);
            }
            if (!running.value) return;
            // Execute the test cell
            runningActivity.value = { type: 'running', cellIndex, cellName: cell.metadata.name || null };
            asRead.value = false;
            const r = await apiCall('/execute_test_cell', 'POST', { cell_index: cellIndex });
            if (r.status === 'error') {
                const err = new Error(r.message || 'Test execution failed');
                err.cellIndex = cellIndex;
                throw err;
            }
            if (r.outputs) {
                cell.outputs = r.outputs;
            }
            console.log('Test cell executed:', cellIndex);
        };

        const ui_runTestCell = async (cellIndex) => {
            flushActiveEdits();
            await waitForPendingSaves();
            if (!running.value) {
                running.value = true;
                await runOneTest(cellIndex);
                running.value = false;
                runningActivity.value = { type: null, cellIndex: null };
            }
        };

        const ui_runAllTests = async () => {
            flushActiveEdits();
            await waitForPendingSaves();
            if (!running.value) {
                running.value = true;
                for (let i = 0; i < notebook.value.cells.length; i++) {
                    if (!running.value) break;
                    if (notebook.value.cells[i].cell_type === 'test') {
                        await runOneTest(i);
                    }
                }
                running.value = false;
                runningActivity.value = { type: null, cellIndex: null };
            }
        };

        const ui_saveExplanationAndRunTest = async (content, cellIndex) => {
            const response = await sendExplanationToServer(content, cellIndex);
            if (response && response.cell_name
                    && notebook.value && notebook.value.cells[cellIndex]) {
                notebook.value.cells[cellIndex].metadata.name = response.cell_name;
            }
            if (!running.value) {
                running.value = true;
                await generateTestCodeOneCell(cellIndex);
                await runOneTest(cellIndex);
                running.value = false;
                runningActivity.value = { type: null, cellIndex: null };
                const total = notebook.value?.cells?.length ?? 0;
                const next = Math.min(cellIndex + 1, total - 1);
                if (next !== cellIndex) setActiveCell(next, true);
            }
        };

        const ui_forceRegenerateTestCode = async (cellIndex) => {
            asRead.value = false;
            flushActiveEdits();
            await waitForPendingSaves();
            if (!running.value) {
                running.value = true;
                let validationFeedback = null;
                const cell = notebook.value.cells[cellIndex];
                const v = cell?.metadata?.validation;
                if (v && !v.is_hidden && !v.is_valid && v.message) {
                    validationFeedback = v.message;
                    dismissValidation(cellIndex);
                }
                await generateTestCodeOneCell(cellIndex, true, validationFeedback);
                running.value = false;
                runningActivity.value = { type: null, cellIndex: null };
            }
        };

        // Unit test mode state and methods

        const unitTestTargetIndex = ref(null);
        const unitTestValidity = ref({});

        function newSubCell() {
            return {
                cell_type: "code",
                source: "",
                outputs: [],
                execution_count: null,
                id: crypto.randomUUID(),
                metadata: {
                    explanation: "",
                    explanation_timestamp: "",
                    code_timestamp: "",
                    name: "",
                    variables: {},
                    validation: null
                }
            };
        }

        const fetchUnitTestState = async (cellIndex) => {
            try {
                const r = await apiCall('/get_unit_test_state', 'POST', { cell_index: cellIndex });
                if (r.status === 'success' && r.unit_test_state
                    && r.unit_test_state.cell_index === cellIndex) {
                    unitTestValidity.value = r.unit_test_state.state;
                }
            } catch (err) {
                console.error('Failed to fetch unit test state:', err);
            }
        };

        const enterUnitTestMode = async (cellIndex) => {
            const cell = notebook.value.cells[cellIndex];
            if (!cell.metadata.unit_tests || Object.keys(cell.metadata.unit_tests).length === 0) {
                cell.metadata.unit_tests = {
                    "Test 1": { cells: { setup: newSubCell(), test: newSubCell() }, validity: { setup_code_valid: false, setup_output_valid: false, target_output_valid: false, test_code_valid: false, test_output_valid: false } }
                };
                saveUnitTests(cellIndex);
            }
            unitTestTargetIndex.value = cellIndex;
            await fetchUnitTestState(cellIndex);
        };

        const exitUnitTestMode = () => {
            unitTestTargetIndex.value = null;
            unitTestValidity.value = {};
        };

        const saveUnitTests = async (cellIndex) => {
            const cell = notebook.value.cells[cellIndex];
            try {
                await apiCall('/save_unit_tests', 'POST', {
                    cell_index: cellIndex,
                    unit_tests: cell.metadata.unit_tests
                });
                console.log('Unit tests saved:', cellIndex);
            } catch (err) {
                throw new Error('Failed to save unit tests', { cause: err });
            }
        };

        const addUnitTest = async (cellIndex) => {
            const cell = notebook.value.cells[cellIndex];
            if (!cell.metadata.unit_tests) cell.metadata.unit_tests = {};
            let testNum = Object.keys(cell.metadata.unit_tests).length + 1;
            while (`Test ${testNum}` in cell.metadata.unit_tests) testNum++;
            cell.metadata.unit_tests[`Test ${testNum}`] = {
                cells: { setup: newSubCell(), test: newSubCell() },
                validity: { setup_code_valid: false, setup_output_valid: false, target_output_valid: false, test_code_valid: false, test_output_valid: false }
            };
            await saveUnitTests(cellIndex);
        };

        const deleteUnitTest = async (cellIndex, testName) => {
            const cell = notebook.value.cells[cellIndex];
            if (!cell.metadata.unit_tests) return;
            delete cell.metadata.unit_tests[testName];
            await saveUnitTests(cellIndex);
        };

        const renameUnitTest = async (cellIndex, oldName, newName) => {
            const cell = notebook.value.cells[cellIndex];
            if (!cell.metadata.unit_tests || !(oldName in cell.metadata.unit_tests)) return;
            if (newName in cell.metadata.unit_tests) return;
            const newTests = {};
            for (const [key, value] of Object.entries(cell.metadata.unit_tests)) {
                newTests[key === oldName ? newName : key] = value;
            }
            cell.metadata.unit_tests = newTests;
            await saveUnitTests(cellIndex);
        };

        const saveUnitTestExplanation = (cellIndex, testName, role, content) => {
            // Update local data immediately so executeUnitTest sees current explanation
            const cell = notebook.value.cells[cellIndex];
            const test = cell.metadata.unit_tests[testName];
            test.cells[role].metadata.explanation = content;

            const savePromise = (async () => {
                try {
                    await apiCall('/save_unit_test_explanation', 'POST', {
                        cell_index: cellIndex,
                        test_name: testName,
                        role: role,
                        explanation: content
                    });
                } catch (err) {
                    throw new Error('Failed to save unit test explanation', { cause: err });
                }
            })();
            trackSave(savePromise);
            return savePromise;
        };

        const saveUnitTestCode = (cellIndex, testName, role, content) => {
            const savePromise = (async () => {
                try {
                    await apiCall('/save_unit_test_code', 'POST', {
                        cell_index: cellIndex,
                        test_name: testName,
                        role: role,
                        source: content
                    });
                } catch (err) {
                    throw new Error('Failed to save unit test code', { cause: err });
                }
            })();
            trackSave(savePromise);
            return savePromise;
        };

        const clearUnitTestCode = async (cellIndex, testName, role) => {
            try {
                await apiCall('/clear_unit_test_code', 'POST', {
                    cell_index: cellIndex,
                    test_name: testName,
                    role: role
                });
                // Update local state
                const cell = notebook.value.cells[cellIndex];
                const test = cell.metadata.unit_tests[testName];
                const subCell = test.cells[role];
                subCell.source = '';
                subCell.outputs = [];
            } catch (err) {
                throw new Error('Failed to clear unit test code', { cause: err });
            }
        };

        const clearUnitTestOutputs = async (cellIndex, testName) => {
            try {
                await apiCall('/clear_unit_test_outputs', 'POST', {
                    cell_index: cellIndex,
                    test_name: testName
                });
            } catch (err) {
                throw new Error('Failed to clear unit test outputs', { cause: err });
            }
        };

        const executeUnitTestCell = async (cellIndex, testName, role) => {
            runningActivity.value = { type: `unit-test-${role}`, cellIndex, testName };
            const r = await apiCall('/run_unit_test_cell', 'POST', {
                cell_index: cellIndex,
                test_name: testName,
                role: role
            });
            // Update local outputs
            const cell = notebook.value.cells[cellIndex];
            const test = cell.metadata.unit_tests[testName];
            if (role === 'setup') {
                test.cells.setup.outputs = r.outputs || [];
            } else if (role === 'target') {
                if (!test.cells.target) test.cells.target = {};
                test.cells.target.outputs = r.outputs || [];
            } else {
                test.cells.test.outputs = r.outputs || [];
            }
            if (r.details === 'CellExecutionError') {
                const err = new Error(`Unit test ${role} execution error`);
                err.cellIndex = cellIndex;
                throw err;
            }
            return r;
        };

        const generateUnitTestCodeInner = async (cellIndex, testName, role) => {
            runningActivity.value = { type: `unit-test-gen-${role}`, cellIndex, testName };
            const r = await apiCall('/generate_unit_test_cell_code', 'POST', {
                cell_index: cellIndex,
                test_name: testName,
                role: role
            });
            if (r.status === 'success' && r.code) {
                const cell = notebook.value.cells[cellIndex];
                const test = cell.metadata.unit_tests[testName];
                if (role === 'target') {
                    cell.source = r.code;
                } else {
                    test.cells[role].source = r.code;
                }
            } else if (r.status === 'error') {
                throw new Error(r.message || 'Failed to generate unit test code');
            }
            return r;
        };

        const executeUnitTest = async (cellIndex, testName) => {
            // 1. Ensure main notebook cells up to cellIndex-1 are executed.
            // Only call runCells if we haven't executed far enough yet.
            // Do NOT call runCells when the notebook is already executed past
            // cellIndex, as that would reset the kernel and invalidate all
            // downstream states unnecessarily.
            if (cellIndex > 0 && last_executed_cell_index.value < cellIndex - 1) {
                await runCells(cellIndex - 1);
            }
            if (!running.value) return;

            // 2. Ensure target cell has valid code (setup code generation
            //    needs to know what the target reads)
            if (last_valid_code_cell_index.value < cellIndex) {
                await generateCode(cellIndex);
            }
            if (!running.value) return;

            const cell = notebook.value.cells[cellIndex];
            const test = cell.metadata.unit_tests[testName];
            const validity = unitTestValidity.value?.[testName];

            // 3. Generate setup code if needed (empty or invalid), then execute setup
            const setupHasExplanation = (test.cells.setup.metadata?.explanation || '').trim();
            const setupCodeInvalid = !validity?.setup?.code_valid;
            if (setupHasExplanation && (!(test.cells.setup.source || '').trim() || setupCodeInvalid)) {
                await generateUnitTestCodeInner(cellIndex, testName, 'setup');
            }
            if (!running.value) return;
            // Execute setup (even if empty — server handles no-op)
            await executeUnitTestCell(cellIndex, testName, 'setup');
            if (!running.value) return;

            // 4. Execute target
            await executeUnitTestCell(cellIndex, testName, 'target');
            if (!running.value) return;

            // 5. Generate test code if needed (empty or invalid), then execute test
            const testHasExplanation = (test.cells.test.metadata?.explanation || '').trim();
            const testCodeInvalid = !validity?.test?.code_valid;
            if (testHasExplanation && (!(test.cells.test.source || '').trim() || testCodeInvalid)) {
                await generateUnitTestCodeInner(cellIndex, testName, 'test');
            }
            if (!running.value) return;
            if ((test.cells.test.source || '').trim()) {
                await executeUnitTestCell(cellIndex, testName, 'test');
            }

        };

        const ui_runUnitTest = async (cellIndex, testName) => {
            flushActiveEdits();
            await waitForPendingSaves();
            if (!running.value) {
                running.value = true;
                try {
                    await executeUnitTest(cellIndex, testName);
                } finally {
                    running.value = false;
                    runningActivity.value = { type: null, cellIndex: null };
                }
            }
        };

        const generateUnitTestCode = async (cellIndex, testName, role) => {
            if (!running.value) {
                running.value = true;
                try {
                    await generateUnitTestCodeInner(cellIndex, testName, role);
                } finally {
                    running.value = false;
                    runningActivity.value = { type: null, cellIndex: null };
                }
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
                if (unitTestTargetIndex.value !== null) return;
                e.preventDefault();
                const cell = notebook.value.cells[activeIndex.value];
                if (cell && (cell.cell_type === 'code' || cell.cell_type === 'test')) {
                    ui_runCell(activeIndex.value);
                }
                const next = Math.min(activeIndex.value + 1, total - 1);
                if (next !== activeIndex.value) setActiveCell(next);
            }
        };

        const saveSettings = async (keys) => {
            // Save the API keys to the server
            try {
                const r = await apiCall('/set_key', 'POST', {
                    gemini_api_key: keys.gemini_api_key,
                    claude_api_key: keys.claude_api_key,
                });
                console.log('API keys saved successfully');
                if (r.active_ai_provider !== undefined) {
                    activeAiProvider.value = r.active_ai_provider;
                }
                // Update presence flags from server response
                if (r.has_gemini_key !== undefined) {
                    hasGeminiKey.value = r.has_gemini_key;
                }
                if (r.has_claude_key !== undefined) {
                    hasClaudeKey.value = r.has_claude_key;
                }
                if (r.claude_via_bedrock !== undefined) {
                    claudeViaBedrock.value = r.claude_via_bedrock;
                }
            } catch (err) {
                throw new Error('Error saving API keys', { cause: err });
            }
        };

        const setActiveAiProvider = async (providerId) => {
            try {
                const r = await apiCall('/set_active_ai', 'POST', { provider: providerId });
                if (r.status === 'success') {
                    activeAiProvider.value = r.active_ai_provider;
                } else {
                    throw new Error(r.message || 'Failed to set AI provider');
                }
            } catch (err) {
                throw new Error('Error setting AI provider', { cause: err });
            }
        };

        const genError = () => {
            throw new Error('This is a generated error for testing purposes. This is a generated error for testing purposes. This is a generated error for testing purposes. This is a generated error for testing purposes. ');
        }

        const closeUiError = () => {
            uiError.value = null;
        };

        const handleClickOutside = (event) => {
            if (event.target.closest('.modal')) return;
            const container = document.querySelector('.notebook-container');
            const navbar = document.querySelector('.app-toolbar');
            if (container && !container.contains(event.target) &&
                !(navbar && navbar.contains(event.target))) {
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

        return { notebook, notebook_name, loading, error, isLocked, lockNotebook, shareOutputWithAi, aiTokens, toggleShareOutput,
            sendExplanationToServer, authToken,
            sendCodeToServer, clearCellCode, ui_saveExplanationAndRun,
            sendMarkdownToServer, generateCode, activeIndex, reloadNotebook,
            validateCode, ui_validateCode, dismissValidation, ui_resetAndRunAllCells, ui_forceRegenerateCellCode,
            setActiveCell, ui_runCell, running, runningActivity, asRead,
            ui_interruptKernel, insertCell, markdownEditKey,
            last_executed_cell_index, last_valid_code_cell_index, last_valid_output_cell_index,
            last_valid_test_cell_index,
            saveSettings, showSettings, showInfo, showTestHelp,
            genError, uiError, closeUiError, debug, sendDebugRequest,
            explanationEditKey, deleteCell, moveCell,
            clearOutputs, activeAiProvider, availableAiProviders, setActiveAiProvider, isCodespace, hasGeminiKey, hasClaudeKey, claudeViaBedrock,
            restarting, ui_restart,
            ui_runTestCell, ui_runAllTests, ui_saveExplanationAndRunTest, ui_forceRegenerateTestCode,
            unitTestTargetIndex, enterUnitTestMode, exitUnitTestMode,
            addUnitTest, deleteUnitTest, renameUnitTest,
            saveUnitTestExplanation, saveUnitTestCode, clearUnitTestCode, clearUnitTestOutputs,
            ui_runUnitTest, generateUnitTestCode, unitTestValidity,
            ui_validateUnitTestCode, dismissUnitTestValidation };
    },

template: `#app-template`,
}).mount('#app');
