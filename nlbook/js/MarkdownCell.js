import { ref, watch, nextTick } from './vue.esm-browser.js';

const MarkdownCell = {
    props: ['source', 'startEditKey', 'isActive'],
    emits: ['save', 'delete', 'moveUp', 'moveDown'],
    setup(props, { emit }) {
        const md = new markdownit({ html: true });
        const localSource = ref(Array.isArray(props.source) ? props.source.join('') : props.source || '');
        const isEditing = ref(false);
        const textareaEl = ref(null);

        const renderContent = () => md.render(localSource.value);
        const rendered = ref(renderContent());

        const refresh = () => {
            rendered.value = renderContent();
        };

        watch(() => props.source, (val) => {
            localSource.value = Array.isArray(val) ? val.join('') : val || '';
            refresh();
        });

        watch(() => props.startEditKey, () => {
            isEditing.value = true;
            nextTick(() => { 
                autoResize();
                if (textareaEl.value) textareaEl.value.focus(); 
            });
        });

        watch(isEditing, (newVal) => {
            if (newVal) {
                nextTick(() => {
                    autoResize();
                    if (textareaEl.value) textareaEl.value.focus();
                });
            }
        });

        const autoResize = () => {
            const el = textareaEl.value;
            if (!el) return;
            el.style.boxSizing = 'border-box';
            el.style.overflow = 'hidden';
            el.style.resize = 'none';
            el.style.height = 'auto';
            const minHeight = 24; // approximately one line in pixels
            el.style.height = `${Math.max(el.scrollHeight, minHeight)}px`;
        };

        const save = () => {
            isEditing.value = false;
            emit('save', localSource.value);
            refresh();
        };

        return { localSource, rendered, isEditing, textareaEl, save, autoResize };
    },
    template: /* html */ `
        <div class="markdown-body content" style="position: relative; min-height: 2.5rem;">
            <div class="p-2" v-if="!isEditing" v-html="rendered"></div>

            <!-- bottom toolbar -->
            <div v-if="!isEditing && isActive"
                 class="explanation-toolbar has-background-grey-lighter pl-3 pr-3"
                 style="display: flex; align-items: center; justify-content: flex-end; gap: 0.5rem;">
                <div class="toolbar-right" style="display: flex; gap: 0.25rem;">
                    <button class="button is-small is-info" @click.stop="isEditing = true">
                        Edit
                    </button>
                    <button class="button is-small is-success py-1 " title="Move Up" aria-label="Move Up" @click.stop="$emit('moveUp')"><span class="icon"><i class="fa fa-arrow-up"></i></span></button>
                    <button class="button is-small is-success py-1 " title="Move Down" aria-label="Move Down" @click.stop="$emit('moveDown')"><span class="icon"><i class="fa fa-arrow-down"></i></span></button>
                    <button class="button is-small is-danger py-1 " title="Delete" aria-label="Delete" @click.stop="$emit('delete')"><span class="icon"><i class="fa fa-trash"></i></span></button>
                </div>
            </div>

            <div v-if="isEditing" class="p-2">
                <textarea
                    ref="textareaEl"
                    class="textarea is-family-monospace is-size-6 p-2"
                    v-model="localSource"
                    placeholder="Write a comment or explanation. You can use markdown."
                    rows="1"
                    style="overflow: hidden; resize: none; height: 0;"
                    @input="autoResize"
                ></textarea>
                <div class="mt-2" style="display: flex; justify-content: flex-end; gap: 0.5rem;">
                    <button class="button is-small" @click="isEditing = false">Cancel</button>
                    <button class="button is-small is-primary" @click="save">Save</button>
                </div>
            </div>
        </div>`
};

export default MarkdownCell;
