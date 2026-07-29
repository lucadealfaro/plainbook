import { computed } from './vue.esm-browser.js';

// Renders the AI-generated code explanation (markdown text stored in
// cell.metadata.ai_code_explanation). Display only; the explanation is produced
// and invalidated on the backend.
const md = new markdownit({ html: true });

export default {
    props: ['text'],
    setup(props) {
        const rendered = computed(() => md.render(props.text || ''));
        return { rendered };
    },
    template: /* html */ `
        <div class="code-explanation bg-scheme-bis p-4 border-top">
            <div class="is-size-7 has-text-grey mb-2">
                <i class="bx bx-message-bubble-detail"></i> AI code explanation
            </div>
            <div class="explanation-body content" v-html="rendered"></div>
        </div>
    `
};
