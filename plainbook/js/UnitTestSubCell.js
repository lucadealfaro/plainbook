import { ref, computed, watch, onMounted, nextTick } from './vue.esm-browser.js';
import ExplanationEditor from './ExplanationEditor.js';
import CodeCell from './CodeCell.js';
import ValidationCell from './ValidationCell.js';
import OutputRenderer from './OutputRenderer.js';

export default {
    components: { ExplanationEditor, CodeCell, ValidationCell, OutputRenderer },
    props: ['cell', 'role', 'isActive', 'isLocked', 'running', 'codeValid', 'outputValid'],
    emits: ['save-explanation', 'save-code', 'save-and-run', 'gencode', 'clearcode', 'validate', 'dismiss-validation', 'run', 'interrupt', 'activate'],
    setup(props) {
        const mode = computed(() => props.role === 'setup' ? 'unit_setup' : 'unit_test');
        const hasError = computed(() => {
            if (!props.cell || !props.cell.outputs) return false;
            return props.cell.outputs.some(out => out.output_type === 'error');
        });
        const hasCode = computed(() => (props.cell.source || '').trim().length > 0);
        const explanation = computed(() => props.cell.metadata?.explanation || '');
        const outputVisible = ref(true);
        const startEditKey = ref(undefined);

        // Auto-enter edit mode when cell becomes active with empty explanation
        watch(() => props.isActive, (active) => {
            if (active && !explanation.value) {
                startEditKey.value = Date.now();
            }
        });

        // Handle initial mount: if already active with empty explanation, trigger edit after children mount
        onMounted(() => {
            if (props.isActive && !explanation.value) {
                nextTick(() => { startEditKey.value = Date.now(); });
            }
        });

        const triggerEdit = () => {
            startEditKey.value = Date.now();
        };

        return { mode, hasError, hasCode, explanation, outputVisible, startEditKey, triggerEdit };
    },
    template: /* html */ `
        <div class="unit-test-sub-cell notebook-cell box p-0 mb-5 is-clipped shadow-sm"
             @click="$emit('activate')"
             :class="{ 'is-active-cell': isActive }"
             style="cursor: pointer">
            <div class="p-2 has-text-weight-semibold is-size-7 text-muted bg-warning-adaptive"
                 @dblclick="triggerEdit">
                {{ role === 'setup' ? 'Data Preparation' : 'Test' }}
            </div>
            <div class="p-0 border-bottom bg-warning-adaptive" @dblclick="triggerEdit">
                <explanation-editor
                    v-model:source="cell.metadata.explanation"
                    :hasCode="hasCode"
                    :isActive="isActive"
                    :isLocked="isLocked"
                    :running="running"
                    :asRead="false"
                    :codeValid="codeValid"
                    :outputValid="outputValid"
                    :executed="false"
                    :hasError="hasError"
                    :outputVisible="outputVisible"
                    :cellMode="mode"
                    :startEditKey="startEditKey"
                    @save="$emit('save-explanation', $event)"
                    @toggle-output="outputVisible = !outputVisible"
                    @gencode="$emit('gencode')"
                    @clearcode="$emit('clearcode')"
                    @validate="$emit('validate')"
                    @run="$emit('run')"
                    @interrupt="$emit('interrupt')"
                    @saveandrun="$emit('save-and-run', $event)"
                    @delete=""
                    @moveUp=""
                    @moveDown="" />
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
                :executed="false"
                :hasError="hasError"
                :asRead="false"
                @save="$emit('save-code', $event)"
                @activate="" />

            <div v-if="outputVisible && cell.outputs?.length" class="p-2 border-top bg-scheme-main">
                <output-renderer v-for="(out, oIdx) in cell.outputs" :key="oIdx" :output="out" />
            </div>
        </div>
    `
};
