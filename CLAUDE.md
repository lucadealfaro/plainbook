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
* plainbook.py : contains the `Plainbook` class, with methods for saving cell content, executing cells, and so on. It uses the snapshot kernel (https://github.com/lucadealfaro/snapshot-kernel) for code execution.
* gemini.py : interface to Gemini LLM for code generation and verification.
* claude.py : interface to Claude LLM for code generation and verification.

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

## Architecture note

The project uses a single `Plainbook` class in `plainbook/plainbook.py`, backed by the snapshot kernel (https://github.com/lucadealfaro/snapshot-kernel). The snapshot kernel runs as a subprocess and is communicated with via HTTP API. Each cell execution creates a named snapshot, enabling efficient re-execution from any point without restarting from the beginning.
