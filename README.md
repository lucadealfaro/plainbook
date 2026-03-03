# <img src="https://github.com/lucadealfaro/plainbook/raw/main/plainbook/images/Plainbook_logo.png" height="30"> Plainbook: Natural Language Notebooks.

Authors: 

Luca de Alfaro, dealfaro@acm.org

## Installation and use

To install Plainbook, you can use pip:

```bash
pip install plainbook
```

To run Plainbook, you might first want to create a Python environment, in case you need to install packages: 

```bash

python -m venv plainbook-env
source plainbook-env/bin/activate  # On Windows, use `plainbook-env\Scripts\activate`
```
Then, you can run Plainbook on a notebook file (which will be created if it does not exist):

```bash
plainbook notebook.nlb
```

You can use any file name you like, with any extension you like.  

Here is a plainbook on football matches to get you started: [Download football.plb](https://github.com/lucadealfaro/plainbook/raw/main/examples/football.plb)


You need a Gemini or Claude API key to use Plainbook.  Click on the Settings button (the gear on the top right) and it will contain links where to get such keys. 

## Overview

The gloal of Plainbook is to allow users to create and communicate data analysis and science using natural language. 
Plainbooks are notebooks that combine instructions, with results, similarly to Jupyter notebooks. 
The difference is that in Plainbook, instructions are given in natural language, which is preserved in the notebook along with the results. 

Users can create the notebooks using entirely natural language, which is translated into code by AI. 
Users can also include in the plainbooks tests, also written in natural language, that help check that the notebook is working as expected. 

When sharing a plainbook, recipients can use AI, and in fact multiple AI providers if they so wish, to check that the "notebook does not lie", that is, that the code implementation is faithful to the natural language description, and they can also run the tests, as a further check. 
Recipients can also edit the natural language description, and regenerate the code, to adapt the notebook to their needs.

In other words, the goal of Plainbooks is to replicate in natural language what made Juptyter notebooks so successful: the ability to share together code and results, the ability to inspect how the results are obtained, and the ability to modify the notebook.  The difference is that in Plainbook, these activities are done via natural language and AI, rather than via code, and are thus accessible to a much wider audience.

**Plainbook Structure**
Plainbooks consist of three types of cells: 

* **Action cells**, where the user describes in natural language the action to be performed (e.g., "Load the dataset from file data.csv and display the first 10 rows").  The system converts the description to code, executes it, and displays the results below the cell.

* **Comment cells**, where the user can add comments, section headers, and so forth, using markdown syntax. 

* **Test cells**, where the user can write properties that should hold at certain points of the notebook to check that everything is working as expected.

Differently from other notebook systems, Plainbooks are executed from start to end: random cell execution order, as in Jupyter notebooks, is not allowed.  This ensures that the results are obtained in the same order in which a human reader would read the notebook.

**AI Providers**
Plainbook is designed to work with multiple AI providers, and users can choose which provider to use for code generation and checking.  The system is designed to allow users to easily switch between providers, so that users can cross-check that the implementation obtained from one provider is considered valid by another provider.  This avoids over-reliance on a single class of AI models. 
Currently, Plainbook supports Gemini and Claude models.  You will need an API key for at least one such provider to use Plainbook.

## Contributors

* Luca de Alfaro, main developer, UC Santa Cruz. 
* Mathis Aubert, UC Santa Cruz. 
* Ranjit Jhala, UC San Diego.
