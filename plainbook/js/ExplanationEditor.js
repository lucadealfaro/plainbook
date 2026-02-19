import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from './vue.esm-browser.js';

const ExplanationRenderer = {
    props: ['source', 'isActive', 'codeValid', 'outputValid', 'executed', 'hasError',
            'asRead', 'startEditKey', 'isLocked', 'hasCode', 'outputVisible'],
    emits: ['update:source', 'save', 'saveandrun', 'gencode', 'clearcode', 'validate',
            'run', 'delete', 'moveUp', 'moveDown', 'toggle-output'],
    setup(props, { emit }) {    
        const isEditing = ref(false);
        const localSource = ref((Array.isArray(props.source) ? props.source.join('') : props.source) || '');
        const originalSource = ref(localSource.value);
        const md = new markdownit({ html: true });
        const textareaEl = ref(null);
        const localIsLocked = ref(props.isLocked);


        const rendered = computed(() => md.render(localSource.value));

        const autoResize = () => {
            const el = textareaEl.value;
            if (!el) return;
            el.style.boxSizing = 'border-box';
            el.style.overflow = 'hidden';
            el.style.resize = 'none';
            el.style.height = 'auto';
            el.style.height = `${el.scrollHeight}px`;
        };

        // keep local copy in sync if parent changes
        watch(() => props.source, (val) => {
            localSource.value = (Array.isArray(val) ? val.join('') : val) || '';
            nextTick(autoResize);
        });

        watch(() => props.isActive, (newVal) => {
            if (!newVal && isEditing.value) {
                saveChanges();
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
                // if (textareaEl.value) textareaEl.value.scrollTop = 0;
            });
        };

        watch(() => props.startEditKey, (newVal) => {
            if (newVal !== undefined) {
                enterEditMode();
                // Force focus after autoResize
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

        // Handler for the flush-edits event: save if currently editing.
        const handleFlushEdits = () => {
            if (isEditing.value) {
                saveChanges();
            }
        };

        // On blur, dispatch the flush event (which this and other editors listen for).
        const onBlur = () => {
            window.dispatchEvent(new Event('plainbook:flush-edits'));
        };

        onMounted(() => {
            window.addEventListener('plainbook:flush-edits', handleFlushEdits);
        });
        onBeforeUnmount(() => {
            window.removeEventListener('plainbook:flush-edits', handleFlushEdits);
        });

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

        return { isEditing, localSource, rendered, enterEditMode, saveChanges,
            cancelEdit, textareaEl, autoResize, saveAndRun, onBlur, localIsLocked };
    },

    template: /* html */ `
        <div class="explanation-container pt-3 pl-4 pr-4 pb-1">
            <div v-if="!isEditing" 
                 class="explanation-body content"
                 v-html="rendered" @dblclick="enterEditMode">
            </div>
        </div>
        <div v-if="!isEditing && isActive"
                class="explanation-toolbar has-background-grey-lighter pl-3 pr-3"
                style="display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.5rem">
            <div class="toolbar-left">
                <button class="button run-button is-small is-primary mr-1" 
                        title="Run this cell and all necessary preceding cells" @click.stop="$emit('run')">
                    <span class="icon"><i class="bx bx-play"></i></span><span>Run</span>
                </button>
                <button class="button is-small" style="opacity: 0.6;"
                    title="Toggle output visibility"
                    @click.stop="$emit('toggle-output')">
                    <span class="icon">
                        <i :class="outputVisible ? 'bx bx-eye-slash' : 'bx bx-eye'"></i>
                    </span>
                    <span>Output:&nbsp;</span>
                    <span v-if="!codeValid">Stale</span>
                    <span v-else-if="!outputValid">Stale</span>
                    <span v-else-if="asRead">Unmodified</span>
                    <span v-else>Up to date</span>
                </button>
            </div>
            <div class="toolbar-right" style="display: flex; flex-wrap: wrap; gap: 0.25rem;">
                <button class="button is-small is-info" title="Edit action description" 
                        :disabled="localIsLocked" @click.stop="enterEditMode">
                    <span class="icon"><i class="bx bx-pencil"></i></span><span>Edit</span>
                </button>
                <button class="button is-small is-info py-1 " 
                        :disabled="localIsLocked"
                        title="Move cell up" aria-label="Move Up" @click.stop="$emit('moveUp')">
                    <span class="icon"><i class="bx bx-arrow-up"></i></span>
                </button>
                <button class="button is-small is-info py-1 " 
                        :disabled="localIsLocked"
                        title="Move cell down" aria-label="Move Down" @click.stop="$emit('moveDown')">
                    <span class="icon"><i class="bx bx-arrow-down"></i></span>
                </button>
                <button class="button is-small"
                        :class="hasError ? 'is-warning' : 'is-success'"
                        title="Clear code"
                        :disabled="localIsLocked || !hasCode" @click.stop="$emit('clearcode')">
                    <span class="icon"><i class="bx bx-eraser"></i></span>
                    <span>Clear Code</span>
                </button>
                <button class="button is-small"
                        :class="hasError ? 'is-warning' : 'is-success'"
                        title="Generate code from description"
                        :disabled="localIsLocked" @click.stop="$emit('gencode')">
                    <span class="icon"><i class="bx bx-cognition"></i></span>
                    <span v-if="hasError">Fix Code</span>
                    <span v-else-if="hasCode">Regenerate Code</span>
                    <span v-else>Generate Code</span>
                </button>
                <button :disabled="!codeValid" class="button is-small is-success" title="Validate code against description" @click.stop="$emit('validate')">
                    <span class="icon"><i class="bx bx-check"></i></span> <span>Validate Code</span>
                </button>
                <button class="button is-small is-danger py-1 " title="Delete cell" aria-label="Delete" 
                        :disabled="localIsLocked" @click.stop="$emit('delete')">
                    <span class="icon"><i class="bx bx-trash"></i></span>
                </button>
            </div>
        </div>

        <div v-if="isEditing" class="explanation-edit-mode px-2 pb-2">
            <textarea 
                ref="textareaEl"
                v-model="localSource" 
                placeholder="Explain what should be done in this cell..."
                class="textarea is-family-monospace mb-2" 
                rows="1"
                style="overflow: hidden; resize: none; height: 0;"
                @input="autoResize"
                @blur="onBlur"
                @keydown.enter.shift.prevent="saveAndRun">
            </textarea>
            <div style="display: flex; justify-content: flex-end; gap: 0.5rem;">
                <button class="button is-small" @mousedown.prevent @click="cancelEdit">
                    Cancel
                </button>
                <button class="button is-small is-info" :disabled="localIsLocked" @mousedown.prevent @click="saveChanges">
                    Save
                </button>
                <button class="button is-small is-primary" :disabled="localIsLocked" @mousedown.prevent @click="saveAndRun">
                    <span class="icon"><i class="bx bx-play"></i></span> 
                    <span>Save and Run</span>
                </button>
            </div>
        </div>
    `
};

export default ExplanationRenderer;
