export default {
    props: ['isActive'],
    emits: ['close'],
    template: /* html */ `
    <div class="modal" :class="{'is-active': isActive}">
        <div class="modal-background" @click="$emit('close')"></div>
        <div class="modal-card" style="width: 90%; max-width: 900px;">
            <header class="modal-card-head">
                <p class="modal-card-title">Global Test Cells</p>
                <button class="delete" aria-label="close" @click="$emit('close')"></button>
            </header>
            <section class="modal-card-body">
                <div class="help-container p-5">
                    <div class="content">
                        <p>
                        Global test cells allow you to write tests that the notebook should satisfy.
                        </p><p>
                        You can write simple, or global tests:
                        </p>
                        <ul>
                            <li class="mt-4"><b>Simple tests</b> validate the output of the previous cell. 
                            <blockquote><em>Example:</em> Check that for each team, the total of the 
                            at home and away matches equals the total matches.</blockquote></li>
                            <li class="mt-4"><b>Global tests</b> compare values between different cells by 
                            referencing the cell names. 
                            <blockquote><em>Example:</em> Ensure that all teams loaded in the <t>load_teams</t> cell are present 
                            in the table computed by the <t>compute_stats</t> cell.</blockquote></li>
                        </ul>
                        Of course, a global test cell can only refer to the values of <em>previous</em> cells. 
                    </div>
                </div>
            </section>
            <footer class="modal-card-foot">
                <button class="button" @click="$emit('close')">Close</button>
            </footer>
        </div>
    </div>`
};
