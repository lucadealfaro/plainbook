import { ref, computed, watch, onMounted } from './vue.esm-browser.js';
import UnitTestTabBar from './UnitTestTabBar.js';
import UnitTestSubCell from './UnitTestSubCell.js';
import ExplanationEditor from './ExplanationEditor.js';
import CodeCell from './CodeCell.js';
import ValidationCell from './ValidationCell.js';
import OutputRenderer from './OutputRenderer.js';
import CellLabel from './CellLabel.js';

export default {
    components: { UnitTestTabBar, UnitTestSubCell, ExplanationEditor, CodeCell, ValidationCell, OutputRenderer, CellLabel },
    props: ['notebook', 'targetCellIndex', 'authToken', 'running', 'runningActivity',
            'isLocked', 'lastValidCodeCellIndex', 'lastValidOutputCellIndex', 'unitTestValidity'],
    emits: ['exit',
            'save-unit-tests', 'save-unit-test-explanation', 'save-unit-test-code',
            'clear-unit-test-code', 'run-unit-test', 'generate-unit-test-code',
            'add-unit-test', 'delete-unit-test', 'rename-unit-test',
            'save-explanation', 'save-code', 'gencode', 'clearcode', 'validate',
            'interrupt'],
    setup(props, { emit }) {
        const activeTestName = ref(null);
        const activeSubCell = ref('setup');

        const targetCell = computed(() => {
            if (!props.notebook || !props.notebook.cells) return null;
            return props.notebook.cells[props.targetCellIndex];
        });

        const unitTests = computed(() => {
            if (!targetCell.value) return {};
            return targetCell.value.metadata?.unit_tests || {};
        });

        const activeTest = computed(() => {
            if (!activeTestName.value) return null;
            return unitTests.value[activeTestName.value] || null;
        });

        const hasTargetError = computed(() => {
            if (!targetCell.value || !targetCell.value.outputs) return false;
            return targetCell.value.outputs.some(out => out.output_type === 'error');
        });

        const targetCodeValid = computed(() => props.lastValidCodeCellIndex >= props.targetCellIndex);
        const targetOutputValid = computed(() => props.lastValidOutputCellIndex >= props.targetCellIndex);
        const targetOutputVisible = ref(true);

        const activeTestValidity = computed(() => {
            if (!props.unitTestValidity || !activeTestName.value) return null;
            return props.unitTestValidity[activeTestName.value] || null;
        });

        const setupCodeValid = computed(() => activeTestValidity.value?.setup?.code_valid ?? false);
        const setupOutputValid = computed(() => activeTestValidity.value?.setup?.output_valid ?? false);
        const testCodeValid = computed(() => activeTestValidity.value?.test?.code_valid ?? false);
        const testOutputValid = computed(() => activeTestValidity.value?.test?.output_valid ?? false);

        const targetTestOutputs = computed(() => {
            return activeTest.value?.target?.outputs || targetCell.value?.outputs || [];
        });

        // Keep activeTestName valid
        watch(unitTests, (tests) => {
            const names = Object.keys(tests);
            if (names.length === 0) {
                activeTestName.value = null;
            } else if (!activeTestName.value || !(activeTestName.value in tests)) {
                activeTestName.value = names[0];
            }
        }, { immediate: true });

        return {
            activeTestName, activeSubCell, targetCell, unitTests, activeTest,
            hasTargetError, targetCodeValid, targetOutputValid, targetOutputVisible,
            activeTestValidity, setupCodeValid, setupOutputValid, testCodeValid, testOutputValid,
            targetTestOutputs
        };
    },
    template: /* html */ `
        <div v-if="targetCell" style="display: flex; flex-direction: column; flex-grow: 1; min-height: 0;">
            <unit-test-tab-bar
                :tests="unitTests"
                :active-name="activeTestName"
                @select="activeTestName = $event"
                @add="$emit('add-unit-test', targetCellIndex)"
                @rename="(oldName, newName) => $emit('rename-unit-test', targetCellIndex, oldName, newName)"
                @exit="$emit('exit')"
            />

            <!-- Action buttons bar (between tab bar and scrollable area) -->
            <div v-if="activeTest" class="px-4 py-2" style="display: flex; justify-content: space-between; align-items: center; flex-shrink: 0; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                <button class="button is-small is-warning"
                        :disabled="running || isLocked"
                        @click="$emit('run-unit-test', targetCellIndex, activeTestName)">
                    <span class="icon"><i class="bx bx-play"></i></span>
                    <span>Run test</span>
                </button>
                <button class="button is-small is-danger is-outlined"
                        :disabled="running || isLocked"
                        @click="$emit('delete-unit-test', targetCellIndex, activeTestName)">
                    <span class="icon"><i class="bx bx-trash"></i></span>
                    <span>Delete test</span>
                </button>
            </div>

            <div class="section notebook-area" style="padding-top: 1rem; flex-grow: 1; overflow-y: auto;">
            <div v-if="activeTest" class="notebook-container px-2 py-2">

                <!-- Setup sub-cell -->
                <unit-test-sub-cell
                    :cell="activeTest.setup"
                    role="setup"
                    :is-active="activeSubCell === 'setup'"
                    @activate="activeSubCell = 'setup'"
                    :is-locked="isLocked"
                    :running="running"
                    :code-valid="setupCodeValid"
                    :output-valid="setupOutputValid"
                    @save-explanation="(content) => $emit('save-unit-test-explanation', targetCellIndex, activeTestName, 'setup', content)"
                    @save-code="(content) => $emit('save-unit-test-code', targetCellIndex, activeTestName, 'setup', content)"
                    @save-and-run="(content) => { $emit('save-unit-test-explanation', targetCellIndex, activeTestName, 'setup', content); $emit('run-unit-test', targetCellIndex, activeTestName); }"
                    @gencode="$emit('generate-unit-test-code', targetCellIndex, activeTestName, 'setup')"
                    @clearcode="$emit('clear-unit-test-code', targetCellIndex, activeTestName, 'setup')"
                    @validate=""
                    @run="$emit('run-unit-test', targetCellIndex, activeTestName)"
                    @interrupt="$emit('interrupt')"
                />

                <!-- Target cell (read-only-ish display) -->
                <cell-label :name="targetCell.metadata.name" />
                <div class="notebook-cell box p-0 mb-5 is-clipped shadow-sm"
                     @click="activeSubCell = 'target'"
                     :style="{ border: activeSubCell === 'target' ? '2px solid #1d4ed8' : '1px solid transparent', cursor: 'pointer' }">
                    <div class="p-2 has-text-weight-semibold is-size-7 has-text-grey">
                        Target Cell
                    </div>
                    <div class="p-0 border-bottom">
                        <explanation-editor
                            v-model:source="targetCell.metadata.explanation"
                            :hasCode="(targetCell.source || '').trim().length > 0"
                            :isActive="activeSubCell === 'target'"
                            :isLocked="isLocked"
                            :running="running"
                            :asRead="false"
                            :codeValid="targetCodeValid"
                            :outputValid="targetOutputValid"
                            :executed="false"
                            :hasError="hasTargetError"
                            :outputVisible="targetOutputVisible"
                            cellMode="target"
                            @save="(content) => $emit('save-explanation', content)"
                            @toggle-output="targetOutputVisible = !targetOutputVisible"
                            @gencode="$emit('gencode')"
                            @clearcode="$emit('clearcode')"
                            @validate="$emit('validate')"
                            @run="$emit('run-unit-test', targetCellIndex, activeTestName)"
                            @interrupt="$emit('interrupt')"
                            @saveandrun="(content) => { $emit('save-explanation', content); $emit('run-unit-test', targetCellIndex, activeTestName); }"
                            @delete=""
                            @moveUp=""
                            @moveDown="" />
                    </div>

                    <validation-cell
                        v-if="targetCell.metadata?.validation && !targetCell.metadata?.validation.is_hidden"
                        :validation="targetCell.metadata.validation"
                        @dismiss_validation="" />

                    <code-cell
                        v-model:source="targetCell.source"
                        :execution-count="targetCell.execution_count"
                        :is-active="activeSubCell === 'target'"
                        :is-locked="isLocked"
                        :codeValid="targetCodeValid"
                        :outputValid="targetOutputValid"
                        :executed="false"
                        :hasError="hasTargetError"
                        :asRead="false"
                        @save="(content) => $emit('save-code', content)"
                        @activate="" />

                    <div v-if="targetOutputVisible && targetTestOutputs.length" class="p-2 border-top has-background-white">
                        <output-renderer v-for="(out, oIdx) in targetTestOutputs" :key="oIdx" :output="out" />
                    </div>
                </div>

                <!-- Test sub-cell -->
                <unit-test-sub-cell
                    :cell="activeTest.test"
                    role="test"
                    :is-active="activeSubCell === 'test'"
                    @activate="activeSubCell = 'test'"
                    :is-locked="isLocked"
                    :running="running"
                    :code-valid="testCodeValid"
                    :output-valid="testOutputValid"
                    @save-explanation="(content) => $emit('save-unit-test-explanation', targetCellIndex, activeTestName, 'test', content)"
                    @save-code="(content) => $emit('save-unit-test-code', targetCellIndex, activeTestName, 'test', content)"
                    @save-and-run="(content) => { $emit('save-unit-test-explanation', targetCellIndex, activeTestName, 'test', content); $emit('run-unit-test', targetCellIndex, activeTestName); }"
                    @gencode="$emit('generate-unit-test-code', targetCellIndex, activeTestName, 'test')"
                    @clearcode="$emit('clear-unit-test-code', targetCellIndex, activeTestName, 'test')"
                    @validate=""
                    @run="$emit('run-unit-test', targetCellIndex, activeTestName)"
                    @interrupt="$emit('interrupt')"
                />
            </div>

            <div v-else class="notification is-warning mt-4">
                No tests yet. Click the "+" button to add one.
            </div>
            </div>
        </div>
    `
};
