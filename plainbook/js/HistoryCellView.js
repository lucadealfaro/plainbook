import { computed } from './vue.esm-browser.js';
import OutputRenderer from './OutputRenderer.js';

const md = new markdownit({ html: true });

function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function highlightPython(code) {
    const text = code || '';
    if (!window.Prism || !window.Prism.languages || !window.Prism.languages.python) {
        return escapeHtml(text);
    }
    try {
        return window.Prism.highlight(text, window.Prism.languages.python, 'python');
    } catch (e) {
        return escapeHtml(text);
    }
}

export default {
    components: { OutputRenderer },
    props: ['cell', 'index', 'isActive'],
    setup(props) {
        const cellType = computed(() => props.cell && props.cell.cell_type);
        const source = computed(() => (props.cell && props.cell.source) || '');
        const explanation = computed(() =>
            (props.cell && props.cell.metadata && props.cell.metadata.explanation) || '');
        const outputs = computed(() =>
            (props.cell && Array.isArray(props.cell.outputs)) ? props.cell.outputs : []);
        const renderedExplanation = computed(() =>
            explanation.value ? md.render(explanation.value) : '');
        const renderedMarkdown = computed(() =>
            source.value ? md.render(source.value) : '');
        const highlightedCode = computed(() => highlightPython(source.value));
        const shortId = computed(() => {
            const id = (props.cell && props.cell.id) || '';
            return id ? id.slice(0, 8) : '';
        });

        return {
            cellType, source, explanation, outputs,
            renderedExplanation, renderedMarkdown, highlightedCode, shortId,
        };
    },
    template: /* html */ `
        <div class="log-cell box p-0 mb-2 is-clipped shadow-sm"
             :class="{ 'is-active-in-replay': isActive }">
            <div class="log-cell-header px-3 py-1 is-size-7 has-text-grey"
                 style="display: flex; align-items: center; gap: 0.5rem; border-bottom: 1px solid #ececec;">
                <span class="tag is-light">#{{ index }}</span>
                <span class="tag"
                      :class="{
                          'is-info is-light': cellType === 'code',
                          'is-warning is-light': cellType === 'test',
                          'is-primary is-light': cellType === 'markdown'
                      }">{{ cellType }}</span>
                <span v-if="shortId" class="has-text-grey-light is-family-monospace">{{ shortId }}</span>
                <span style="flex: 1;"></span>
                <span v-if="isActive" class="tag is-info">
                    <span class="icon is-small"><i class="bx bx-target-lock"></i></span>
                    <span>active</span>
                </span>
            </div>

            <div v-if="cellType === 'markdown'" class="markdown-body content p-3" v-html="renderedMarkdown"></div>

            <template v-else>
                <div v-if="explanation" class="log-cell-explanation markdown-body content px-3 pt-2 pb-1"
                     v-html="renderedExplanation"></div>
                <div v-else class="log-cell-explanation-empty px-3 pt-2 pb-1 is-size-7 has-text-grey-light is-italic">
                    (no explanation)
                </div>

                <div v-if="source" class="log-cell-code px-3 py-2">
                    <pre class="language-python m-0"><code class="language-python" v-html="highlightedCode + '\\n'"></code></pre>
                </div>
                <div v-else class="px-3 py-2 is-size-7 has-text-grey-light is-italic">
                    (no code)
                </div>

                <div v-if="outputs.length" class="log-cell-outputs px-3 py-2 border-top bg-scheme-main">
                    <output-renderer v-for="(out, oIdx) in outputs" :key="oIdx" :output="out" />
                </div>
            </template>
        </div>
    `,
};
