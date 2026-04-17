import { computed, ref } from './vue.esm-browser.js';
import { opColor } from './HistoryReplay.js';

const LANE_COUNT = 6;
const LANE_LABELS = ['structural', 'edits', 'execute', 'AI', 'settings', 'active cell'];

function opLane(op, isClient) {
    if (isClient) return 5;
    if (op === 'insert_cell' || op === 'delete_cell' || op === 'move_cell') return 0;
    if (op.startsWith('edit_') || op === 'clear_code') return 1;
    if (op.startsWith('execute_') || op === 'run_unit_test_cell') return 2;
    if (op.startsWith('generate_') || op.startsWith('validate_')) return 3;
    return 4;
}

export default {
    props: ['log', 'current'],
    emits: ['seek', 'select'],
    setup(props, { emit }) {
        const zoom = ref(1);
        const zoomIn = () => { zoom.value = Math.min(zoom.value * 1.5, 32); };
        const zoomOut = () => { zoom.value = Math.max(zoom.value / 1.5, 1); };
        const zoomReset = () => { zoom.value = 1; };

        const bounds = computed(() => {
            if (!props.log || props.log.length === 0) return { t0: 0, t1: 1 };
            const toMs = (s) => {
                if (!s) return 0;
                const t = Date.parse(s.endsWith('Z') ? s : s + 'Z');
                return Number.isNaN(t) ? 0 : t;
            };
            const t0 = toMs(props.log[0].ts_server);
            const t1 = toMs(props.log[props.log.length - 1].ts_server);
            return { t0, t1: t1 === t0 ? t0 + 1 : t1 };
        });

        const dots = computed(() => {
            const b = bounds.value;
            const span = b.t1 - b.t0 || 1;
            return props.log.map((e, i) => {
                const ts = Date.parse((e.ts_server || '').endsWith('Z') ? e.ts_server : e.ts_server + 'Z') || b.t0;
                const pct = Math.max(0, Math.min(100, ((ts - b.t0) / span) * 100));
                const isClient = e.source === 'client';
                const lane = opLane(e.op, isClient);
                return {
                    idx: i,
                    op: e.op,
                    color: opColor(e.op),
                    left: pct,
                    top: ((lane + 1) / (LANE_COUNT + 1)) * 100,
                    isClient,
                    label: `${e.op} · ${(e.ts_server || '').slice(11, 19)}`,
                };
            });
        });

        const lanes = computed(() =>
            LANE_LABELS.map((label, i) => ({
                label,
                idx: i,
                top: ((i + 1) / (LANE_COUNT + 1)) * 100,
            })));

        const onSlider = (ev) => emit('seek', Number(ev.target.value));
        const onDotClick = (i) => emit('select', i);

        const currentEntry = computed(() => props.log[props.current] || null);
        const currentLabel = computed(() => {
            const e = currentEntry.value;
            if (!e) return '';
            const ts = (e.ts_server || '').slice(11, 19);
            const n = props.log.length;
            return `Entry ${props.current + 1} of ${n} · ${ts} · ${e.op}`;
        });

        const trackStyle = computed(() => ({ width: `${100 * zoom.value}%` }));

        return {
            dots, lanes, onSlider, onDotClick, currentLabel,
            zoom, zoomIn, zoomOut, zoomReset, trackStyle,
        };
    },
    template: `
        <div class="log-timeline">
            <div class="log-timeline-label" style="display: flex; align-items: center; gap: 0.5rem;">
                <span style="flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">{{ currentLabel }}</span>
                <span class="is-size-7 has-text-grey" style="white-space: nowrap;">zoom ×{{ zoom.toFixed(2) }}</span>
                <div class="buttons has-addons mb-0">
                    <button class="button is-small" @click="zoomOut" title="Zoom out" :disabled="zoom <= 1">
                        <span class="icon is-small"><i class="bx bx-minus"></i></span>
                    </button>
                    <button class="button is-small" @click="zoomReset" title="Reset zoom" :disabled="zoom === 1">
                        <span class="icon is-small"><i class="bx bx-reset"></i></span>
                    </button>
                    <button class="button is-small" @click="zoomIn" title="Zoom in">
                        <span class="icon is-small"><i class="bx bx-plus"></i></span>
                    </button>
                </div>
            </div>
            <div class="log-timeline-frame">
                <div class="log-timeline-lanes">
                    <div v-for="l in lanes" :key="l.idx" class="log-timeline-lane-label"
                         :style="{ top: l.top + '%' }">{{ l.label }}</div>
                </div>
                <div class="log-timeline-scroll">
                    <div class="log-timeline-track" :style="trackStyle">
                        <div v-for="l in lanes" :key="l.idx" class="log-timeline-laneline"
                             :style="{ top: l.top + '%' }"></div>
                        <div v-for="d in dots" :key="d.idx"
                             class="log-timeline-dot"
                             :class="{ 'is-client': d.isClient }"
                             :style="{ left: d.left + '%', top: d.top + '%', backgroundColor: d.color }"
                             :title="d.label"
                             @click="onDotClick(d.idx)"></div>
                    </div>
                    <input type="range" class="log-timeline-slider"
                           :style="trackStyle"
                           :min="0" :max="log.length - 1"
                           :value="current" @input="onSlider" />
                </div>
            </div>
        </div>
    `,
};
