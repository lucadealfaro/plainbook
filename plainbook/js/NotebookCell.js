import { ref, computed } from './vue.esm-browser.js';

// NotebookCell.js
import MarkdownCell from './MarkdownCell.js';
import CodeCell from './CodeCell.js';
import ExplanationEditor from './ExplanationEditor.js';
import ValidationCell from './ValidationCell.js';
import OutputRenderer from './OutputRenderer.js';
export default {
    components: { MarkdownCell, CodeCell, ExplanationEditor, ValidationCell, OutputRenderer },
    props: ['cell', 'isActive', 'isLocked', 'codeValid', 'outputValid', 'executed', 
        'asRead', 'markdownEditKey', 'explanationEditKey'],
    emits: [
        'save-markdown', 'save-explanation', 'save-code',
        'run-cell', 'save-and-run', 'generate-code', 'clear-code',
        'validate-code', 'dismiss-validation',
        'delete', 'move-up', 'move-down',
        'activate'
    ],
    setup(props, { emit }) {
        const hasError = computed(() => {
            if (props.cell.cell_type !== 'code') return false;
            if (!props.cell.outputs) return false;
            return props.cell.outputs.some(out => out.output_type === 'error');
        });

        const outputVisible = ref(true);

        return { hasError, outputVisible };
    },
    template: /* html */ `
        <div class="notebook-cell box p-0 mb-2 is-clipped shadow-sm"
             @click="$emit('activate')"
             :style="{
                border: isActive ? '2px solid #1d4ed8' : '1px solid transparent',
                cursor: 'pointer'
             }">
            
            <markdown-cell 
                v-if="cell.cell_type === 'markdown'" 
                v-model:source="cell.source" 
                :is-active="isActive"
                :start-edit-key="markdownEditKey"
                :isLocked="isLocked" 
                @save="$emit('save-markdown', $event)"
                @delete="$emit('delete')"
                @moveUp="$emit('move-up')"
                @moveDown="$emit('move-down')" />

            <div v-else-if="cell.cell_type === 'code'">
                <div class="has-background-light p-0 border-bottom">
                <explanation-editor 
                        v-model:source="cell.metadata.explanation"
                        :hasCode="(cell.source || '').trim().length > 0"
                        :isActive="isActive" 
                        :isLocked="isLocked" 
                        :asRead="asRead"
                        :codeValid="codeValid"
                        :outputValid="outputValid"
                        :executed="executed"
                        :hasError="hasError"
                        :outputVisible="outputVisible"
                        :start-edit-key="explanationEditKey"
                        @save="$emit('save-explanation', $event)"
                        @toggle-output="outputVisible = !outputVisible"
                        @gencode="$emit('generate-code')"
                        @clearcode="$emit('clear-code')"
                        @validate="$emit('validate-code')"
                        @run="$emit('run-cell')"
                        @saveandrun="$emit('save-and-run', $event)"
                        @delete="$emit('delete')"
                        @moveUp="$emit('move-up')"
                        @moveDown="$emit('move-down')" />
                </div>

                <validation-cell 
                    v-if="cell.metadata?.validation && !cell.metadata?.validation.is_hidden"
                    :validation="cell.metadata.validation" 
                    @dismiss_validation="$emit('dismiss-validation')" />

                <code-cell  
                    v-model:source="cell.source" 
                    :execution-count="cell.execution_count" 
                    :is-active="isActive"
                    :is-locked="isLocked"
                    :codeValid="codeValid"
                    :outputValid="outputValid"
                    :executed="executed"
                    :hasError="hasError"
                    :asRead="asRead"
                    @save="$emit('save-code', $event)"
                    @activate="$emit('activate')" />
                
                <div v-if="outputVisible && cell.outputs?.length" class="p-2 border-top has-background-white">
                    <output-renderer v-for="(out, oIdx) in cell.outputs" :key="oIdx" :output="out" />
                </div>
            </div>
        </div>
    `
};