import re
import string

SPACES_AND_PUNCTUATION_PATTERN = f"^[{re.escape(string.punctuation + string.whitespace)}]+"

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


def build_context_prompt(
    preceding=None,
    previous=None,
    file_context=None,
    error_context=None,
    variable_context=None,
    validation_context=None):
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
