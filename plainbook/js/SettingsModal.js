import { ref, watch } from './vue.esm-browser.js';

export default {
    props: ['isActive', 'apiKey'],
    emits: ['close', 'save'],
    setup(props, { emit }) {
        // Create a local draft of the API key
        const localKey = ref(props.apiKey);
        const error = ref('');

        // Sync local draft whenever the modal is opened with the current parent value
        watch(() => props.isActive, (active) => {
            if (active) {
                localKey.value = props.apiKey;
                error.value = '';
            }
        });

        const handleSave = () => {
            if (!localKey.value || localKey.value.trim() === '') {
                error.value = 'API key is required';
                return;
            }
            error.value = '';
            emit('save', localKey.value);
        };

        return { localKey, handleSave, error };
    },
    template: /* html */ `
    <div class="modal" :class="{'is-active': isActive}">
        <div class="modal-background" @click="$emit('close')"></div>
        <div class="modal-card">
            <header class="modal-card-head">
                <p class="modal-card-title">Settings</p>
                <button class="delete" aria-label="close" @click="$emit('close')"></button>
            </header>
            <section class="modal-card-body">
                <div class="field">
                    <label class="label">Gemini API Key</label>
                    <div class="control">
                        <input class="input" type="text" 
                               v-model="localKey" 
                               :class="{'is-warning': error}"
                               placeholder="Enter your Gemini API key">
                    </div>
                    <p v-if="error" class="help is-warning">{{ error }}</p>
                    <p class="help">
                        <a href="https://aistudio.google.com/app/apikey" target="_blank" class="button is-small is-link is-light" style="margin-top: 0.5rem;">
                            {{ localKey ? 'Manage Gemini API Key' : 'Get Gemini API Key' }}
                        </a>
                    </p>
                </div>
            </section>
            <footer class="modal-card-foot" style="justify-content: flex-end;">
                <button class="button is-primary" @click="handleSave">Save</button>
            </footer>
        </div>
    </div>`
};
