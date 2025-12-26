import { ref, computed, watch, nextTick } from './vue.esm-browser.js';

const ExplanationRenderer = {
    props: ['source', 'isActive', 'index', 'lastRunIndex', 'asRead'],
    emits: ['update:source', 'save', 'redo', 'run'],
    setup(props, { emit }) {
        const isEditing = ref(false);
        const localSource = ref(Array.isArray(props.source) ? props.source.join('') : props.source);
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
            isEditing.value = true;
            nextTick(() => {
                autoResize();
                if (textareaEl.value) textareaEl.value.scrollTop = 0;
            });
        };

        const saveChanges = () => {
            isEditing.value = false; // emit handled by watch
            emit('save', localSource.value);
        };

        const handleRedo = () => {
            emit('redo');
        };

        const runCell = () => {
            emit('run');
        }

        return { isEditing, localSource, rendered, enterEditMode, saveChanges, textareaEl, autoResize, 
            handleRedo, runCell };
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
            <div class="toolbar-right" style="display: flex; gap: 0.5rem;">
                <button class="button is-small is-info" style="opacity: 0.6;" @click="enterEditMode">
                    Edit
                </button>
                <button class="button is-small is-warning" style="opacity: 0.6;" @click="handleRedo">
                    Regenerate Code
                </button>
                <button v-if="index === lastRunIndex" class="button is-small is-success" style="opacity: 0.6;" @click="runCell">
                    Re-Run
                </button>
                <button v-else-if="lastRunIndex < index" class="button is-small is-success" style="opacity: 0.6;" @click="runCell">
                    Run Up To Here
                </button>
                <button v-else class="button is-small is-success" style="opacity: 0.6;" @click="runCell">
                    Run From Start To Here
                </button>
            </div>

            <div v-if="isEditing" class="explanation-edit-mode">
                <textarea 
                    ref="textareaEl"
                    v-model="localSource" 
                    class="textarea is-family-monospace mb-2" 
                    rows="1"
                    style="overflow: hidden; resize: none; height: 0;"
                    @input="autoResize"
                    @keydown.enter.shift.prevent="saveChanges">
                </textarea>
                <button class="button is-small is-primary" @click="saveChanges">
                    Save
                </button>
            </div>
        </div>
    `
};

export default ExplanationRenderer;

