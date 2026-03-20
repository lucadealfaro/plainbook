import { ref, watch } from './vue.esm-browser.js';

export default {
    props: ['isActive', 'isCodespace', 'hasGeminiKey', 'hasClaudeKey', 'claudeViaBedrock'],
    emits: ['close', 'save'],
    setup(props, { emit }) {
        const localGeminiKey = ref('');
        const localClaudeKey = ref('');
        // Track whether the user has clicked to edit each field
        const geminiEditing = ref(false);
        const claudeEditing = ref(false);
        // Track whether the user wants to remove a key
        const geminiRemoved = ref(false);
        const claudeRemoved = ref(false);

        // Reset inputs whenever the modal is opened
        watch(() => props.isActive, (active) => {
            if (active) {
                localGeminiKey.value = '';
                localClaudeKey.value = '';
                geminiEditing.value = false;
                claudeEditing.value = false;
                geminiRemoved.value = false;
                claudeRemoved.value = false;
            }
        });

        const startEditing = (provider) => {
            if (provider === 'gemini') {
                geminiEditing.value = true;
            } else {
                claudeEditing.value = true;
            }
        };

        const removeKey = (provider) => {
            if (provider === 'gemini') {
                geminiRemoved.value = true;
            } else {
                claudeRemoved.value = true;
            }
        };

        const handleSave = () => {
            emit('save', {
                gemini_api_key: geminiRemoved.value ? null : ((geminiEditing.value || !props.hasGeminiKey) ? localGeminiKey.value : ''),
                claude_api_key: claudeRemoved.value ? null : ((claudeEditing.value || !props.hasClaudeKey) ? localClaudeKey.value : ''),
            });
        };

        return { localGeminiKey, localClaudeKey, geminiEditing, claudeEditing, geminiRemoved, claudeRemoved, startEditing, removeKey, handleSave };
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
                    <div class="control" v-if="geminiRemoved">
                        <div class="input" style="color: #b5b5b5; background-color: #f5f5f5; font-style: italic;">
                            Key will be removed on save
                        </div>
                    </div>
                    <div class="control" v-else-if="hasGeminiKey && !geminiEditing">
                        <div style="display: flex; align-items: center; gap: 0.5rem;">
                            <div class="input" style="cursor: pointer; color: #888; background-color: #f5f5f5;"
                                 @click="startEditing('gemini')">
                                ●●●●●●●●●●●●
                            </div>
                            <button class="button is-small is-danger is-outlined" @click="removeKey('gemini')"><i class="bx bx-trash"></i></button>
                        </div>
                    </div>
                    <div class="control" v-else>
                        <input class="input" type="text"
                               v-model="localGeminiKey"
                               :placeholder="hasGeminiKey ? 'Enter new key (leave blank to keep current)' : 'Enter your Gemini API key (optional)'">
                    </div>
                    <p class="help">
                        <a href="https://aistudio.google.com/app/apikey" target="_blank" class="button is-small is-link is-light" style="margin-top: 0.5rem;">
                            {{ hasGeminiKey ? 'Manage Gemini API Key' : 'Get Gemini API Key' }}
                        </a>
                    </p>
                </div>
                <div class="field">
                    <label class="label">Claude API Key</label>
                    <div class="control" v-if="claudeViaBedrock">
                        <div class="input" style="color: #48c774; background-color: #f5f5f5; font-style: italic;">
                            Claude is available via AWS Bedrock
                        </div>
                    </div>
                    <div class="control" v-else-if="claudeRemoved">
                        <div class="input" style="color: #b5b5b5; background-color: #f5f5f5; font-style: italic;">
                            Key will be removed on save
                        </div>
                    </div>
                    <div class="control" v-else-if="hasClaudeKey && !claudeEditing">
                        <div style="display: flex; align-items: center; gap: 0.5rem;">
                            <div class="input" style="cursor: pointer; color: #888; background-color: #f5f5f5;"
                                 @click="startEditing('claude')">
                                ●●●●●●●●●●●●
                            </div>
                            <button class="button is-small is-danger is-outlined" @click="removeKey('claude')"><i class="bx bx-trash"></i></button>
                        </div>
                    </div>
                    <div class="control" v-else>
                        <input class="input" type="text"
                               v-model="localClaudeKey"
                               :placeholder="hasClaudeKey ? 'Enter new key (leave blank to keep current)' : 'Enter your Claude API key (optional)'">
                    </div>
                    <p class="help" v-if="!claudeViaBedrock">
                        <a href="https://console.anthropic.com/settings/keys" target="_blank" class="button is-small is-link is-light" style="margin-top: 0.5rem;">
                            {{ hasClaudeKey ? 'Manage Claude API Key' : 'Get Claude API Key' }}
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
