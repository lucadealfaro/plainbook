// Pure replay logic for /log_view.
// Takes the initial state and a log and returns the reconstructed notebook
// state at entry `uptoIndex` (inclusive). No side effects.

const MUTATING_OPS = new Set([
    'edit_code', 'edit_markdown', 'edit_explanation', 'clear_code',
    'insert_cell', 'delete_cell', 'move_cell',
    'execute_cell', 'execute_test_cell', 'run_unit_test_cell',
    'generate_code', 'generate_test_code', 'generate_unit_test_cell_code',
    'validate_code', 'validate_unit_test_code',
    'save_unit_tests', 'save_unit_test_explanation', 'save_unit_test_code',
    'clear_unit_test_code', 'clear_unit_test_outputs',
    'set_validation_visibility', 'set_unit_test_validation_visibility',
]);

function cloneCell(c) {
    return {
        id: c.id,
        cell_type: c.cell_type,
        source: c.source || '',
        metadata: JSON.parse(JSON.stringify(c.metadata || {})),
        outputs: [],
    };
}

function buildInitialCells(initialState) {
    if (!initialState || !Array.isArray(initialState.cells)) return [];
    return initialState.cells.map(cloneCell);
}

function materializeErrorOutputs(snapshot) {
    const outputs = [];
    if (snapshot && snapshot.error) {
        outputs.push({
            output_type: 'error',
            ename: snapshot.error.ename || '',
            evalue: snapshot.error.evalue || '',
            traceback: Array.isArray(snapshot.error.traceback) ? snapshot.error.traceback : [],
        });
    }
    if (snapshot && snapshot.stderr) {
        outputs.push({
            output_type: 'stream',
            name: 'stderr',
            text: snapshot.stderr,
        });
    }
    return outputs;
}

function applyEntry(cells, entry, state) {
    const op = entry.op;
    const params = entry.params || {};
    const result = entry.result || {};
    const snap = entry.cell_snapshot;
    const idx = params.cell_index;

    switch (op) {
        case 'edit_code':
        case 'edit_markdown': {
            if (cells[idx]) cells[idx].source = params.source ?? cells[idx].source;
            break;
        }
        case 'edit_explanation': {
            if (cells[idx]) {
                cells[idx].metadata = cells[idx].metadata || {};
                cells[idx].metadata.explanation = params.explanation ?? '';
            }
            break;
        }
        case 'clear_code': {
            if (cells[idx]) cells[idx].source = '';
            break;
        }
        case 'insert_cell': {
            const insertAt = (result && result.index !== undefined) ? result.index : params.index;
            const cellFromResult = result && result.cell;
            const newCell = {
                id: (cellFromResult && cellFromResult.id) || `replay-${Math.random().toString(36).slice(2, 10)}`,
                cell_type: params.cell_type || (cellFromResult && cellFromResult.cell_type) || 'code',
                source: '',
                metadata: {},
                outputs: [],
            };
            cells.splice(insertAt, 0, newCell);
            break;
        }
        case 'delete_cell': {
            if (idx >= 0 && idx < cells.length) cells.splice(idx, 1);
            break;
        }
        case 'move_cell': {
            const to = params.new_index;
            if (idx >= 0 && idx < cells.length && to >= 0 && to <= cells.length) {
                const [moved] = cells.splice(idx, 1);
                cells.splice(to, 0, moved);
            }
            break;
        }
        case 'execute_cell':
        case 'execute_test_cell': {
            if (cells[idx]) {
                const errorOuts = materializeErrorOutputs(snap);
                cells[idx].outputs = errorOuts;
                if (entry.cell_id) state.lastExecutedByCellId[entry.cell_id] = entry.ts_server;
            }
            break;
        }
        case 'run_unit_test_cell': {
            if (entry.cell_id) state.lastExecutedByCellId[entry.cell_id] = entry.ts_server;
            break;
        }
        case 'generate_code':
        case 'generate_test_code': {
            if (cells[idx] && result && result.status === 'success' && typeof result.code === 'string') {
                cells[idx].source = result.code;
            }
            break;
        }
        case 'validate_code': {
            if (cells[idx] && result && result.validation) {
                cells[idx].metadata = cells[idx].metadata || {};
                cells[idx].metadata.validation = result.validation;
            }
            break;
        }
        case 'set_validation_visibility': {
            if (cells[idx] && cells[idx].metadata && cells[idx].metadata.validation) {
                cells[idx].metadata.validation.is_hidden = !!params.is_hidden;
            }
            break;
        }
        case 'save_unit_tests': {
            if (cells[idx] && params.unit_tests && typeof params.unit_tests === 'object') {
                cells[idx].metadata = cells[idx].metadata || {};
                cells[idx].metadata.unit_tests = JSON.parse(JSON.stringify(params.unit_tests));
            }
            break;
        }
        case 'save_unit_test_explanation':
        case 'save_unit_test_code':
        case 'clear_unit_test_code':
        case 'generate_unit_test_cell_code': {
            if (!cells[idx]) break;
            cells[idx].metadata = cells[idx].metadata || {};
            cells[idx].metadata.unit_tests = cells[idx].metadata.unit_tests || {};
            const testName = params.test_name;
            const role = params.role;
            if (!testName || (role !== 'setup' && role !== 'test')) break;
            const tests = cells[idx].metadata.unit_tests;
            if (!tests[testName]) {
                tests[testName] = { cells: { setup: { source: '', metadata: {} }, test: { source: '', metadata: {} } } };
            }
            tests[testName].cells = tests[testName].cells || {};
            tests[testName].cells[role] = tests[testName].cells[role] || { source: '', metadata: {} };
            const sub = tests[testName].cells[role];
            sub.metadata = sub.metadata || {};
            if (op === 'save_unit_test_explanation') {
                sub.metadata.explanation = params.explanation ?? '';
            } else if (op === 'save_unit_test_code') {
                sub.source = params.source ?? '';
            } else if (op === 'clear_unit_test_code') {
                sub.source = '';
            } else if (op === 'generate_unit_test_cell_code') {
                if (result && result.status === 'success' && typeof result.code === 'string') {
                    sub.source = result.code;
                }
            }
            break;
        }
        default:
            // remaining non-mutating ops: show up only as timeline dots
            break;
    }
}

export function replay(initialState, log, uptoIndex) {
    const cells = buildInitialCells(initialState);
    const initialMeta = (initialState && initialState.metadata) || {};
    const state = {
        activeCellId: null,
        lastExecutedByCellId: {},
        activeAiProvider: initialMeta.active_ai_provider || null,
        isLocked: !!initialMeta.is_locked,
        shareOutputWithAi: initialMeta.share_output_with_ai !== false,
    };
    const limit = Math.min(uptoIndex, log.length - 1);
    for (let i = 0; i <= limit; i++) {
        const entry = log[i];
        if (!entry) continue;
        if (entry.source === 'client' && entry.op === 'active_cell_change') {
            if (entry.to_id) state.activeCellId = entry.to_id;
            continue;
        }
        if (entry.source === 'server') {
            // Settings ops that don't mutate cells but change notebook-level state:
            if (entry.op === 'set_active_ai') {
                const p = entry.params || {};
                if (p.provider) state.activeAiProvider = p.provider;
                continue;
            }
            if (entry.op === 'lock_notebook') {
                const p = entry.params || {};
                state.isLocked = !!p.is_locked;
                continue;
            }
            if (entry.op === 'set_share_output') {
                const p = entry.params || {};
                state.shareOutputWithAi = !!p.share;
                continue;
            }
            try { applyEntry(cells, entry, state); }
            catch (e) { /* swallow; replay is best-effort */ }
        }
    }
    return {
        cells,
        activeCellId: state.activeCellId,
        lastExecutedByCellId: state.lastExecutedByCellId,
        activeAiProvider: state.activeAiProvider,
        isLocked: state.isLocked,
        shareOutputWithAi: state.shareOutputWithAi,
    };
}

export function isMutating(op) { return MUTATING_OPS.has(op); }

export const OP_COLOR = {
    edit_code: '#48c774', edit_markdown: '#48c774', edit_explanation: '#48c774', clear_code: '#48c774',
    save_unit_tests: '#48c774', save_unit_test_explanation: '#48c774', save_unit_test_code: '#48c774',
    clear_unit_test_code: '#48c774', clear_unit_test_outputs: '#48c774',
    insert_cell: '#3298dc', delete_cell: '#3298dc', move_cell: '#3298dc',
    execute_cell: '#ffdd57', execute_test_cell: '#ffdd57', run_unit_test_cell: '#ffdd57',
    generate_code: '#b86bff', generate_test_code: '#b86bff', generate_unit_test_cell_code: '#b86bff',
    validate_code: '#b86bff', validate_unit_test_code: '#b86bff',
    set_key: '#f14668', set_active_ai: '#f14668', set_files: '#f14668',
    set_ai_instructions: '#f14668', lock_notebook: '#f14668', set_share_output: '#f14668',
    reset_kernel: '#f14668', reset_tokens: '#f14668', interrupt_kernel: '#f14668',
    clear_outputs: '#f14668', cancel_ai_request: '#f14668',
    active_cell_change: '#b5b5b5',
};

export function opColor(op) { return OP_COLOR[op] || '#7a7a7a'; }
