import os
import shutil
import tempfile

import pytest


@pytest.fixture
def tmp_notebook_path():
    """Provides a temporary .ipynb path inside a temp directory; cleans up after."""
    tmpdir = tempfile.mkdtemp()
    nb_path = os.path.join(tmpdir, "test_notebook.ipynb")
    yield nb_path
    shutil.rmtree(tmpdir, ignore_errors=True)
