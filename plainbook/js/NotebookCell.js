import { ref, computed } from './vue.esm-browser.js';

// NotebookCell.js
import MarkdownCell from './MarkdownCell.js';
import CodeCell from './CodeCell.js';
import ExplanationEditor from './ExplanationEditor.js';
import ValidationCell from './ValidationCell.js';
import OutputRenderer from './OutputRenderer.js';
export default {
    components: { MarkdownCell, CodeCell, ExplanationEditor, ValidationCell, OutputRenderer },
    props: ['cell', 'isActive', 'isLocked', 'running', 'codeValid', 'outputValid', 'executed',
        'asRead', 'markdownEditKey', 'explanationEditKey', 'testCodeValid'],
    emits: [
        'save-markdown', 'save-explanation', 'save-code',
        'run-cell', 'save-and-run', 'generate-code', 'clear-code',
        'validate-code', 'dismiss-validation',
        'delete', 'move-up', 'move-down',
        'activate', 'interrupt',
        'run-test', 'save-and-run-test', 'generate-test-code', 'open-test-help',
        'open-unit-test'
    ],
    setup(props, { emit }) {
        const hasError = computed(() => {
            if (!['code', 'test'].includes(props.cell.cell_type)) return false;
            if (!props.cell.outputs) return false;
            return props.cell.outputs.some(out => out.output_type === 'error');
        });

        const outputVisible = ref(true);

        return { hasError, outputVisible };
    },
    template: /* html */ `
        <div class="notebook-cell box p-0 mb-2 is-clipped shadow-sm"
             @click="$emit('activate')"
             :class="{ 'is-active-cell': isActive }"
             style="cursor: pointer">
            
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
                <div class="bg-scheme-bis p-0 border-bottom">
                <explanation-editor
                        v-model:source="cell.metadata.explanation"
                        :hasCode="(cell.source || '').trim().length > 0"
                        :isActive="isActive"
                        :isLocked="isLocked"
                        :running="running"
                        :asRead="asRead"
                        :codeValid="codeValid"
                        :outputValid="outputValid"
                        :executed="executed"
                        :hasError="hasError"
                        :outputVisible="outputVisible"
                        :start-edit-key="explanationEditKey"
                        :unit-test-count="Object.keys(cell.metadata.unit_tests || {}).length"
                        @save="$emit('save-explanation', $event)"
                        @toggle-output="outputVisible = !outputVisible"
                        @gencode="$emit('generate-code')"
                        @clearcode="$emit('clear-code')"
                        @validate="$emit('validate-code')"
                        @run="$emit('run-cell')"
                        @interrupt="$emit('interrupt')"
                        @saveandrun="$emit('save-and-run', $event)"
                        @delete="$emit('delete')"
                        @moveUp="$emit('move-up')"
                        @moveDown="$emit('move-down')"
                        @open-unit-test="$emit('open-unit-test')" />
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
                
                <div v-if="outputVisible && cell.outputs?.length" class="p-2 border-top bg-scheme-main">
                    <output-renderer v-for="(out, oIdx) in cell.outputs" :key="oIdx" :output="out" />
                </div>
            </div>

            <div v-else-if="cell.cell_type === 'test'">
                <div class="bg-warning-adaptive p-0 border-bottom">
                <explanation-editor
                        v-model:source="cell.metadata.explanation"
                        :hasCode="(cell.source || '').trim().length > 0"
                        :isActive="isActive"
                        :isLocked="isLocked"
                        :running="running"
                        :asRead="asRead"
                        :codeValid="testCodeValid"
                        :outputValid="testCodeValid"
                        :executed="false"
                        :hasError="hasError"
                        :outputVisible="outputVisible"
                        :start-edit-key="explanationEditKey"
                        cellMode="test"
                        @save="$emit('save-explanation', $event)"
                        @toggle-output="outputVisible = !outputVisible"
                        @gencode="$emit('generate-test-code')"
                        @clearcode="$emit('clear-code')"
                        @validate="$emit('validate-code')"
                        @run="$emit('run-test')"
                        @interrupt="$emit('interrupt')"
                        @saveandrun="$emit('save-and-run-test', $event)"
                        @open-test-help="$emit('open-test-help')"
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
                    :codeValid="testCodeValid"
                    :outputValid="testCodeValid"
                    :executed="false"
                    :hasError="hasError"
                    :asRead="asRead"
                    @save="$emit('save-code', $event)"
                    @activate="$emit('activate')" />

                <div v-if="outputVisible && cell.outputs?.length" class="p-2 border-top bg-scheme-main">
                    <output-renderer v-for="(out, oIdx) in cell.outputs" :key="oIdx" :output="out" />
                </div>
            </div>
        </div>
    `
};