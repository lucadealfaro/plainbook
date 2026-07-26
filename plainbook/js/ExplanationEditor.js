import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from './vue.esm-browser.js';

const ExplanationRenderer = {
    props: ['source', 'isActive', 'codeValid', 'outputValid', 'executed', 'hasError',
            'asRead', 'startEditKey', 'isLocked', 'running', 'hasCode', 'outputVisible', 'cellMode',
            'unitTestCount', 'aiDescriptionVisible'],
    emits: ['update:source', 'save', 'saveandrun', 'gencode', 'clearcode', 'validate', 'explain',
            'run', 'interrupt', 'delete', 'moveUp', 'moveDown', 'toggle-output', 'open-test-help',
            'open-unit-test', 'dismiss-error', 'toggle-ai-description'],
    setup(props, { emit }) {
        const mode = computed(() => props.cellMode || 'normal');
        const isTestCell = computed(() => mode.value === 'test');
        const showRun = computed(() => ['normal', 'test', 'unit_setup', 'target', 'unit_test'].includes(mode.value));
        const showMoveUpDown = computed(() => ['normal', 'test'].includes(mode.value));
        const showDelete = computed(() => ['normal', 'test'].includes(mode.value));
        const showTestHelp = computed(() => mode.value === 'test');
        const showUnitTest = computed(() => mode.value === 'normal');
        const showSaveAndRun = computed(() => ['normal', 'test', 'unit_setup', 'target', 'unit_test'].includes(mode.value));
        const isEditing = ref(false);
        const localSource = ref((Array.isArray(props.source) ? props.source.join('') : props.source) || '');
        const originalSource = ref(localSource.value);
        const md = window.markdownit ? window.markdownit({ html: true, linkify: true, typographer: true }) : { render: (x) => x };
        const textareaEl = ref(null);
        const localIsLocked = ref(props.isLocked);
        const explanationBody = ref(null);

        const rendered = computed(() => md.render(localSource.value));

        const renderMath = () => {
            if (!window.renderMathInElement) return;
            nextTick(() => {
                const els = document.querySelectorAll('.explanation-body');
                els.forEach(el => {
                    try {
                        window.renderMathInElement(el, {
                            delimiters: [
                                {left: '$$', right: '$$', display: true},
                                {left: '$', right: '$', display: false},
                                {left: '\\(', right: '\\)', display: false},
                                {left: '\\[', right: '\\]', display: true}
                            ],
                            throwOnError: false
                        });
                    } catch (e) {
                        console.error('KaTeX error:', e);
                    }
                });
            });
        };

        onMounted(() => {
            renderMath();
            window.addEventListener('plainbook:flush-edits', handleFlushEdits);
        });

        onBeforeUnmount(() => {
            window.removeEventListener('plainbook:flush-edits', handleFlushEdits);
        });

        watch([rendered], () => {
            renderMath();
        });

        const autoResize = () => {
            const el = textareaEl.value;
            if (!el) return;
            el.style.boxSizing = 'border-box';
            el.style.overflow = 'hidden';
            el.style.resize = 'none';
            el.style.height = 'auto';
            el.style.height = `${el.scrollHeight}px`;
        };

        watch(() => props.source, (val) => {
            localSource.value = (Array.isArray(val) ? val.join('') : val) || '';
            nextTick(autoResize);
        });

        watch(() => props.isActive, (newVal) => {
            if (!newVal && isEditing.value) {
                saveChanges();
            }
            if (newVal && isTestCell.value && !localSource.value.trim()) {
                enterEditMode();
            }
        });

        watch(() => props.isLocked, (newVal) => {
            localIsLocked.value = newVal;
            if (newVal) {
                cancelEdit();
            }
        });

        const enterEditMode = () => {
            originalSource.value = localSource.value;
            isEditing.value = true;
            nextTick(() => {
                autoResize();
            });
        };

        watch(() => props.startEditKey, (newVal) => {
            if (newVal !== undefined) {
                enterEditMode();
                nextTick(() => {
                    if (textareaEl.value) textareaEl.value.focus();
                });
            }
        });

        const saveChanges = () => {
            if (!isEditing.value) return;
            isEditing.value = false;
            emit('save', localSource.value);
        };

        const saveAndRun = () => {
            isEditing.value = false;
            emit('saveandrun', localSource.value);
        };

        const handleFlushEdits = () => {
            if (isEditing.value) {
                saveChanges();
            }
        };

        const onBlur = () => {
            window.dispatchEvent(new Event('plainbook:flush-edits'));
        };

        const cancelEdit = () => {
            const originalIsEmpty = !originalSource.value || originalSource.value.trim().length === 0;
            if (originalIsEmpty && !props.hasCode) {
                isEditing.value = false;
                emit('delete');
                return;
            }
            localSource.value = originalSource.value;
            isEditing.value = false;
        };

        const generating = ref(false);
        const onGenCode = () => {
            generating.value = true;
            emit('gencode', props.hasError);
        };
        const validating = ref(false);
        const onValidate = () => {
            validating.value = true;
            emit('validate');
        };
        const explaining = ref(false);
        const showExplainModal = ref(false);
        const explanationLevel = ref(2);
        const useBullets = ref(true);
        const useLatex = ref(true);

        const onExplain = () => {
            showExplainModal.value = true;
        };

        const confirmExplain = () => {
            showExplainModal.value = false;
            explaining.value = true;
            emit('explain', {
                level: explanationLevel.value,
                use_bullets: useBullets.value,
                use_latex: useLatex.value
            });
        };

        const explanationLevelLabel = computed(() => {
            const labels = { 1: 'Brief', 2: 'Normal', 3: 'Detailed', 4: 'Expert' };
            return labels[explanationLevel.value];
        });

        watch(() => props.running, (val) => {
            if (!val) {
                generating.value = false;
                validating.value = false;
                explaining.value = false;
            }
        });

        const clearLabel = computed(() => 'Clear code');
        const generateLabel = computed(() => {
            if (props.hasError) return 'Fix Code';
            if (props.hasCode) return 'Regenerate code';
            return 'Generate code';
        });
        const stopGenerateLabel = computed(() => {
            if (props.hasError) return 'Stop fixing';
            return 'Stop generating';
        });
        const validateLabel = computed(() => 'Validate code');

        const placeholderText = computed(() => {
            if (mode.value === 'unit_setup') return 'Describe how to prepare the data...';
            if (mode.value === 'unit_test') return 'Describe what should be checked...';
            return 'Explain what the cell should do...';
        });

        const onButtonPress = (event) => {
            if (event.target.closest('button')) emit('dismiss-error');
        };

        return { isEditing, localSource, rendered, enterEditMode, saveChanges,
            cancelEdit, textareaEl, autoResize, saveAndRun, onBlur, localIsLocked,
            isTestCell, clearLabel, generateLabel, stopGenerateLabel, validateLabel,
            generating, onGenCode, validating, onValidate,
            explaining, onExplain, showExplainModal, explanationLevel, explanationLevelLabel,
            useBullets, useLatex, confirmExplain,
            onButtonPress,
            mode, showRun, showMoveUpDown, showDelete, showTestHelp, showUnitTest, showSaveAndRun,
            placeholderText };
    },

    template: /* html */ `
        <div class="explanation-container pl-4 pr-4 pb-1 pt-3">
            <div v-if="!isEditing"
                 class="explanation-body content"
                 ref="explanationBody"
                 v-html="rendered" @dblclick="enterEditMode">
            </div>
            <div v-else class="explanation-editor-active">
                <textarea
                    ref="textareaEl"
                    v-model="localSource"
                    class="textarea is-small"
                    :placeholder="placeholderText"
                    :disabled="localIsLocked"
                    @input="autoResize"
                    @blur="onBlur"
                    @keydown.meta.enter="saveAndRun"
                    @keydown.ctrl.enter="saveAndRun"
                    @keydown.esc="cancelEdit"></textarea>
                <div class="buttons mt-1 is-right">
                    <button class="button is-small" @click="cancelEdit">Cancel</button>
                    <button class="button is-small is-info" @click="saveChanges">Save</button>
                    <button v-if="showSaveAndRun" class="button is-small is-primary" @click="saveAndRun">Save & Run</button>
                </div>
            </div>
        </div>

        <div v-if="!isEditing && isActive" class="explanation-toolbar pl-3 pr-3" style="flex-wrap: wrap;" @click.capture="onButtonPress">
            <div class="toolbar-left">
                <template v-if="showRun">
                    <button v-if="running" class="button run-button is-small mr-1 is-primary" @click.stop="$emit('interrupt')">
                        <span class="icon"><i class="bx bx-stop-circle"></i></span><span>Interrupt</span>
                    </button>
                    <button v-else class="button run-button is-small mr-1" :class="isTestCell ? 'is-warning' : 'is-primary'" @click.stop="$emit('run')">
                        <span class="icon"><i class="bx bx-play"></i></span><span>{{ isTestCell ? 'Run test' : 'Run' }}</span>
                    </button>
                </template>

                <button class="button is-small" style="opacity: 0.6;" @click.stop="$emit('toggle-output')">
                    <span class="icon"><i :class="outputVisible ? 'bx bx-eye-slash' : 'bx bx-eye'"></i></span>
                    <span>Output: {{ !codeValid || !outputValid ? 'Stale' : (asRead ? 'Unmodified' : 'Up to date') }}</span>
                </button>

                <button class="button is-small ml-1" style="opacity: 0.6;" @click.stop="$emit('toggle-ai-description')">
                    <span class="icon"><i :class="aiDescriptionVisible ? 'bx bx-chevron-down' : 'bx bx-chevron-right'"></i></span>
                    <span>AI Description</span>
                </button>
            </div>

            <div class="toolbar-right" style="display: flex; flex-wrap: wrap; gap: 0.25rem;">
                <button class="button is-small is-info" :disabled="localIsLocked" @click.stop="enterEditMode">
                    <span class="icon"><i class="bx bx-pencil"></i></span><span>Edit</span>
                </button>
                <button v-if="showUnitTest" class="button is-small is-warning" @click.stop="$emit('open-unit-test')">
                    <span v-if="unitTestCount" class="unit-test-counter mr-1" style="font-weight: 600;">{{ unitTestCount }}</span>
                    <span class="icon"><i class="bx bx-medical-flask"></i></span><span>Test this cell</span>
                </button>
                <button class="button is-small" :class="isTestCell ? 'is-warning' : 'is-success'" :disabled="localIsLocked || !hasCode" @click.stop="$emit('clearcode')">
                    <span class="icon"><i class="bx bx-eraser"></i></span><span>Clear code</span>
                </button>
                <button v-if="!hasError" class="button is-small" :class="isTestCell ? 'is-warning' : 'is-success'" :disabled="running || localIsLocked || !localSource.trim()" @click.stop="onGenCode">
                    <span class="icon"><i class="bx bx-cognition"></i></span><span>{{ generateLabel }}</span>
                </button>
                <button v-else class="button is-small is-warning has-text-weight-bold" :disabled="running || localIsLocked" @click.stop="onGenCode">
                    <span class="icon"><i class="bx bx-cognition"></i></span><span>Fix Code</span>
                </button>
                <button v-else :disabled="running || !codeValid" class="button is-small" :class="isTestCell ? 'is-warning' : 'is-success'" @click.stop="onValidate">
                    <span class="icon"><i class="bx bx-check"></i></span><span>{{ validateLabel }}</span>
                </button>
                <button :disabled="running || !hasCode" class="button is-small" style="background-color: #b86bff; color: white; border-color: #b86bff;" @click.stop="onExplain">
                    <span class="icon"><i class="bx bx-help-circle"></i></span><span>Explain code</span>
                </button>
                <button v-if="showDelete" class="button is-small is-danger py-1" :disabled="localIsLocked" @click.stop="$emit('delete')">
                    <span class="icon"><i class="bx bx-trash"></i></span>
                </button>
            </div>
        </div>

        <div class="modal" :class="{'is-active': showExplainModal}">
            <div class="modal-background" @click="showExplainModal = false"></div>
            <div class="modal-card" style="max-width: 400px;">
                <header class="modal-card-head py-3">
                    <p class="modal-card-title is-size-5">Explain Code</p>
                    <button class="delete" @click="showExplainModal = false"></button>
                </header>
                <section class="modal-card-body">
                    <div class="field">
                        <label class="label">Detail: <strong>{{ explanationLevelLabel }}</strong></label>
                        <input class="slider is-fullwidth is-primary" type="range" min="1" max="4" step="1" v-model.number="explanationLevel" style="width: 100%;">
                    </div>
                    <div class="field mt-4"><label class="checkbox"><input type="checkbox" v-model="useBullets"> Include bullet points</label></div>
                    <div class="field"><label class="checkbox"><input type="checkbox" v-model="useLatex"> Use LaTeX for equations</label></div>
                </section>
                <footer class="modal-card-foot py-3" style="justify-content: flex-end;">
                    <button class="button is-small" @click="showExplainModal = false">Cancel</button>
                    <button class="button is-small is-primary" style="background-color: #b86bff; border-color: #b86bff;" @click="confirmExplain">Explain</button>
                </footer>
            </div>
        </div>
    `
};

export default ExplanationRenderer;
