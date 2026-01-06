import { ref, computed, watch, nextTick } from './vue.esm-browser.js';

export default {
    props: ['source', 'executionCount', 'isActive'],
    emits: ['save', 'update:source'],
    setup(props, { emit }) {
        const isCollapsed = ref(true);
        const isEditing = ref(false);
        const localSource = ref(Array.isArray(props.source) ? props.source.join('') : props.source);
        const originalSource = ref(localSource.value);
        const textareaEl = ref(null);
        const localIsLocked = ref(props.isLocked);

        watch(() => props.isActive, (newVal) => {
            if (!newVal && isEditing.value) {
                saveCode();
            }
        });

        watch(() => props.source, (val) => {
            localSource.value = Array.isArray(val) ? val.join('') : val;
            nextTick(autoResize);
        });

        watch(() => props.isLocked, (newVal) => {
            console.log("Lock status changed:", newVal);
            localIsLocked.value = newVal;
            if (newVal) {
                cancelEdit();
            }
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
       
        const highlightedCode = computed(() => {
            const code = localSource.value || '';
            if (!window.Prism || !window.Prism.languages || !window.Prism.languages.python) {
                // HTML escape if Prism not available
                return code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            }
            try {
                const highlighted = window.Prism.highlight(
                    code, 
                    window.Prism.languages.python, 
                    'python'
                );
                return highlighted;
            } catch (e) {
                console.error('Prism highlighting error:', e);
                // HTML escape on error
                return code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            }
        });

        const handleTabKey = (e) => {
            if (e.key === 'Tab') {
                e.preventDefault();
                const textarea = textareaEl.value;
                if (!textarea) return;
                
                const start = textarea.selectionStart;
                const end = textarea.selectionEnd;
                const text = localSource.value;
                const spaces = '    '; // 4 spaces
                
                if (start === end) {
                    // No selection - just insert 4 spaces
                    localSource.value = text.substring(0, start) + spaces + text.substring(end);
                    nextTick(() => {
                        textarea.selectionStart = textarea.selectionEnd = start + spaces.length;
                        autoResize();
                    });
                } else {
                    // Selection - indent all selected lines
                    const lines = text.split('\n');
                    const startLine = text.substring(0, start).split('\n').length - 1;
                    const endLine = text.substring(0, end).split('\n').length - 1;
                    
                    for (let i = startLine; i <= endLine; i++) {
                        if (lines[i] !== undefined) {
                            lines[i] = spaces + lines[i];
                        }
                    }
                    
                    const newText = lines.join('\n');
                    localSource.value = newText;
                    
                    nextTick(() => {
                        const newStart = start + spaces.length;
                        const newEnd = end + (endLine - startLine + 1) * spaces.length;
                        textarea.selectionStart = newStart;
                        textarea.selectionEnd = newEnd;
                        autoResize();
                    });
                }
            }
        };

        const enterEditMode = () => {
            if (localIsLocked.value) return;
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

        return { isCollapsed, toggleCollapse, isEditing, cancelEdit, localSource, highlightedCode, enterEditMode, saveCode, textareaEl, autoResize, handleTabKey };
    },
    template: /* html */ `
        <div class="code-cell-wrapper" style="position: relative; min-height: 1.75rem;">
            <button class="button is-small is-white px-2"
                    style="position: absolute; top: 0; left: 0; z-index: 1;"
                    @click="toggleCollapse">
                {{ isCollapsed ? '▶ &nbsp;Show code' : '▼' }}
            </button>

            <div v-if="!isCollapsed" style="padding-left: 2.25rem;">
                <div v-if="!isEditing" class="p-2 overflow-x-auto" @dblclick="enterEditMode">
                    <pre class="language-python"><code class="language-python" v-html="highlightedCode"></code></pre>
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
                        @keydown.tab.prevent="handleTabKey"
                        @keydown.enter.shift.prevent="saveCode">
                    </textarea>
                    <div style="display: flex; justify-content: flex-end; gap: 0.5rem;">
                        <button class="button is-small" @click="cancelEdit">
                            Cancel
                        </button>
                        <button class="button is-small is-primary" :disabled="localIsLocked" @click="saveCode">
                            Save
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `
};
