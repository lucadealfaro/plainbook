import { ref, computed, watch, nextTick } from './vue.esm-browser.js';

const ExplanationRenderer = {
    props: ['source', 'isActive', 'needsRunning', 'asRead', 'startEditKey', 'isLocked'],
    emits: ['update:source', 'save', 'saveandrun', 'gencode', 'validate', 
            'run', 'delete', 'moveUp', 'moveDown'],
    setup(props, { emit }) {
        const isEditing = ref(false);
        const localSource = ref(Array.isArray(props.source) ? props.source.join('') : props.source);
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
            localSource.value = Array.isArray(val) ? val.join('') : val;
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
            isEditing.value = false;
            emit('save', localSource.value);
        };

        const saveAndRun = () => {
            isEditing.value = false;
            emit('saveandrun', localSource.value);
        };

        const cancelEdit = () => {
            localSource.value = originalSource.value;
            isEditing.value = false;
        };

        return { isEditing, localSource, rendered, enterEditMode, saveChanges, 
            cancelEdit, textareaEl, autoResize, saveAndRun, localIsLocked};
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
                    <span class="icon"><i class="fa fa-step-forward"></i></span><span>Run</span>
                </button>
                <button class="button is-small" style="opacity: 0.6;">
                    <span v-if="asRead">Unmodified</span>
                    <span v-else-if="needsRunning">Needs running</span>
                    <span v-else>Up to date</span>
                </button>
            </div>
            <div class="toolbar-right" style="display: flex; flex-wrap: wrap; gap: 0.25rem;">
                <button class="button is-small is-info" title="Edit action description" 
                        :disabled="localIsLocked" @click.stop="enterEditMode">
                    <span class="icon"><i class="fa fa-pencil"></i></span><span>Edit</span>
                </button>
                <button class="button is-small is-info py-1 " 
                        :disabled="localIsLocked"
                        title="Move cell up" aria-label="Move Up" @click.stop="$emit('moveUp')">
                    <span class="icon"><i class="fa fa-arrow-up"></i></span>
                </button>
                <button class="button is-small is-info py-1 " 
                        :disabled="localIsLocked"
                        title="Move cell down" aria-label="Move Down" @click.stop="$emit('moveDown')">
                    <span class="icon"><i class="fa fa-arrow-down"></i></span>
                </button>
                <button class="button is-small is-success" title="Regenerate code from description" 
                        :disabled="localIsLocked" @click.stop="$emit('gencode')">
                    <span class="icon"><i class="fa fa-repeat"></i></span> <span>Regenerate Code</span>
                </button>
                <button class="button is-small is-success" title="Validate code against description" @click.stop="$emit('validate')">
                    <span class="icon"><i class="fa fa-check"></i></span> <span>Validate Code</span>
                </button>
                <button class="button is-small is-danger py-1 " title="Delete cell" aria-label="Delete" 
                        :disabled="localIsLocked" @click.stop="$emit('delete')">
                    <span class="icon"><i class="fa fa-trash"></i></span>
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
                @keydown.enter.shift.prevent="saveAndRun">
            </textarea>
            <div style="display: flex; justify-content: flex-end; gap: 0.5rem;">
                <button class="button is-small" @click="cancelEdit">
                    Cancel
                </button>
                <button class="button is-small is-info" :disabled="localIsLocked" @click="saveChanges">
                    Save
                </button>
                <button class="button is-small is-primary" :disabled="localIsLocked" @click="saveAndRun">
                    <span class="icon"><i class="fa fa-play"></i></span> 
                    <span>Save and Run</span>
                </button>
            </div>
        </div>
    `
};

export default ExplanationRenderer;
