# Test Cells

I want to develop another type of cell, a test cell. 
These cells will be used to test the notebook, and they are able to access the state of the notebook at multiple points in the execution. 

These cells should have a new cell_type, so that they are not confused with markdown or code cells. 
Call them "test", so they have: 

"cell_type": "test"

Aside from this, they are similar to code cells: they have: 

* metadata["explanation"]: the explanation of the test
* source: the source code of the test
* outputs: the output of the test. 
* code_timestamp
* explanation_timestamp

It does NOT have variables. 

## Creating a test cell

To create a test cell, we should add a button to the CellInsertionZone.  Once at least one cell is present, we should have an option that reads "Insert Test". 

The UI is then very similar to that of code cells, and in fact, my recommendation is that tests are handled by the same Vue components as code cells (namely, ExplanationEditor).  
There is some difference in the button names, but not really in the button function. The names should be: 
* Clear test (instead of Clear code).  Note: this button will be hidden later, for test cells, but let's leave it for now. 
* Regenerate test 
* Validate test

There should also be an extra button, called "Test Help". 

When Test Help is pressed, it should open a modal, called TestHelpModal, in which we can later put help for how to create tests.  For now, you can leave that modal essentially empty; we will work on it later.  Do it similar to the InfoModal. 

## Creating the test code. 

The test code is created from the text explanation, but it uses a different call -- not /generate_code, but /generate_test_code.  We will work later on the implementation; for the moment, just call a generate_test_code in plainbook_base, and leave it unimplemented; we will work on implementing this next. 

## Running the tests

The buttons on top to run the whole notebook should not run the tests. 
Tests should be run only in two cases: 

* When the Run button is pressed on the test cell itself; 
* When a new "Run tests" button is pressed on the top bar. 

The "Run tests" button needs to be added, with icon bx-seal-check. 

The logic is as follows. 

To run normal cells, it is not necessary to ensure that tests have been run.  So we can leave the logic of code cells (non-test cells) unchanged. 

To run test cells, we need to add a ui_runTestCell function that runs a test cell, and a runOneTest function.  They need to check that all the previous cells have run, and thus that all their code has been generated.  So they may well call runOneCell etc.  
We also need to add a funciton ui_runAllTests that runs all tests. 

We do not need to keep track of which tests have been run; so, we do not need to have a last_executed_test tracker or similar. 
However, we do need to keep track of whether the test cell code is valid, and so, we need to have a last_valid_test_cell variable that is tracked in plainbook_base.py , and communicated to the front end via updateState.  The test code should be invalidated with the same logic used for invalidating the cell code, so you can look at plainbook_base.py and do similarly to what is done there for last_valid_code_cell.  

## What to do now

We will write later the code to run a test in plainbook_base.py, and we will also write later the code to generate the test code.  For now, I want to focus on wiring up the UI and the front-end to the backend, and on the logic for managing last_valid_test_cell. 



