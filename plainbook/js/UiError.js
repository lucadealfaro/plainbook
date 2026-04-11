export default {
    props: ['error'],
    emits: ['close'],
    template: /* html */ `
    <div v-if="error" class="notification mb-0 mt-0 px-4 pl-2 pr-6 has-text-danger has-background-danger-light"
        style="width: 100%; border-radius: 0; flex-shrink: 0; max-height: 30vh; overflow-y: auto;">
        <span style="white-space: pre-wrap;"><strong>Error:</strong> {{ error }}</span>
        <button class="delete" @click="$emit('close')"></button>
    </div>`
};
