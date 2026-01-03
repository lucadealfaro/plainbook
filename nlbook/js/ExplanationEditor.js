import { ref, computed, watch, nextTick } from './vue.esm-browser.js';

const ExplanationRenderer = {
    props: ['source', 'isActive', 'index', 'lastRunIndex', 'asRead', 'startEditKey'],
    emits: ['update:source', 'save', 'redo', 'run', 'delete', 'moveUp', 'moveDown'],
    setup(props, { emit }) {
        const isEditing = ref(false);
        const localSource = ref(Array.isArray(props.source) ? props.source.join('') : props.source);
        const originalSource = ref(localSource.value);
        const md = new markdownit({ html: true });
        const textareaEl = ref(null);

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

        // emit on every change for v-model:source
        watch(localSource, (val) => {
            emit('update:source', val);
            nextTick(autoResize);
        });

        const enterEditMode = () => {
            originalSource.value = localSource.value;
            isEditing.value = true;
            nextTick(() => {
                autoResize();
                if (textareaEl.value) textareaEl.value.scrollTop = 0;
            });
        };

        watch(() => props.startEditKey, () => {
            enterEditMode();
        });

        const saveChanges = () => {
            isEditing.value = false; // emit handled by watch
            emit('save', localSource.value);
        };

        const cancelEdit = () => {
            localSource.value = originalSource.value;
            isEditing.value = false;
        };

        const generateCode = () => {
            emit('gencode');
        };

        const runCell = () => {
            emit('run');
        }

        return { isEditing, localSource, rendered, enterEditMode, saveChanges, cancelEdit, textareaEl, autoResize, 
            generateCode, runCell };
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
                style="display: flex; align-items: center; justify-content: space-between; gap: 0.5rem">
            <div class="toolbar-left">
                <button class="button is-small" style="opacity: 0.6;">
                    <span v-if="asRead">Unmodified</span>
                    <span v-else-if="lastRunIndex < index">Needs running</span>
                    <span v-else>Up to date</span>
                </button>
            </div>
            <div class="toolbar-right" style="display: flex; gap: 0.25rem;">
                <button class="button is-small is-info" @click="enterEditMode">
                    Edit
                </button>
                <button class="button is-small is-warning" @click="generateCode">
                    <span class="icon"><i class="fa fa-repeat"></i></span> <span>Regenerate Code</span>
                </button>
                <button v-if="index === lastRunIndex" class="button is-small is-primary" @click="runCell">
                    <span class="icon"><i class="fa fa-repeat"></i></span> <span>Re-Run</span>
                </button>
                <button v-else-if="lastRunIndex < index" class="button is-small is-primary" @click="runCell">
                    <span class="icon"><i class="fa fa-step-forward"></i></span> <span>Run Up To Here</span>
                </button>
                <button v-else class="button is-small is-primary" @click="runCell">
                    <span class="icon"><i class="fa fa-step-forward"></i></span> <span>Run From Start To Here</span>
                </button>
                    <button class="button is-small is-success py-1 " title="Move Up" aria-label="Move Up" @click.stop="$emit('moveUp')"><span class="icon"><i class="fa fa-arrow-up"></i></span></button>
                    <button class="button is-small is-success py-1 " title="Move Down" aria-label="Move Down" @click.stop="$emit('moveDown')"><span class="icon"><i class="fa fa-arrow-down"></i></span></button>
                    <button class="button is-small is-danger py-1 " title="Delete" aria-label="Delete" @click.stop="$emit('delete')"><span class="icon"><i class="fa fa-trash"></i></span></button>
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
                @keydown.enter.shift.prevent="saveChanges">
            </textarea>
            <div style="display: flex; justify-content: flex-end; gap: 0.5rem;">
                <button class="button is-small" @click="cancelEdit">
                    Cancel
                </button>
                <button class="button is-small is-primary" @click="saveChanges">
                    Save
                </button>
            </div>
        </div>
    `
};

export default ExplanationRenderer;

