import { createApp, ref, onMounted, onBeforeUnmount, nextTick } from './vue.esm-browser.js';

import MarkdownCell from './MarkdownCell.js';
import OutputRenderer from './OutputRenderer.js';
import CodeCell from './CodeCell.js';
import ExplanationEditor from './ExplanationEditor.js';

createApp({
    components: { MarkdownCell, CodeCell, ExplanationEditor, OutputRenderer },
    setup() {
        // Extract token from URL
        const urlParams = new URLSearchParams(window.location.search);
        const authToken = urlParams.get('token');

        // 1. Initialize notebook as null
        const notebook = ref(null);
        const notebook_name = ref('');
        const loading = ref(true);
        const error = ref(null);
        const activeIndex = ref(-1);
        const markdownEditKey = ref({});
        const explanationEditKey = ref({});

        // For running a notebook.
        const running = ref(false);
        const lastRunIndex = ref(-1);
        const asRead = ref(true);

        // For settings modal
        const showSettings = ref(false);

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
            } catch (err) {
                error.value = err.message;
                console.error("Fetch error:", err);
            } finally {
                loading.value = false;
                asRead.value = true;
            }
        };

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
                if (!response.ok) throw new Error('Failed to save');
                console.log('Explanation saved:', cellIndex);
            } catch (err) {
                console.error('Save error:', err);
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
                if (!response.ok) throw new Error('Failed to save');
                console.log('Code saved:', cellIndex);
            } catch (err) {
                console.error('Save error:', err);
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
                if (notebook.value && notebook.value.cells[cellIndex]) {
                    notebook.value.cells[cellIndex].source = content;
                }
            } catch (err) {
                console.error('Save markdown error:', err);
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

        const insertCell = async (insertAfter, cellType) => {
            const position = insertAfter + 1;
            try {
                const response = await fetch(`/insert_cell?token=${authToken}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ cell_type: cellType, index: position })
                });
                if (!response.ok) throw new Error('Failed to insert cell');
                const r = await response.json();
                if (r.status !== 'success') throw new Error(r.message || 'Insert failed');
                const { cell, index } = r;
                if (notebook.value) {
                    notebook.value.cells.splice(index, 0, cell);
                    activeIndex.value = index;
                    if (cellType === 'markdown') {
                        bumpKey(markdownEditKey, index);
                    } else {
                        bumpKey(explanationEditKey, index);
                    }
                }
            } catch (err) {
                console.error('Insert cell error:', err);
            }
        };

        const deleteCell = async (cellIndex) => {
            try {
                const response = await fetch(`/delete_cell?token=${authToken}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ cell_index: cellIndex })
                });
                if (!response.ok) throw new Error('Failed to delete cell');
                const r = await response.json();
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
                console.error('Delete cell error:', err);
            }
        };

        const moveCell = async (cellIndex, direction) => {
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
                if (r.status !== 'success') throw new Error(r.message || 'Move failed');
                if (notebook.value) {
                    const [cell] = notebook.value.cells.splice(cellIndex, 1);
                    notebook.value.cells.splice(newIndex, 0, cell);
                    activeIndex.value = newIndex;
                }
            } catch (err) {
                console.error('Move cell error:', err);
            }
        };

        const isEditingField = (el) => {
            if (!el) return false;
            const tag = el.tagName;
            return el.isContentEditable || tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT' || tag === 'OPTION';
        };

        // Runs cells up to the present one. 
        const runCell = async (cellIndex) => {
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
                    // We run f
                    for (let i = lastRunIndex.value + 1; i <= cellIndex; i++) {
                        await runOneCell(i);
                    }
                    lastRunIndex.value = cellIndex;
                }
                running.value = false;
            }
        };

        // Runs all cells in the notebook.
        const runAllCells = async () => {
            if (!running.value) {
                running.value = true;
                for (let i = lastRunIndex.value + 1; i < notebook.value.cells.length && running.value; i++) {
                    await runOneCell(i);
                }
                running.value = false;
                lastRunIndex.value = notebook.value.cells.length - 1;
            }
        };

        // Function in charge of running one cell in the notebook.
        const runOneCell = async (cellIndex) => {
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
                    console.error('Execution error:', r.message);
                } else {
                    console.log('Cell executed:', cellIndex, r.details);
                    // Update outputs in the notebook model
                    if (notebook.value && notebook.value.cells[cellIndex]) {
                        notebook.value.cells[cellIndex].outputs = r.outputs;
                    }
                }
            } catch (err) {
                console.error('Run error:', err);
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
                console.error('Interrupt error:', err);
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
                console.error('Reset error:', err);
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
            showSettings.value = true;
        };

        const closeSettings = () => {
            showSettings.value = false;
        };

        // 3. Trigger the fetch when the component is mounted
        onMounted(() => {
            fetchNotebook();
            window.addEventListener('keydown', handleKeydown);
        });

        onBeforeUnmount(() => {
            window.removeEventListener('keydown', handleKeydown);
        });

        return { notebook, notebook_name, loading, error, sendExplanationToServer, sendCodeToServer, 
            sendMarkdownToServer, activeIndex, 
            setActiveCell, runCell, running, lastRunIndex, asRead, runAllCells, 
            interruptKernel, showSettings, openSettings, closeSettings, insertCell, markdownEditKey, 
            explanationEditKey, deleteCell, moveCell };
    },
template: `#app-template`,
}).mount('#app');

