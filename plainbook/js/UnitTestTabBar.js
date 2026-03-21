import { ref, nextTick } from './vue.esm-browser.js';

export default {
    props: ['tests', 'activeName'],
    emits: ['select', 'add', 'rename', 'exit'],
    setup(props, { emit }) {
        const editingKey = ref(null);
        const editingName = ref('');
        const editInput = ref(null);

        const startRename = (name) => {
            editingKey.value = name;
            editingName.value = name;
            nextTick(() => {
                if (editInput.value) {
                    editInput.value.focus();
                    editInput.value.select();
                }
            });
        };

        const finishRename = () => {
            if (editingKey.value !== null) {
                const newName = editingName.value.trim();
                if (newName && newName !== editingKey.value && !(newName in props.tests)) {
                    emit('rename', editingKey.value, newName);
                }
                editingKey.value = null;
            }
        };

        const cancelRename = () => {
            editingKey.value = null;
        };

        return { editingKey, editingName, editInput, startRename, finishRename, cancelRename };
    },
    template: /* html */ `
        <div class="unit-test-tab-bar panel-container" style="display: flex; align-items: center; gap: 0.25rem; overflow-x: auto; padding: 0.5rem; flex-shrink: 0;">
            <button class="button is-small" title="Exit unit test mode" @click="$emit('exit')">
                <span class="icon"><i class="bx bx-chevrons-left"></i></span>
                <span>Back</span>
            </button>
            <div class="panel-divider" style="height: 1.5rem; margin: 0 0.25rem;"></div>
            <template v-for="(testData, name) in tests" :key="name">
                <button class="button is-small"
                        :class="name === activeName ? 'is-warning' : ''"
                        @click="$emit('select', name)"
                        @dblclick.stop="startRename(name)">
                    <span v-if="editingKey === name" @click.stop>
                        <input ref="editInput"
                               class="input is-small"
                               style="width: 8rem; height: 1.5rem;"
                               v-model="editingName"
                               @blur="finishRename"
                               @keydown.enter.prevent="finishRename"
                               @keydown.escape.prevent="cancelRename">
                    </span>
                    <span v-else>{{ name }}</span>
                </button>
            </template>
            <button class="button is-small" title="Add a new test" @click="$emit('add')">
                <span class="icon"><i class="bx bx-plus"></i></span>
            </button>
        </div>
    `
};
