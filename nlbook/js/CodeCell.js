import { ref, watch, nextTick } from './vue.esm-browser.js';

export default {
    props: ['source', 'executionCount', 'isActive'],
    emits: ['save', 'update:source'],
    setup(props, { emit }) {
        const isCollapsed = ref(false);
        const isEditing = ref(false);
        const localSource = ref(Array.isArray(props.source) ? props.source.join('') : props.source);
        const originalSource = ref(localSource.value);
        const textareaEl = ref(null);

        watch(() => props.isActive, (newVal) => {
            if (!newVal && isEditing.value) {
                saveCode();
            }
        });

        watch(() => props.source, (val) => {
            localSource.value = Array.isArray(val) ? val.join('') : val;
            nextTick(autoResize);
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
       
        const highlightedCode = () => {
            return window.Prism.highlight(
                localSource.value, 
                window.Prism.languages.python, 
                'python'
            );
        };

        const enterEditMode = () => {
            isEditing.value = true;
            nextTick(() => {
                autoResize();
                if (textareaEl.value) textareaEl.value.scrollTop = 0;
            });
        };

        const saveCode = () => {
            isEditing.value = false;
            emit('save', localSource.value);
        };

        const cancelEdit = () => {
            localSource.value = originalSource.value;
            isEditing.value = false;
        };


        const toggleCollapse = () => {
            isCollapsed.value = !isCollapsed.value;
            if (!isCollapsed.value && isEditing.value) nextTick(autoResize);
        };

        return { isCollapsed, toggleCollapse, isEditing, cancelEdit, localSource, highlightedCode, enterEditMode, saveCode, textareaEl, autoResize };
    },
    template: /* html */ `
        <div class="code-cell-wrapper" style="position: relative; min-height: 1.75rem; border-bottom: 1px solid #e0e0e0;">
            <button class="button is-small is-white px-2"
                    style="position: absolute; top: 0; left: 0; z-index: 1;"
                    @click="toggleCollapse">
                {{ isCollapsed ? '▶' : '▼' }}
            </button>

            <div v-if="!isCollapsed" style="padding-left: 2.25rem;">
                <div v-if="!isEditing" class="p-2 overflow-x-auto" @dblclick="enterEditMode">
                    <pre class="language-python"><code v-html="highlightedCode()"></code></pre>
                </div>

                <div v-else class="p-2">
                    <textarea 
                        ref="textareaEl"
                        placeholder="Write the code for this action..."
                        v-model="localSource" 
                        class="textarea is-family-monospace mb-2" 
                        rows="1"
                        style="overflow: hidden; resize: none; height: 0;"
                        @input="autoResize"
                        @keydown.enter.shift.prevent="saveCode">
                    </textarea>
                    <button class="button is-small" @click="cancelEdit">
                        Cancel
                    </button>
                    <button class="button is-small is-primary" @click="saveCode">
                        Save
                    </button>
                </div>
            </div>
        </div>
    `
};
