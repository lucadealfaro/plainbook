import { createApp, ref, onMounted, onBeforeUnmount } from './vue.esm-browser.js';

import MarkdownCell from './MarkdownCell.js';
import OutputRenderer from './OutputRenderer.js';
import CodeCell from './CodeCell.js';
import ExplanationEditor from './ExplanationEditor.js';

createApp({
    components: { MarkdownCell, CodeCell, ExplanationEditor, OutputRenderer },
    setup() {
        // 1. Initialize notebook as null
        const notebook = ref(null);
        const loading = ref(true);
        const error = ref(null);
        const activeIndex = ref(-1);

        // 2. Define the fetch logic
        const fetchNotebook = async () => {
            try {
                loading.value = true;
                // Replace this URL with your actual callback endpoint
                const response = await fetch('/get_notebook');
                
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
                const response = await fetch('/edit_explanation', {
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
                const response = await fetch('/edit_code', {
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
                const response = await fetch('/redo', {
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

        const handleKeydown = (e) => {
            // Here we can send the code for execution too. 
            if (!e.shiftKey || e.key !== 'Enter') return;
            if (!notebook.value || activeIndex.value < 0) return;
            e.preventDefault();
            const next = Math.min(activeIndex.value + 1, notebook.value.cells.length - 1);
            if (next !== activeIndex.value) setActiveCell(next);
        };

        // 3. Trigger the fetch when the component is mounted
        onMounted(() => {
            fetchNotebook();
            window.addEventListener('keydown', handleKeydown);
        });

        onBeforeUnmount(() => {
            window.removeEventListener('keydown', handleKeydown);
        });

        return { notebook, loading, error, sendExplanationToServer, sendCodeToServer, activeIndex, setActiveCell, sendRedoToServer };
    },
    template: /* html */ `
        <div class="notebook-container px-2 py-2">
            
            <div v-if="loading" class="has-text-centered py-6">
                <button class="button is-loading is-ghost is-large">Loading</button>
                <p class="has-text-grey">Fetching notebook data...</p>
            </div>

            <div v-else-if="error" class="notification is-danger is-light">
                <button class="delete" @click="error = null"></button>
                <strong>Error:</strong> {{ error }}
            </div>

            <div v-else-if="notebook">
                <div v-for="(cell, index) in notebook.cells" :key="index"
                     class="notebook-cell box p-0 mb-5 is-clipped shadow-sm"
                     @click="setActiveCell(index)"
                     :style="{
                        border: activeIndex === index ? '2px solid #1d4ed8' : '1px solid transparent',
                        cursor: 'pointer'
                     }">
                    <markdown-cell v-if="cell.cell_type === 'markdown'" :source="cell.source" />

                    <div v-else-if="cell.cell_type === 'code'">
                        <div v-if="cell.metadata?.explanation" class="has-background-light p-2 border-bottom">
                            <explanation-editor v-model:source="cell.metadata.explanation" :isActive="activeIndex === index" @save="(content) => sendExplanationToServer(content, index)" @redo="() => sendRedoToServer(index)" />
                        </div>
                        <code-cell v-model:source="cell.source" :execution-count="cell.execution_count" @save="(content) => sendCodeToServer(content, index)" />
                        
                        <div v-if="cell.outputs?.length" class="p-2 border-top has-background-white">
                            <output-renderer v-for="(out, oIdx) in cell.outputs" :key="oIdx" :output="out" />
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `
}).mount('#app');

