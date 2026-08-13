import { ref, watch, nextTick } from './vue.esm-browser.js';

// NewNotebookModal.js
// Asks for the name of a new plainbook. It is created in the same folder as the
// current one (the server takes the basename, so a typed path cannot escape it),
// and opens in its own window with its own kernel -- exactly as if `plainbook
// <name>.plnb` had been run from the command line.
export default {
    props: ['isActive', 'folder'],
    emits: ['close', 'create'],
    setup(props, { emit }) {
        const localName = ref('');
        const inputEl = ref(null);

        // Start clean every time it opens, and put the cursor in the field.
        watch(() => props.isActive, (active) => {
            if (active) {
                localName.value = '';
                nextTick(() => { if (inputEl.value) inputEl.value.focus(); });
            }
        });

        const submit = () => {
            const name = localName.value.trim();
            if (!name) return;
            emit('create', name);
        };

        return { localName, inputEl, submit };
    },
    template: /* html */ `
    <div class="modal" :class="{'is-active': isActive}">
        <div class="modal-background" @click="$emit('close')"></div>
        <div class="modal-card" style="width: 90%; max-width: 480px;">
            <header class="modal-card-head">
                <p class="modal-card-title">New plainbook</p>
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
                        Created in <code>{{ folder || 'this notebook\\'s folder' }}</code>
                        and opened in a new window, with its own kernel.
                    </p>
                </div>
            </section>
            <footer class="modal-card-foot" style="justify-content: flex-end;">
                <button class="button" @click="$emit('close')">Cancel</button>
                <button class="button is-primary" :disabled="!localName.trim()"
                        @click="submit">Create</button>
            </footer>
        </div>
    </div>`
};
