# <img src="https://github.com/lucadealfaro/plainbook/raw/main/plainbook/images/Plainbook_logo.png" height="30"> Plainbook: Natural Language Notebooks

Plainbooks allow users to create and communicate data analysis and science using natural language. 

Plainbooks are notebooks that combine instructions and results, similarly to Jupyter notebooks. 
The difference is that Plainbook are in natural language: the code is generated "under the hood" using AI. 
The use of plain language allows you to share your data analysis and science with a much wider audience, including people who do not know how to code. 

Plainbook can use multiple AIs to check that the code faithfully implements the natural language description, and can include tests to further validate the notebook. 
When you share a notebook, the recipients can also check that the code under the hood implements the natural-language tasks. Recipients can also edit the plainbook, regenerate the code, and rerun it, just as in Jupyter notebooks. 

Thus, the goal of the Plainbook project is to replicate in natural language what made Jupyter notebooks so successful: the ability to share together code and results, so that any recipient can validate and modify the notebook.

### Try Plainbook Now

**Quick Start Videos:**
* [30-second demo](https://youtu.be/0t4ND8wPoYA)
* [5-minute introduction](https://youtu.be/Mkv5cl5rA7s)

**Run on GitHub Codespaces (no installation needed):**
1. Click **Code** → **Codespaces** in the GitHub interface
2. Wait ~3 minutes for the environment to set up
3. Click **Open in Browser** for port 8080
4. A trial Claude API key is provided; you can add your own in Settings

**Example Notebooks:**
* [Soccer World Cup Analysis](https://github.com/lucadealfaro/plainbook/raw/main/examples/Soccer_w_Tests.plnb) — demonstrates action cells, tests, and AI validation


## Installation and use

You can install Plainbook with pip: 

```bash
pip install plainbook
```

To open a plainbook (which will be created if it does not exist): 

```bash
plainbook notebook.plnb
```

You can use any file name you like, with any extension you like. 

**AI API Keys.** You need a Gemini or Claude API key to use Plainbook. Click on the Settings button (the gear on the top right) to see instructions on how to set them. Both providers offer free trial credits, and usage costs are typically low for regular notebook work.

### Key Features

- **Natural language notebooks:** Describe what you want in plain English; AI generates and validates the code. 
- **Multiple AI providers:** Use Gemini, Claude, or both—cross-check implementations for robustness.
- **Built-in testing:** Write test cells to verify notebook behavior automatically.
- **Shareable & reproducible:** Share notebooks with others who can modify, regenerate, and rerun your work.

### Resources

* [GitHub Repository](https://github.com/lucadealfaro/plainbook).
* [Pypi package](https://pypi.org/project/plainbook/).


## Plainbook Structure

Plainbooks consist of three types of cells: 

* **Action cells**, where the user describes in natural language the action to be performed (e.g., "Load the dataset from file data.csv and display the first 10 rows").  The system converts the description to code, executes it, and displays the results below the cell.

* **Comment cells**, where the user can add comments, section headers, and so forth, using markdown syntax. 

* **Test cells**, where the user can write properties that should hold at certain points of the notebook to check that everything is working as expected.

Differently from standard Jupyter notebooks, Plainbooks cells are guaranteed to be executed in order, from first to last, matching the order in which humans read the cells. Plainbooks relies on a [checkpointing kernel](https://github.com/lucadealfaro/snapshot-kernel) to remember the execution state after each cell, so that it can re-run a cell without having to start from the beginning.

**AI Providers**
Plainbook is designed to work with multiple AI providers, and users can choose which provider to use for code generation and checking.  The system is designed to allow users to easily switch between providers, so that users can cross-check that the implementation obtained from one provider is considered valid by another provider.  This avoids over-reliance on a single class of AI models. 
Currently, Plainbook supports Gemini and Claude models.  You will need an API key for at least one such provider to use Plainbook.

## Contributors

* [Luca de Alfaro](https://github.com/lucadealfaro), UC Santa Cruz. 
* [Mathis Aubert](https://github.com/Maths-A), UC Santa Cruz. 
* [Ranjit Jhala](https://github.com/ranjitjhala), UC San Diego.
