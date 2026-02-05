const CellStateButton = {
    props: ['codeValid', 'outputValid', 'asRead', 'hasError', 'isNarrow', 'isOutput'],
    template: /* html */ `
        <button class="button is-small" :style="isNarrow ? 'opacity: 0.6; padding: 0.1rem 0.5rem;' : 'opacity: 0.6;'">
            <span v-if="isOutput">Output:&nbsp;</span>
            <span v-if="!codeValid">Stale</span>
            <span v-else-if="!outputValid">Stale</span>
            <span v-else-if="asRead">Unmodified</span>
            <span v-else>Up to date</span>
        </button>
    `
};

export default CellStateButton;
