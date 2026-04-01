// CellInsertionZone.js
export default {
    props: ['isActive', 'cellCount'],
    emits: ['insert'],
    template: /* html */ `
        <div class="cell-insert-zone" :class="{'show-cell-insert-zone': isActive }">
            <div class="cell-insert-buttons">
                <button
                    class="button insert-cell is-info is-small py-0 px-3"
                    @click.stop="$emit('insert', 'markdown')">
                    Insert Comment
                </button>
                <button
                    class="button insert-cell is-info is-small py-0 px-3"
                    @click.stop="$emit('insert', 'code')">
                    Insert Action
                </button>
                <button
                    v-if="cellCount > 0"
                    class="button insert-cell is-warning is-small py-0 px-3"
                    @click.stop="$emit('insert', 'test')">
                    Insert Global Test
                </button>
            </div>
        </div>
    `
};