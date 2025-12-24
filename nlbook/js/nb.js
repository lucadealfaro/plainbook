import { createApp, ref, onMounted, onBeforeUnmount } from './vue.esm-browser.js';

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
        const loading = ref(true);
        const error = ref(null);
        const activeIndex = ref(-1);

        // For running a notebook.
        const running = ref(false);
        const lastRunIndex = ref(-1);

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
                console.log("Fetched notebook:", notebook.value);
                console.log("Original response:", r);
            } catch (err) {
                error.value = err.message;
                console.error("Fetch error:", err);
            } finally {
                loading.value = false;
            }
        };

        const sendExplanationToServer = async (content, cellIndex) => {
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

        const setActiveCell = (idx) => { activeIndex.value = idx; };

        const sendRedoToServer = async (cellIndex) => {
            try {
                const response = await fetch(`/redo?token=${authToken}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ cell_index: cellIndex })
                });
                if (!response.ok) throw new Error('Failed to redo');
                console.log('Redo executed for cell:', cellIndex);
            } catch (err) {
                console.error('Redo error:', err);
            }
        };

        // Runs cells up to the present one. 
        const runUpToCell = async (cellIndex) => {
            if (!running.value) {
                running.value = true;
                for (let i = lastRunIndex.value + 1; i <= cellIndex; i++) {
                    await runOneCell(i);
                }
                running.value = false;
                lastRunIndex.value = cellIndex;
            }
        };

        // Runs all cells in the notebook.
        const runAllCells = async () => {
            if (!running.value) {
                running.value = true;
                for (let i = lastRunIndex.value + 1; i < notebook.value.cells.length; i++) {
                    await runOneCell(i);
                }
                running.value = false;
                lastRunIndex.value = notebook.value.cells.length - 1;
            }
        };

        const runOneCell = async (cellIndex) => {
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

        const handleKeydown = (e) => {
            // Here we can send the code for execution too. 
            if (!e.shiftKey || e.key !== 'Enter') return;
            if (!notebook.value || activeIndex.value < 0) return;
            e.preventDefault();
            const next = Math.min(activeIndex.value + 1, notebook.value.cells.length - 1);
            if (next !== activeIndex.value) setActiveCell(next);
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

        return { notebook, loading, error, sendExplanationToServer, sendCodeToServer, activeIndex, 
            setActiveCell, sendRedoToServer, runUpToCell, runOneCell, running, lastRunIndex, runAllCells, interruptKernel,
            showSettings, openSettings, closeSettings };
    },
template: `#app-template`,
}).mount('#app');

