# Plainbook

This is a project to create a plain language version of Python notebooks. 

## Plainbook format

Plainbooks are stored using the same format as Jupyter notebooks, but differ in the way in 
which the format is interpreted. 
A plainbook has two kinds of cells: 

* **Action Cells:** In an action cell, the cell.markdown.explanation contains a description in plain language of what the cell should do.  The cell is represented similarly to a code cell of Jupyter.  The source code is generated automatically from the explanation using an LLM, and it is stored in cell.source. 

* **Comment cells:** These are like the markdown cells in Jupyter. 

## Code organization

The code is divided into server code, and client code. 

### Server Code

The server code is written in Python, on top of the bottle.py web server. 
The main files are as follows: 
* main.py : web interface. 
* plainbook_ipython.py : contains a class representing a plainbook, with methods for saving cell content, executing cells, and so on. 
* gemini.py : interface to Gemini LLM for code generation and verification. 

### Client Code

The client code is written in Javascript, with the help of the following frameworks: 

* Vue 3 javascript framework
* Bulma css framework
* Awesome Font 4.7 icons

#### Javascript code organization

The main file is in views/index.html; it loads js/nb.js as the main client code. 
In turn, js/nb.js loads all the other Vue components in the js/ folder. For example, the top app navbar is in js/AppNavbar.js, the code for displaying a cell is in js/NotebookCell.js, and so on. 

#### CSS code organization

The CSS is in css/main.css.  This file is not edited per se; see the css/README.md file for details. 
Essentially, the css/main.css file is generated from css/main.scss using: 

    npm run build

## Future work

 In plainbook/plainbook_jupyter.py , there is an implementation of plainbook based on the Jupyter Python kernel.  It works.  The only problem is that the Jupyter kernel is not a snapshotting kernel -- that is, it does not keep a snapshot of a state after executing a cell.  So I would like to develop an analogous class, in a separate file, that uses a snapshotting kernel.  The class is called Plainbook_SnapshotKernel, and the file is plainbook_snapshot_kernel.py .  The idea is this.
Once you use a snapshotting kernel, you can associate with each cell the name of the state snapshot created by executing that cell in order.  So if you need to re-execute a cell, you don't need to start from the beginning; you can just start from the snapshot just before the cell.
You can find the snapshot-based kernel SnapshotKernel at https://github.com/lucadealfaro/snapshot-kernel .
Note that communication with the snapshot kernel is different than with the normal Jupyter kernel.  One needs to start the bottle-based web server of the snapshotting kernel at a port of our choice (not 8080 or something close to what we use for this application; choose ports in a different range), and one needs to communicate with it via HTTP API.
I recommend using the requests library, rather than basic urllib, in order to do requests to the API.
