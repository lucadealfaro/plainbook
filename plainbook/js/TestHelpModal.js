export default {
    props: ['isActive'],
    emits: ['close'],
    template: /* html */ `
    <div class="modal" :class="{'is-active': isActive}">
        <div class="modal-background" @click="$emit('close')"></div>
        <div class="modal-card" style="width: 90%; max-width: 900px;">
            <header class="modal-card-head">
                <p class="modal-card-title">Test Help</p>
                <button class="delete" aria-label="close" @click="$emit('close')"></button>
            </header>
            <section class="modal-card-body">
                <p>Help for writing tests will be available here soon.</p>
            </section>
            <footer class="modal-card-foot">
                <button class="button" @click="$emit('close')">Close</button>
            </footer>
        </div>
    </div>`
};
