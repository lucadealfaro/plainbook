import { ref, computed, watch } from './vue.esm-browser.js';

// NotebookCell.js
import MarkdownCell from './MarkdownCell.js';
import CodeCell from './CodeCell.js';
import CodeExplanation from './CodeExplanation.js';
import ExplanationEditor from './ExplanationEditor.js';
import ValidationCell from './ValidationCell.js';
import OutputRenderer from './OutputRenderer.js';
import MissingModuleBar from './MissingModuleBar.js';
import { outputsHaveError } from './errorUtils.js';
export default {
    components: { MarkdownCell, CodeCell, CodeExplanation, ExplanationEditor, ValidationCell, OutputRenderer, MissingModuleBar },
    props: ['cell', 'isActive', 'isLocked', 'running', 'codeValid', 'outputValid', 'executed',
        'asRead', 'markdownEditKey', 'explanationEditKey', 'testCodeValid', 'moduleInstall'],
    emits: [
        'save-markdown', 'save-explanation', 'save-code',
        'run-cell', 'save-and-run', 'save-code-and-run', 'generate-code', 'clear-code',
        'validate-code', 'explain-code', 'dismiss-validation',
        'delete', 'move-up', 'move-down',
        'activate', 'interrupt',
        'run-test', 'save-and-run-test', 'save-code-and-run-test', 'generate-test-code', 'open-test-help',
        'open-unit-test',
        'install-module', 'dismiss-module-install',
        'dismiss-error'
    ],
    setup(props, { emit }) {
        const hasError = computed(() => {
            if (!['code', 'test'].includes(props.cell.cell_type)) return false;
            return outputsHaveError(props.cell.outputs);
        });

        const outputVisible = ref(true);

        // Code / explanation tab bar: at most one panel open at a time.
        const openPanel = ref('none'); // 'code' | 'explanation' | 'none'
        const togglePanel = (name) => {
            openPanel.value = openPanel.value === name ? 'none' : name;
        };
        // Auto-open the explanation when one is freshly generated (not on load,
        // hence no `immediate`); collapse if it is removed while shown.
        watch(() => props.cell.metadata?.ai_code_explanation, (nv, ov) => {
            if (nv && nv !== ov) openPanel.value = 'explanation';
            else if (!nv && openPanel.value === 'explanation') openPanel.value = 'none';
        });

        // Missing-module bar: shown when execution failed with a
        // ModuleNotFoundError. The module name is parsed from the error
        // value, e.g. "No module named 'plotly'".
        const missingModule = computed(() => {
            if (!['code', 'test'].includes(props.cell.cell_type)) return null;
            const errOut = (props.cell.outputs || []).find(
                out => out.output_type === 'error' && out.ename === 'ModuleNotFoundError');
            if (!errOut) return null;
            const parts = (errOut.evalue || '').split("'");
            return parts.length > 1 ? parts[1].split('.')[0] : null;
        });

        const moduleBarDismissed = ref(false);
        // A re-run replaces the outputs array: show the bar again.
        watch(() => props.cell.outputs, () => { moduleBarDismissed.value = false; });

        const onModuleRewrite = () => {
            moduleBarDismissed.value = true;
            emit('dismiss-module-install');
            emit(props.cell.cell_type === 'test' ? 'generate-test-code' : 'generate-code');
        };

        const onModuleDismiss = () => {
            moduleBarDismissed.value = true;
            emit('dismiss-module-install');
        };

        return { hasError, outputVisible, missingModule, moduleBarDismissed,
            onModuleRewrite, onModuleDismiss, openPanel, togglePanel };
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
                        @gencode="$emit('generate-code', $event)"
                        @clearcode="$emit('clear-code')"
                        @validate="$emit('validate-code')"
                        @explain="$emit('explain-code')"
                        @run="$emit('run-cell')"
                        @interrupt="$emit('interrupt')"
                        @saveandrun="$emit('save-and-run', $event)"
                        @delete="$emit('delete')"
                        @moveUp="$emit('move-up')"
                        @moveDown="$emit('move-down')"
                        @dismiss-error="$emit('dismiss-error')"
                        @open-unit-test="$emit('open-unit-test')" />
                </div>

                <validation-cell
                    v-if="cell.metadata?.validation && !cell.metadata?.validation.is_hidden"
                    :validation="cell.metadata.validation" 
                    @dismiss_validation="$emit('dismiss-validation')" />

                <!-- Code / explanation tab bar: shown only when focused; the
                     content panels below stay visible when the cell is unfocused. -->
                <div v-show="isActive" class="code-tabs">
                    <button class="button is-ghost panel-tab code-tab"
                            :class="{ 'is-active': openPanel === 'code' }"
                            @click.stop="togglePanel('code')">
                        <span class="icon is-small"><i class="bx" :class="openPanel === 'code' ? 'bx-caret-down' : 'bx-caret-right'"></i></span>
                        <span>{{ openPanel === 'code' ? 'Hide code' : 'Show code' }}</span>
                    </button>
                    <template v-if="cell.metadata?.ai_code_explanation">
                        <div class="panel-divider"></div>
                        <button class="button is-ghost panel-tab code-tab"
                                :class="{ 'is-active': openPanel === 'explanation' }"
                                @click.stop="togglePanel('explanation')">
                            <span class="icon is-small"><i class="bx" :class="openPanel === 'explanation' ? 'bx-caret-down' : 'bx-caret-right'"></i></span>
                            <span>{{ openPanel === 'explanation' ? 'Hide code explanation' : 'Show code explanation' }}</span>
                        </button>
                    </template>
                    <span style="flex: 1;"></span>
                    <!-- right region reserved for future buttons -->
                </div>

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
                    :external-collapse="openPanel !== 'code'"
                    @save="$emit('save-code', $event)"
                    @saveandrun="$emit('save-code-and-run', $event)"
                    @activate="$emit('activate')" />

                <code-explanation v-show="openPanel === 'explanation'"
                    :text="cell.metadata.ai_code_explanation" />

                <div v-if="outputVisible && cell.outputs?.length" class="p-2 border-top bg-scheme-main">
                    <missing-module-bar
                        v-if="missingModule && !moduleBarDismissed"
                        :module-name="missingModule"
                        :install="moduleInstall"
                        :running="running"
                        :is-locked="isLocked"
                        @install="$emit('install-module', missingModule)"
                        @rewrite="onModuleRewrite"
                        @dismiss="onModuleDismiss" />
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
                        @explain="$emit('explain-code')"
                        @run="$emit('run-test')"
                        @interrupt="$emit('interrupt')"
                        @saveandrun="$emit('save-and-run-test', $event)"
                        @open-test-help="$emit('open-test-help')"
                        @delete="$emit('delete')"
                        @moveUp="$emit('move-up')"
                        @moveDown="$emit('move-down')"
                        @dismiss-error="$emit('dismiss-error')" />
                </div>

                <validation-cell
                    v-if="cell.metadata?.validation && !cell.metadata?.validation.is_hidden"
                    :validation="cell.metadata.validation"
                    @dismiss_validation="$emit('dismiss-validation')" />

                <div v-show="isActive" class="code-tabs">
                    <button class="button is-ghost panel-tab code-tab"
                            :class="{ 'is-active': openPanel === 'code' }"
                            @click.stop="togglePanel('code')">
                        <span class="icon is-small"><i class="bx" :class="openPanel === 'code' ? 'bx-caret-down' : 'bx-caret-right'"></i></span>
                        <span>{{ openPanel === 'code' ? 'Hide code' : 'Show code' }}</span>
                    </button>
                    <template v-if="cell.metadata?.ai_code_explanation">
                        <div class="panel-divider"></div>
                        <button class="button is-ghost panel-tab code-tab"
                                :class="{ 'is-active': openPanel === 'explanation' }"
                                @click.stop="togglePanel('explanation')">
                            <span class="icon is-small"><i class="bx" :class="openPanel === 'explanation' ? 'bx-caret-down' : 'bx-caret-right'"></i></span>
                            <span>{{ openPanel === 'explanation' ? 'Hide code explanation' : 'Show code explanation' }}</span>
                        </button>
                    </template>
                    <span style="flex: 1;"></span>
                    <!-- right region reserved for future buttons -->
                </div>

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
                    :external-collapse="openPanel !== 'code'"
                    @save="$emit('save-code', $event)"
                    @saveandrun="$emit('save-code-and-run-test', $event)"
                    @activate="$emit('activate')" />

                <code-explanation v-show="openPanel === 'explanation'"
                    :text="cell.metadata.ai_code_explanation" />

                <div v-if="outputVisible && cell.outputs?.length" class="p-2 border-top bg-scheme-main">
                    <missing-module-bar
                        v-if="missingModule && !moduleBarDismissed"
                        :module-name="missingModule"
                        :install="moduleInstall"
                        :running="running"
                        :is-locked="isLocked"
                        @install="$emit('install-module', missingModule)"
                        @rewrite="onModuleRewrite"
                        @dismiss="onModuleDismiss" />
                    <output-renderer v-for="(out, oIdx) in cell.outputs" :key="oIdx" :output="out" />
                </div>
            </div>
        </div>
    `
};