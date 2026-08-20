import { ref, computed, watch, nextTick } from './vue.esm-browser.js';

// NewNotebookModal.js
// Asks for the name of a plainbook to create, in one of two modes: 'new' (an
// empty plainbook) or 'copy' (a duplicate of the current one). Either way the
// file is created in the same folder as the current notebook (the server takes
// the basename, so a typed path cannot escape it), and opens in its own window
// with its own kernel -- exactly as if `plainbook <name>.plnb` had been run
// from the command line. The parent picks the mode and calls the matching
// endpoint; this dialog only collects the name.
export default {
    props: ['isActive', 'folder', 'mode', 'defaultName'],
    emits: ['close', 'create'],
    setup(props, { emit }) {
        const localName = ref('');
        const inputEl = ref(null);

        const isCopy = computed(() => props.mode === 'copy');
        const title = computed(() => isCopy.value ? 'Copy plainbook' : 'New plainbook');
        const actionLabel = computed(() => isCopy.value ? 'Copy' : 'Create');

        // Start from the suggested name every time it opens, with the field
        // focused and the suggestion selected so typing simply replaces it.
        watch(() => props.isActive, (active) => {
            if (active) {
                localName.value = props.defaultName || '';
                nextTick(() => {
                    if (!inputEl.value) return;
                    inputEl.value.focus();
                    inputEl.value.select();
                });
            }
        });

        const submit = () => {
            const name = localName.value.trim();
            if (!name) return;
            emit('create', name);
        };

        return { localName, inputEl, isCopy, title, actionLabel, submit };
    },
    template: /* html */ `
    <div class="modal" :class="{'is-active': isActive}">
        <div class="modal-background" @click="$emit('close')"></div>
        <div class="modal-card" style="width: 90%; max-width: 480px;">
            <header class="modal-card-head">
                <p class="modal-card-title">{{ title }}</p>
                <button class="delete" aria-label="close" @click="$emit('close')"></button>
            </header>
            <section class="modal-card-body">
                <div class="field">
                    <label class="label">Name</label>
                    <div class="field has-addons">
                        <div class="control is-expanded">
                            <input class="input" type="text" ref="inputEl"
                                   v-model="localName"
                                   placeholder="my-analysis"
                                   @keyup.enter="submit">
                        </div>
                        <div class="control">
                            <span class="button is-static">.plnb</span>
                        </div>
                    </div>
                    <p class="help">
                        <span v-if="isCopy">
                            A copy of this plainbook is created in
                            <code>{{ folder || 'this notebook\\'s folder' }}</code>
                            and opened in a new window, with its own kernel;
                            you keep working here on the original.
                        </span>
                        <span v-else>
                            Created in <code>{{ folder || 'this notebook\\'s folder' }}</code>
                            and opened in a new window, with its own kernel.
                        </span>
                        If the name is already taken, <code>_2</code>, <code>_3</code>, ...
                        is appended.
                    </p>
                </div>
            </section>
            <footer class="modal-card-foot" style="justify-content: flex-end;">
                <button class="button" @click="$emit('close')">Cancel</button>
                <button class="button is-primary" :disabled="!localName.trim()"
                        @click="submit">{{ actionLabel }}</button>
            </footer>
        </div>
    </div>`
};
