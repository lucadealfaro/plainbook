import { ref, watch, onMounted, onBeforeUnmount } from './vue.esm-browser.js';

export default {
    props: ['isActive', 'isCodespace', 'hasGeminiKey', 'hasClaudeKey', 'claudeViaBedrock', 'authToken'],
    emits: ['close', 'save', 'gemini-oauth-login'],
    setup(props, { emit }) {
        const localGeminiKey = ref('');
        const localClaudeKey = ref('');
        // Track whether the user has clicked to edit each field
        const geminiEditing = ref(false);
        const claudeEditing = ref(false);
        // Track whether the user wants to remove a key
        const geminiRemoved = ref(false);
        const claudeRemoved = ref(false);
        // Fetched from server when modal opens
        const hasGeminiOAuth = ref(false);

        // Reset inputs and fetch current auth state whenever the modal is opened
        watch(() => props.isActive, async (active) => {
            if (active) {
                localGeminiKey.value = '';
                localClaudeKey.value = '';
                geminiEditing.value = false;
                claudeEditing.value = false;
                geminiRemoved.value = false;
                claudeRemoved.value = false;
                // Fetch current Gemini auth status from server
                try {
                    const resp = await fetch(`/gemini_auth_status?token=${props.authToken}`);
                    const r = await resp.json();
                    hasGeminiOAuth.value = r.has_oauth || false;
                } catch (err) {
                    console.error('Failed to fetch Gemini auth status:', err);
                }
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

        const handleOAuthLogout = async () => {
            try {
                await fetch(`/gemini_oauth_logout?token=${props.authToken}`, { method: 'POST' });
                hasGeminiOAuth.value = false;
            } catch (err) {
                console.error('Failed to disconnect Gemini OAuth:', err);
            }
        };

        // Listen for OAuth completion from the callback tab
        const onStorage = (e) => {
            if (e.key !== 'plainbook-oauth-done') return;
            localStorage.removeItem('plainbook-oauth-done');
            hasGeminiOAuth.value = true;
            emit('close');
        };
        onMounted(() => window.addEventListener('storage', onStorage));
        onBeforeUnmount(() => window.removeEventListener('storage', onStorage));

        return { localGeminiKey, localClaudeKey, geminiEditing, claudeEditing, geminiRemoved, claudeRemoved, hasGeminiOAuth, startEditing, removeKey, handleSave, handleOAuthLogout };
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
                    <label class="label">Gemini</label>

                    <!-- API Key row -->
                    <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.5rem;">
                        <span class="icon is-small" style="width: 1.25rem;">
                            <i v-if="hasGeminiKey && !hasGeminiOAuth" class="bx bx-check" style="color: #48c774; font-size: 1.2rem;"></i>
                        </span>
                        <span style="white-space: nowrap; min-width: 5rem;">API key:</span>
                        <div style="flex: 1;" v-if="geminiRemoved">
                            <div class="input is-small settings-key-status">Key will be removed on save</div>
                        </div>
                        <div style="flex: 1; display: flex; align-items: center; gap: 0.5rem;" v-else-if="hasGeminiKey && !geminiEditing">
                            <div class="input is-small settings-key-masked" @click="startEditing('gemini')" style="flex: 1;">●●●●●●●●●●●●</div>
                            <button class="button is-small is-danger is-outlined" @click="removeKey('gemini')"><i class="bx bx-trash"></i></button>
                        </div>
                        <div style="flex: 1;" v-else>
                            <input class="input is-small" type="text" v-model="localGeminiKey"
                                   :placeholder="hasGeminiKey ? 'Enter new key (leave blank to keep current)' : 'Enter your Gemini API key'">
                        </div>
                        <a href="https://aistudio.google.com/app/apikey" target="_blank" class="button is-small is-link is-light">
                            {{ hasGeminiKey ? 'Manage' : 'Get key' }}
                        </a>
                    </div>

                    <!-- Google account row -->
                    <div style="display: flex; align-items: center; gap: 0.5rem;">
                        <span class="icon is-small" style="width: 1.25rem;">
                            <i v-if="hasGeminiOAuth" class="bx bx-check" style="color: #48c774; font-size: 1.2rem;"></i>
                        </span>
                        <span style="white-space: nowrap; min-width: 5rem;">Google account:</span>
                        <div v-if="hasGeminiOAuth" style="display: flex; align-items: center; gap: 0.5rem;">
                            <span class="tag is-success is-light">Logged in</span>
                            <button class="button is-small is-danger is-outlined" @click="handleOAuthLogout">Disconnect</button>
                        </div>
                        <button v-else class="button is-small is-link is-light" @click="$emit('gemini-oauth-login')">
                            <span class="icon is-small"><i class="bx bx-user"></i></span>
                            <span>Log in</span>
                        </button>
                    </div>
                </div>
                <div class="field">
                    <label class="label">Claude API Key</label>
                    <div class="control" v-if="claudeViaBedrock">
                        <div class="input settings-bedrock-status">
                            Claude is available via AWS Bedrock
                        </div>
                    </div>
                    <div class="control" v-else-if="claudeRemoved">
                        <div class="input settings-key-status">
                            Key will be removed on save
                        </div>
                    </div>
                    <div class="control" v-else-if="hasClaudeKey && !claudeEditing">
                        <div style="display: flex; align-items: center; gap: 0.5rem;">
                            <div class="input settings-key-masked"
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
