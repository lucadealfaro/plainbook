import { ref, nextTick } from './vue.esm-browser.js';

export default {
    props: ['tests', 'activeIndex'],
    emits: ['select', 'add', 'rename', 'exit'],
    setup(props, { emit }) {
        const editingIndex = ref(null);
        const editingName = ref('');
        const editInput = ref(null);

        const startRename = (index) => {
            editingIndex.value = index;
            editingName.value = props.tests[index].name;
            nextTick(() => {
                if (editInput.value) {
                    editInput.value.focus();
                    editInput.value.select();
                }
            });
        };

        const finishRename = () => {
            if (editingIndex.value !== null) {
                const newName = editingName.value.trim();
                if (newName && newName !== props.tests[editingIndex.value].name) {
                    emit('rename', editingIndex.value, newName);
                }
                editingIndex.value = null;
            }
        };

        const cancelRename = () => {
            editingIndex.value = null;
        };

        return { editingIndex, editingName, editInput, startRename, finishRename, cancelRename };
    },
    template: /* html */ `
        <div class="unit-test-tab-bar" style="display: flex; align-items: center; gap: 0.25rem; overflow-x: auto; padding: 0.5rem; background-color: #f5f5f5; border: 1px solid #dbdbdb; border-radius: 4px; flex-shrink: 0;">
            <button class="button is-small" title="Exit unit test mode" @click="$emit('exit')">
                <span class="icon"><i class="bx bx-chevrons-left"></i></span>
                <span>Back</span>
            </button>
            <div style="width: 1px; height: 1.5rem; background: #ccc; margin: 0 0.25rem;"></div>
            <template v-for="(test, index) in tests" :key="index">
                <button class="button is-small"
                        :class="index === activeIndex ? 'is-warning' : ''"
                        @click="$emit('select', index)"
                        @dblclick.stop="startRename(index)">
                    <span v-if="editingIndex === index" @click.stop>
                        <input ref="editInput"
                               class="input is-small"
                               style="width: 8rem; height: 1.5rem;"
                               v-model="editingName"
                               @blur="finishRename"
                               @keydown.enter.prevent="finishRename"
                               @keydown.escape.prevent="cancelRename">
                    </span>
                    <span v-else>{{ test.name }}</span>
                </button>
            </template>
            <button class="button is-small" title="Add a new test" @click="$emit('add')">
                <span class="icon"><i class="bx bx-plus"></i></span>
            </button>
        </div>
    `
};
