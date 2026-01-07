import { createApp, ref, onMounted, onBeforeUnmount, nextTick, getCurrentInstance } from './vue.esm-browser.js';

import MarkdownCell from './MarkdownCell.js';
import OutputRenderer from './OutputRenderer.js';
import CodeCell from './CodeCell.js';
import ExplanationEditor from './ExplanationEditor.js';
import ValidationCell from './ValidationCell.js';

createApp({
    components: { MarkdownCell, CodeCell, ExplanationEditor, OutputRenderer, ValidationCell },
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

        // Configure global error handler
        const app = getCurrentInstance().appContext.app;
        app.config.errorHandler = (err, instance, info) => {
            console.error("Global error:", err, instance, info);
            uiError.value = err.message || String(err);
        };

        // For running a notebook.
        const running = ref(false);
        const lastRunIndex = ref(-1);
        const asRead = ref(true);

        // For settings modal
        const showSettings = ref(false);
        const geminiApiKey = ref('');
        // For info modal
        const showInfo = ref(false);

        // 2. Define the fetch logic
        const fetchNotebook = async () => {
            try {
                loading.value = true;
                // Replace this URL with your actual callback endpoint
                const response = await fetch(`/get_notebook?token=${authToken}`);
                if (!response.ok) throw new Error('Failed to fetch notebook');
                const r = await response.json();
                notebook.value = r.nb;
                notebook_name.value = r.nb_name;
                lastRunIndex.value = r.last_executed_cell || -1;
                geminiApiKey.value = r.gemini_api_key || '';
                isLocked.value = r.nb?.metadata?.is_locked || false;
            } catch (err) {
                error.value = err.message;
                throw new Error("Error in loading notebook: " + err.message);
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

        const sendExplanationToServer = async (content, cellIndex) => {
            asRead.value = false;
            try {
                const response = await fetch(`/edit_explanation?token=${authToken}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        cell_index: cellIndex, 
                        explanation: content })
                });
                if (!response.ok) throw new Error('Failed to save the explanation');
                if (notebook.value && notebook.value.cells[cellIndex]) {
                    notebook.value.cells[cellIndex].metadata.explanation = content;
                }
                console.log('Explanation saved:', cellIndex);
                const r = await response.json();
                lastRunIndex.value = r.last_executed_cell;
            } catch (err) {
                throw new Error('Failed to save explanation: ' + err.message);
            }
        };

        const lockNotebook = async (shouldLock) => {
            try {
                const response = await fetch(`/lock_notebook?token=${authToken}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ is_locked: shouldLock })
                });
                if (!response.ok) throw new Error('Failed to lock notebook');
                console.log('Notebook locked:', shouldLock);
                isLocked.value = shouldLock;
                notebook.value.metadata.is_locked = shouldLock;
            } catch (err) {
                throw new Error('Failed to lock notebook: ' + err.message);
            }
        };

        const sendCodeToServer = async (content, cellIndex) => {
            asRead.value = false;
            try {
                const response = await fetch(`/edit_code?token=${authToken}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        cell_index: cellIndex, 
                        source: content })
                });
                if (!response.ok) throw new Error('Failed to save the code');
                console.log('Code saved:', cellIndex);
                const r = await response.json();
                lastRunIndex.value = r.last_executed_cell;
            } catch (err) {
                throw new Error('Failed to save code: ' + err.message);
            }
        };

        const sendMarkdownToServer = async (content, cellIndex) => {
            asRead.value = false;
            try {
                const response = await fetch(`/edit_markdown?token=${authToken}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        cell_index: cellIndex, 
                        source: content })
                });
                if (!response.ok) throw new Error('Failed to save markdown');
                console.log('Markdown saved:', cellIndex);
                const r = await response.json();
                lastRunIndex.value = r.last_executed_cell;
                if (notebook.value && notebook.value.cells[cellIndex]) {
                    notebook.value.cells[cellIndex].source = content;
                }
            } catch (err) {
                throw new Error('Failed to save markdown: ' + err.message);
            }
        };

        const generateCode = async (cellIndex) => {
            if (!geminiApiKey.value) {
                throw new Error('Gemini API key is not set. Please set it in the settings.');
            };
            asRead.value = false;
            try {
                const response = await fetch(`/generate_code?token=${authToken}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ cell_index: cellIndex })
                });
                if (!response.ok) throw new Error('Failed to generate code');
                const r = await response.json();
                lastRunIndex.value = r.last_executed_cell;
                if (notebook.value && notebook.value.cells[cellIndex]) {
                    notebook.value.cells[cellIndex].source = r.code;
                    console.log('Code generated for cell:', cellIndex);
                }
            } catch (err) {
                throw new Error('Failed to generate code: ' + err.message);
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
                const response = await fetch(`/validate_code?token=${authToken}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ cell_index: cellIndex })
                });
                if (!response.ok) throw new Error('Failed to validate code for cell:' + cellIndex);
                const r = await response.json();
                if (notebook.value && notebook.value.cells[cellIndex]) {
                    notebook.value.cells[cellIndex].metadata.validation = r.validation;
                    console.log('Code validation received for cell:', cellIndex, r.validation);
                }
            } catch (err) {
                throw new Error('Failed to validate code: ' + err.message);
            }
        };

        const dismissValidation = async (cellIndex) => {
            try {
                const response = await fetch(`/set_validation_visibility?token=${authToken}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ cell_index: cellIndex, is_hidden: true })
                });
                if (!response.ok) throw new Error('Failed to dismiss validation');
                console.log('Validation dismissed:', cellIndex);
                if (notebook.value && notebook.value.cells[cellIndex]) {
                    notebook.value.cells[cellIndex].metadata.validation.is_hidden = true;
                }
            } catch (err) {
                throw new Error('Failed to dismiss validation: ' + err.message);
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
                const response = await fetch(`/insert_cell?token=${authToken}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ cell_type: cellType, index: position })
                });
                if (!response.ok) throw new Error('Failed to insert cell');
                const r = await response.json();
                lastRunIndex.value = r.last_executed_cell;
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
                throw new Error('Failed to insert cell: ' + err.message);
            }
        };

        const deleteCell = async (cellIndex) => {
            asRead.value = false;
            try {
                const response = await fetch(`/delete_cell?token=${authToken}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ cell_index: cellIndex })
                });
                if (!response.ok) throw new Error('Failed to delete cell');
                const r = await response.json();
                lastRunIndex.value = r.last_executed_cell;
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
                throw new Error('Failed to delete cell: ' + err.message);
            }
        };

        const moveCell = async (cellIndex, direction) => {
            asRead.value = false;
            const newIndex = cellIndex + direction;
            const total = notebook.value?.cells?.length ?? 0;
            if (newIndex < 0 || newIndex >= total) return;
            try {
                const response = await fetch(`/move_cell?token=${authToken}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ cell_index: cellIndex, new_index: newIndex })
                });
                if (!response.ok) throw new Error('Failed to move cell');
                const r = await response.json();
                lastRunIndex.value = r.last_executed_cell;
                if (r.status !== 'success') throw new Error(r.message || 'Move failed');
                if (notebook.value) {
                    const [cell] = notebook.value.cells.splice(cellIndex, 1);
                    notebook.value.cells.splice(newIndex, 0, cell);
                    activeIndex.value = newIndex;
                }
            } catch (err) {
                throw new Error('Failed to move cell: ' + err.message);
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
            try {
                const response = await fetch(`/execute_cell?token=${authToken}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ cell_index: cellIndex })
                });
                if (!response.ok) throw new Error('Failed to run cell');
                const r = await response.json();
                if (r.status === 'error') {
                    throw new Error(r.message || 'Execution failed');
                } else {
                    console.log('Cell executed:', cellIndex, r.details);
                    // Update outputs in the notebook model
                    if (notebook.value && notebook.value.cells[cellIndex]) {
                        notebook.value.cells[cellIndex].outputs = r.outputs;
                    }
                    // Update lastRunIndex from server response
                    if (r.last_executed_cell !== undefined && r.last_executed_cell !== null) {
                        lastRunIndex.value = r.last_executed_cell;
                    }
                }
            } catch (err) {
                throw new Error('Run error: ' + err.message);
            }
        };

        const interruptKernel = async () => {
            try {
                const response = await fetch(`/interrupt_kernel?token=${authToken}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' }
                });
                if (!response.ok) throw new Error('Failed to interrupt kernel');
                console.log('Kernel interrupted');
                running.value = false;
            } catch (err) {
                throw new Error('Interrupt error: ' + err.message);
            }
        };

        const resetKernel = async () => {
            try {
                const response = await fetch(`/reset_kernel?token=${authToken}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' }
                });
                if (!response.ok) throw new Error('Failed to reset kernel');
                console.log('Kernel reset');
                lastRunIndex.value = -1;
            } catch (err) {
                throw new Error('Reset error: ' + err.message);
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

        const openSettings = () => {
            // Get the Gemini API key from the server settings.
            
            showSettings.value = true;
        };

        const closeSettings = async () => {
            // Save the Gemini API key to the server
            try {
                const response = await fetch(`/set_key?token=${authToken}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ gemini_api_key: geminiApiKey.value })
                });
                if (response.ok) {
                    console.log('API key saved successfully');
                } else {
                    throw new Error('Failed to save API key');
                }
            } catch (err) {
                throw new Error('Error saving API key: ' + err.message);
            }
            showSettings.value = false;
        };

        const genError = () => {
            throw new Error('This is a generated error for testing purposes. This is a generated error for testing purposes. This is a generated error for testing purposes. This is a generated error for testing purposes. ');
        }

        const openInfo = () => {
            showInfo.value = true;
        };

        const closeInfo = () => {
            showInfo.value = false;
        };

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
            sendExplanationToServer, 
            sendCodeToServer, saveExplanationAndRun,
            sendMarkdownToServer, generateCode, activeIndex, reloadNotebook,
            regenerateAllCode, regenerateAndRunAllCode,
            validateCode, dismissValidation, resetAndRunAllCells,
            setActiveCell, runCell, running, lastRunIndex, asRead, runAllCells, 
            interruptKernel, insertCell, markdownEditKey, 
            openSettings, closeSettings, showSettings, 
            openInfo, closeInfo, showInfo, 
            genError, uiError, closeUiError,
            explanationEditKey, deleteCell, moveCell, geminiApiKey };
    },
template: `#app-template`,
}).mount('#app');

