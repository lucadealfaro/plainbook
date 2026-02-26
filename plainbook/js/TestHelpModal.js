export default {
    props: ['isActive'],
    emits: ['close'],
    template: /* html */ `
    <div class="modal" :class="{'is-active': isActive}">
        <div class="modal-background" @click="$emit('close')"></div>
        <div class="modal-card" style="width: 90%; max-width: 900px;">
            <header class="modal-card-head">
                <p class="modal-card-title">Test Cells</p>
                <button class="delete" aria-label="close" @click="$emit('close')"></button>
            </header>
            <section class="modal-card-body">
                <div class="help-container p-5">
                    <div class="content">
                        <h2 class="title is-4">Writing Tests</h2>
                        <p>
                        Test cells allow you to check that the plainbook is working as expected. 
                        In a test cell, you can write properties that should hold. 
                        </p><p>
                        A simple property can refer to the state after the previous cell has run, 
                        such as <em>check that the threshold computed is greater than 0.</em>
                        </p><p>
                        Properties can also relate the plainbook states after different cells. 
                        To refer to cells, you can use their names, displayed on the top left of cells. 
                        For instance, if a cell <em>load_data</em> loads a dataset, your property can say: 
                        <blockquote><em>
                            Check that the dataset, as filtered from the previous cell, contains all the 
                            data loaded in cell load_data that has non-null values for phone number. 
                        </em></blockquote>
                        </p><p>
                        The only restriction is that in a test, you can only refer to <em>preceding</em> cells. 
                        You can even compare the values of the same variable after different cells: 
                        <blockquote><em>
                            Check that the average computed in cell first_method is greater than the 
                            one computed in second_method, which in turn should be greater than the
                            one computed in third_method. 
                        </em></blockquote>
                        </p>
                        <h2 class="title is-4">Running Tests</h2>
                        <p>
                        Tests can be run either individually, by clicking the Run button in the 
                        cell itself, or all at once by clicking the "Run tests" button in the 
                        navbar.
                        </p>
                    </div>
                </div>
            </section>
            <footer class="modal-card-foot">
                <button class="button" @click="$emit('close')">Close</button>
            </footer>
        </div>
    </div>`
};
