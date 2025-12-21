import { ref, computed, watch, nextTick } from './vue.esm-browser.js';

const ExplanationRenderer = {
    props: ['source', 'isActive'],
    emits: ['update:source', 'save', 'redo'],
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

        return { isEditing, localSource, rendered, enterEditMode, saveChanges, textareaEl, autoResize, handleRedo };
    },
    template: /* html */ `
        <div class="explanation-container p-2" style="position: relative;">
            <div v-if="!isEditing" 
                 class="explanation-body content"
                 v-html="rendered" @dblclick="enterEditMode">
            </div>
            <div v-if="!isEditing && isActive"
                 style="position: absolute; bottom: 10px; right: 10px; display: flex; gap: 0.5rem;">
                <button class="button is-small is-info" style="opacity: 0.6;" @click="enterEditMode">
                    Edit
                </button>
                <button class="button is-small is-warning" style="opacity: 0.6;" @click="handleRedo">
                    Redo
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

