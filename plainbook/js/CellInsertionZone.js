// CellInsertionZone.js
export default {
    props: ['isActive'],
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
            </div>
        </div>
    `
};