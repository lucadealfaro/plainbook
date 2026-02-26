import re
import string

SPACES_AND_PUNCTUATION_PATTERN = f"^[{re.escape(string.punctuation + string.whitespace)}]+"

CHARS_PER_TOKEN = 4
MAX_TOKENS_PER_ARGUMENT = 10_000
_MAX_CHARS_PER_ARGUMENT = MAX_TOKENS_PER_ARGUMENT * CHARS_PER_TOKEN

SYSTEM_INSTRUCTIONS = """
You are an assistant that writes Python code for Jupyter cells, and your task is to
write the code for one Jupyter cell.
You are given specific instructions on what the new cell should do.
To help write the code, you are also given the previous cells of the Jupyter notebook
(in JSON format), along with their output (if any) and a description of the variables
that are present after executing those cells.
Return ONLY the code, no markdown formatting or explanations.
To display Pandas dataframes, you can simply return the dataframe variable name,
and the notebook will render it appropriately.
"""

TEST_SYSTEM_INSTRUCTIONS = """
You are an assistant that writes Python test code for Jupyter notebook test cells.
Your task is to write code that tests the correctness of previous notebook cells.

Test cells can access the state of the notebook after any previous code cell
using the pattern: __state__<cell_name>.<variable_name>
The name of each code cell can be found in its cell.metadata["name"] field
in the notebook JSON provided as context.

For example, if a code cell has metadata name "load_data" and defines a variable `df`,
you access it in the test as: __state__load_data.df

When the instructions mention "this cell" or "the current cell", they refer to
the most recent code cell before this test cell.  The variables in this cell
can be accessed in the test using the same __state__<cell_name>.<variable_name> pattern, 
or they can also be accessed directly as <variable_name> without the __state__ prefix.

You are given the previous cells of the Jupyter notebook (in JSON format),
along with their output (if any) and a description of available variables.
Return ONLY the code, no markdown formatting or explanations.
Use assert statements for testing.
"""

NAME_GENERATION_INSTRUCTIONS = """You need to summarize what a notebook cell does using two or three words.
You will be given the cell's explanation, which describes what the cell does.
Please return at least 2 words, and at most 3. Return only these words."""


def build_name_prompt(explanation):
    """Builds the prompt for cell name generation."""
    return f"""This is the cell explanation:
{explanation}

Summarize what this cell does in 2-3 words:"""

CHECKING_INSTRUCTIONS = """
You are an assistant that validates Python code for Jupyter cells.
Your task is to check whether a Jupyter notebook cell does what it specified in its instructions.
You are given the instructions, the code of the cell to verify,
and you are also given all previous cells of the Jupyter notebook (in JSON format),
including with their output (if any).
You are also given a description of the variables that are present after executing those
previous cells.
You should return the words YES (if the code meets the instructions) or NO (if it does not),
followed by a brief explanation.
"""


def clean_start(text):
    return re.sub(SPACES_AND_PUNCTUATION_PATTERN, '', text)


def truncate_to_token_limit(text):
    """Truncate text to fit within the per-argument token limit.
    Keeps the tail (most recent content) and prepends a truncation marker."""
    if not text or len(text) <= _MAX_CHARS_PER_ARGUMENT:
        return text
    return "[...truncated...]\n" + text[-_MAX_CHARS_PER_ARGUMENT:]


def build_context_prompt(
    preceding=None,
    previous=None,
    file_context=None,
    error_context=None,
    variable_context=None,
    validation_context=None):
    preceding = truncate_to_token_limit(preceding)
    previous = truncate_to_token_limit(previous)
    file_context = truncate_to_token_limit(file_context)
    error_context = truncate_to_token_limit(error_context)
    variable_context = truncate_to_token_limit(variable_context)
    validation_context = truncate_to_token_limit(validation_context)
    prompt = f"""
CONTEXT (Existing Notebook Code):
{preceding}

"""
    if previous:
        prompt += previous + "\n\n"
    if error_context:
        prompt += f"""
ERROR CONTEXT:
{error_context}

"""
    if file_context:
        prompt += f"""
FILE CONTEXT:
{file_context}

"""
    if variable_context:
        prompt += f"""
VARIABLE CONTEXT (Variables currently in memory):
{variable_context}

"""
    if validation_context:
        prompt += f"""
VALIDATION FEEDBACK:
The previous code for this cell does not seem to be correct. Here are comments on it given by an AI model:
{validation_context}

"""
    return prompt


def strip_markdown_code_fences(code):
    """Strip ```python and ``` markdown fences from generated code."""
    if code.startswith("```python"):
        code = code[len("```python"):].strip()
    if code.endswith("```"):
        code = code[:-3].strip()
    return code


def parse_validation_response(text):
    """Parse a YES/NO validation response into a result dict."""
    r = text.strip()
    if r.upper().startswith("YES"):
        return dict(is_valid=True, message=clean_start(r[3:]))
    elif r.upper().startswith("NO"):
        return dict(is_valid=False, message=clean_start(r[2:]))
    else:
        return dict(is_valid=False, message=r)
