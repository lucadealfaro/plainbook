import { ref, watch } from './vue.esm-browser.js';

export default {
    props: ['isActive', 'isCodespace', 'hasGeminiKey', 'hasClaudeKey', 'claudeViaBedrock', 'skipReexecution',
            'askQuestions', 'explanationDetail', 'explanationBullets', 'explanationLatex'],
    emits: ['close', 'save'],
    setup(props, { emit }) {
        const localGeminiKey = ref('');
        const localClaudeKey = ref('');
        const localSkipReexecution = ref(true);
        const localAskQuestions = ref(false);
        const localExplanationDetail = ref(1);
        const localExplanationBullets = ref(false);
        const localExplanationLatex = ref(false);
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
                // Default to on when the setting is not yet defined.
                localSkipReexecution.value = props.skipReexecution !== false;
                localAskQuestions.value = !!props.askQuestions;
                localExplanationDetail.value = props.explanationDetail || 1;
                localExplanationBullets.value = !!props.explanationBullets;
                localExplanationLatex.value = !!props.explanationLatex;
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
                skip_reexecution: localSkipReexecution.value,
                ask_questions: localAskQuestions.value,
                explanation_detail: localExplanationDetail.value,
                explanation_bullets: localExplanationBullets.value,
                explanation_latex: localExplanationLatex.value,
            });
        };

        return { localGeminiKey, localClaudeKey, geminiEditing, claudeEditing, geminiRemoved, claudeRemoved, localSkipReexecution,
            localAskQuestions, localExplanationDetail, localExplanationBullets, localExplanationLatex, startEditing, removeKey, handleSave };
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
                <div class="field">
                    <label class="label">Gemini API Key</label>
                    <div class="control" v-if="geminiRemoved">
                        <div class="input settings-key-status">
                            Key will be removed on save
                        </div>
                    </div>
                    <div class="control" v-else-if="hasGeminiKey && !geminiEditing">
                        <div style="display: flex; align-items: center; gap: 0.5rem;">
                            <div class="input settings-key-masked"
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
                <hr>
                <div class="field">
                    <label class="label">Code generation</label>
                    <label class="checkbox">
                        <input type="checkbox" v-model="localAskQuestions">
                        Enable asking questions
                    </label>
                    <p class="help">
                        When on, the AI may reply to an action cell with a few questions instead
                        of code, whenever the description leaves it in doubt about what the cell
                        should do. It is the AI that decides: when the description is clear, it
                        simply writes the code.
                    </p>
                </div>
                <hr>
                <div class="field">
                    <label class="label">Execution</label>
                    <label class="checkbox">
                        <input type="checkbox" v-model="localSkipReexecution">
                        Skip re-execution of unchanged cells
                    </label>
                    <p class="help">
                        When on (default), a cell whose code and inputs have not changed is not
                        re-run — its result is reconstructed instead. Turn this off if cells depend on
                        untracked inputs such as the current time, random numbers, or external files.
                    </p>
                </div>
                <hr>
                <div class="field">
                    <label class="label">Code explanations</label>
                    <div class="field">
                        <label class="label is-small">Level of detail</label>
                        <div class="control">
                            <div class="select is-small">
                                <select v-model.number="localExplanationDetail">
                                    <option :value="1">Brief</option>
                                    <option :value="2">Normal</option>
                                    <option :value="3">Detailed</option>
                                    <option :value="4">Expert</option>
                                </select>
                            </div>
                        </div>
                    </div>
                    <label class="checkbox">
                        <input type="checkbox" v-model="localExplanationBullets">
                        Use bullet points
                    </label>
                    <br>
                    <label class="checkbox">
                        <input type="checkbox" v-model="localExplanationLatex">
                        Use LaTeX for equations
                    </label>
                    <p class="help">
                        Controls how the "Explain code" button writes the explanation.
                    </p>
                </div>
            </section>
            <footer class="modal-card-foot" style="justify-content: flex-end;">
                <button class="button is-primary" @click="handleSave">Save</button>
            </footer>
        </div>
    </div>`
};
