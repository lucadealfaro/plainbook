# Development Instructions

## Installation

From the git repo: 

```bash
pip install --no-cache-dir --force-reinstall git+ssh://git@github.com/lucadealfaro/nlbook.git
```

## Building the package

To build the package, run:

```bash
python -m build
```

To deploy to PyPI:

```bash
python -m twine upload dist/*
```
