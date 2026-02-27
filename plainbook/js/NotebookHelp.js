const NotebookHelp = {
    template: /* html */ `
        <div class="help-container p-5">
            <div class="content">
                <h1 class="title">Plainbook</h1>

                <p>A Plainbook is a document that contains a series of cells. 
                The cells describe in plain language what you want to do.  Your instructions are translated into code and executed.
                <strong>You need at least one AI key to use Plainbook</strong>, which you can set in the settings menu.</p>
                <p>There are three types of cells:</p>
                <ul>
                    <li><strong>Comment cells:</strong> Used for comments and explanations; you can use markdown notation.</li>
                    <li><strong>Action cells:</strong> Describe here in plain language what you want to do.  
                    Your instructions will be translated into code and executed.</li>
                    <li><strong>Test cells:</strong> Write properties that should hold at certain points of the notebook 
                    to check that everything is working as expected.</li>
                </ul>

                <h2 class="title is-4">Working with Action Cells</h2>
                <ul>
                    <li><strong>Run:</strong> Click the play button to execute the notebook up to the current cell.  
                    Any missing code is generated before the cells are run.</li>
                    <li><strong>Regenerate Code:</strong> Ask AI to generate or fix code based on your description.</li>
                    <li><strong>Validate Code:</strong> Check if the generated code matches your description.</li>
                    <li><strong>Move:</strong> Use arrow buttons to reorder cells.</li>
                    <li><strong>Delete:</strong> Click the trash button to remove a cell</li>
                </ul>
                <p><strong>Execution order:</strong> Unlike in Jupyter Notebooks, cells are always guaranteed to be executed in order, starting from the beginning.
                If you click "Run" on a cell, all preceding cells will be executed first to ensure that the notebook 
                is always in a consistent state.</p>

                <h2 class="title is-4">Working with Test Cells</h2>
                <p>Test cells allow you to check that the plainbook is working as expected. 
                You can write properties that should hold after a cell is executed, and you can even compare the state of the notebook after different cells.
                For more details on how to write tests, create a test cell and click on the information button.</p>

                <h2 class="title is-4">Reading Files</h2>
                <p>To read a file, first select it using the file manager at the top.  
                Then, you can refer to the file in your instructions using its name.
                This is done because if you simply cited a file name, AI would not be able to locate it 
                in your file system!</p>

                <h2 class="title is-4">Buttons and Settings</h2>
                <ul style="list-style: none; padding-left: 0;">
                    <li class="mb-2"><button class="button is-small is-light"><i class="bx bx-lock-open"></i></button> 
                    You can use this button to toggle the read-only state of the notebook.  A read-only notebook can be run, but cannot be accidentally modified.</li>
                    <li class="mb-2"><button class="button is-small is-light"><i class="bx bx-broom"></i></button> 
                    This button clears all outputs.</li>
                    <li class="mb-2"><button class="button is-small is-primary"><i class="bx bx-keyframe-ease-in"></i></button> 
                    Run the notebook from the beginning to the end.</li>
                    <li class="mb-2"><button class="button is-small is-primary"><i class="bx bx-play"></i></button> 
                    Ensure that all cells have been run, running them as needed.</li>
                    <li class="mb-2"><button class="button is-small is-warning"><i class="bx bx-seal-check"></i></button> 
                    Run all tests.  Tests are not run when you run the notebook.</li>
                    <li class="mb-2"><button class="button is-small is-success"><i class="bx bx-shield"></i></button> 
                    Toggles whether cell output is shared with AI (check not shown) or not (check shown).  
                    If you are working with sensitive data, you may not want to share the cell outputs with AI. 
                    Sharing the outputs with AI helps generate better code, and is the default setting for a notebook.</li>
                    <li class="mb-2"><button class="button is-small is-light"><i class="bx bx-light-bulb"></i></button> 
                    This dropdown allows you to switch between different AI models.</li>
                </ul>

                <h2 class="title is-4">Tips for Best Results</h2>
                <ul>
                    <li>Write clear, detailed descriptions of what you want the code to do.</li>
                    <li>If the generated code isn't right, update the description and regenerate.</li>
                </ul>

                <h2 class="title is-4">The Plainbook Project</h2>
                <p>Plainbook is open source.  You can visit the 
                <a href="https://github.com/lucadealfaro/plainbook" target="_blank">project 
                home page</a>, and install it as a 
                <a href="https://pypi.org/project/plainbook/" target="_blank">Python package</a>. </p>

            </div>
        </div>
    `
};

export default NotebookHelp;
