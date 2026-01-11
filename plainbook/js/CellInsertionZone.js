// CellInsertionZone.js
export default {
    props: ['isLast'],
    emits: ['insert'],
    template: /* html */ `
        <div class="cell-insert-zone" :class="{'last-cell-insert-zone': isLast }">
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
            </div>
        </div>
    `
};