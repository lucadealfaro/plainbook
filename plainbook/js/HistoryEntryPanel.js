import { ref, computed } from './vue.esm-browser.js';
import { opColor } from './HistoryReplay.js';

export default {
    props: ['entry'],
    setup(props) {
        const expanded = ref(false);
        const toggle = () => { expanded.value = !expanded.value; };

        const pretty = (v) => {
            if (v === null || v === undefined) return '';
            try { return JSON.stringify(v, null, 2); }
            catch { return String(v); }
        };
        const paramsPretty = computed(() => pretty(props.entry && props.entry.params));
        const resultPretty = computed(() => pretty(props.entry && props.entry.result));
        const snapPretty = computed(() => pretty(props.entry && props.entry.cell_snapshot));

        const parseTs = (s) => {
            if (!s) return null;
            const d = new Date(s.endsWith('Z') ? s : s + 'Z');
            return isNaN(d.getTime()) ? null : d;
        };
        const pad2 = (n) => String(n).padStart(2, '0');
        const tsShort = computed(() => {
            const s = (props.entry && props.entry.ts_server) || '';
            const d = parseTs(s);
            if (!d) return s.slice(11, 19);
            return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} `
                + `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
        });
        const tsLong = computed(() => {
            const s = (props.entry && props.entry.ts_server) || '';
            const d = parseTs(s);
            if (!d) return s;
            return d.toLocaleString(undefined, {
                weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
                hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
            });
        });
        const opTagStyle = computed(() => {
            if (!props.entry) return {};
            return { backgroundColor: opColor(props.entry.op), color: '#fff' };
        });
        const cellLabel = computed(() => {
            const e = props.entry;
            if (!e) return '';
            if (e.cell_id) return `cell ${String(e.cell_id).slice(0, 8)} (idx ${e.cell_index ?? '?'})`;
            if (e.source === 'client') {
                const to = e.to_id ? String(e.to_id).slice(0, 8) : '—';
                return `active cell → ${to} (idx ${e.to_index ?? '?'})`;
            }
            return '';
        });

        return {
            expanded, toggle,
            paramsPretty, resultPretty, snapPretty,
            tsShort, tsLong, opTagStyle, cellLabel,
        };
    },
    template: `
        <div class="log-entry-panel">
            <div v-if="!entry" class="log-entry-empty has-text-grey px-3 py-2 is-size-7">
                Click a dot on the timeline to inspect an entry.
            </div>
            <div v-else class="log-entry-wrapper">
                <div class="log-entry-header px-3 py-2" @click="toggle"
                     style="display: flex; align-items: center; gap: 0.5rem; cursor: pointer; user-select: none;">
                    <span class="icon is-small">
                        <i class="bx" :class="expanded ? 'bx-chevron-down' : 'bx-chevron-right'"></i>
                    </span>
                    <span class="tag" :style="opTagStyle">{{ entry.op }}</span>
                    <span class="is-size-7 has-text-grey">{{ tsShort }}</span>
                    <span v-if="entry.duration_ms !== undefined && entry.duration_ms !== null"
                          class="is-size-7 has-text-grey">· {{ entry.duration_ms }} ms</span>
                    <span v-if="cellLabel" class="is-size-7 has-text-grey">· {{ cellLabel }}</span>
                    <span v-if="entry.source === 'client'" class="tag is-light is-size-7">client</span>
                    <span v-if="entry.error" class="tag is-danger is-light is-size-7">
                        <i class="bx bx-error-circle mr-1"></i> error
                    </span>
                    <span style="flex: 1;"></span>
                    <span class="is-size-7 has-text-grey-light">{{ expanded ? 'click to collapse' : 'click for details' }}</span>
                </div>
                <div v-if="expanded" class="log-entry-details px-3 pb-3">
                    <p class="is-size-7 has-text-grey mb-2">
                        <span>{{ tsLong }}</span>
                        <span class="has-text-grey-light"> · {{ entry.ts_server }}</span>
                        <span v-if="entry.ts_client"> · client: {{ entry.ts_client }}</span>
                    </p>
                    <p v-if="entry.error" class="notification is-danger is-light py-2 px-3 mb-3">
                        <strong>Error:</strong> {{ entry.error }}
                    </p>
                    <div v-if="entry.source === 'client'" class="mb-3 is-size-7">
                        <p class="has-text-weight-semibold mb-1">Active-cell change</p>
                        <p>from <code>{{ entry.from_id || '—' }}</code> (idx {{ entry.from_index }}) →
                            <code>{{ entry.to_id || '—' }}</code> (idx {{ entry.to_index }})</p>
                        <p v-if="entry.duration_on_prev_ms !== null && entry.duration_on_prev_ms !== undefined">
                            duration on prev: {{ entry.duration_on_prev_ms }} ms
                        </p>
                    </div>
                    <div v-if="paramsPretty" class="mb-2">
                        <p class="has-text-weight-semibold is-size-7 mb-1">Params</p>
                        <pre class="log-json">{{ paramsPretty }}</pre>
                    </div>
                    <div v-if="resultPretty" class="mb-2">
                        <p class="has-text-weight-semibold is-size-7 mb-1">Result</p>
                        <pre class="log-json">{{ resultPretty }}</pre>
                    </div>
                    <div v-if="snapPretty" class="mb-2">
                        <p class="has-text-weight-semibold is-size-7 mb-1">Cell snapshot</p>
                        <pre class="log-json">{{ snapPretty }}</pre>
                    </div>
                </div>
            </div>
        </div>
    `,
};
