import re
import string

from google import genai
from google.genai import types

SPACES_AND_PUNCTUATION_PATTERN = f"^[{re.escape(string.punctuation + string.whitespace)}]+"

SYSTEM_INSTRUCTIONS = """
You are an assistant that writes Python code for Jupyter cells.
Return ONLY the code, no markdown formatting or explanations.
To display Pandas dataframes, you can simply return the dataframe variable name,
and the notebook will render it appropriately.
"""

CHECKING_INSTRUCTIONS = """
You are an assistant that validates Python code for Jupyter cells. 
Your task is to check whether the provided code meets the given instructions. 
The code of the previous cells is also included as context. 
You should return the words YES (if the code meets the instructions) or NO (if it does not), 
followed by a brief explanation.
"""

def clean_start(text):
    return re.sub(SPACES_AND_PUNCTUATION_PATTERN, '', text)

def gemini_generate_code(
    api_key, previous_code=None, instructions=None,
    file_context=None, error_context=None):
    # 1. Initialize the Client
    # The new SDK uses a centralized client for all model interactions
    client = genai.Client(api_key=api_key)
    
    # 2. Create the prompt
    prompt = f"""
CONTEXT (Existing Notebook Code):
{previous_code}

"""
    
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

    prompt += f"""    
INSTRUCTIONS for New Cell:
{instructions}

Code:
"""

    # print("Prompt:", prompt)

    # 3. Generate content
    # Note: System instructions are now passed inside the config argument
    response = client.models.generate_content(
        model="gemini-2.0-flash", 
        contents=prompt,
        config=types.GenerateContentConfig(
            system_instruction=SYSTEM_INSTRUCTIONS
        )
    )

    # 4. Process the response
    # We need to strip the ```python ` and trailing ```
    # There is no simple way to get gemini not add this :-) 
    code = response.text
    if code.startswith("```python"):
        code = code[len("```python"):].strip()
    if code.endswith("```"):
        code = code[:-3].strip()
    # print("Generated Code:", code)
    return code

# Usage
# new_code = generate_notebook_cell(api_key, previous_code, "Plot a sine wave with numpy")


def gemini_validate_code(api_key, previous_code, code_to_validate, instructions):
    client = genai.Client(api_key=api_key)
    
    prompt = f"""
CONTEXT (Existing Notebook Code):
{previous_code}

CODE TO VALIDATE:
{code_to_validate}

INSTRUCTIONS for Validation:
{instructions}

Validation Result:
"""

    response = client.models.generate_content(
        model="gemini-2.0-flash", 
        contents=prompt,
        config=types.GenerateContentConfig(
            system_instruction=CHECKING_INSTRUCTIONS
        )   
    )
    r = response.text.strip()
    if r.upper().startswith("YES"):
        validation_result = dict(is_valid=True, message=clean_start(r[3:]))
    elif r.upper().startswith("NO"):
        validation_result = dict(is_valid=False, message=clean_start(r[2:]))
    else:
        validation_result = dict(is_valid=False, message=r)
    return validation_result
