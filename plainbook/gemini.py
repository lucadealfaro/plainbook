from google import genai
from google.genai import types

from .ai_common import (
    SYSTEM_INSTRUCTIONS,
    CHECKING_INSTRUCTIONS,
    build_context_prompt,
    parse_validation_response,
    strip_markdown_code_fences,
)


GEMINI_GENERATE_MODEL = "gemini-2.5-flash"
GEMINI_VALIDATE_MODEL = "gemini-2.5-flash"


def gemini_generate_code(
    api_key,
    preceding_code=None,
    previous_code=None,
    instructions=None,
    file_context=None,
    error_context=None,
    variable_context=None,
    validation_context=None,
    model=None,
    debug=False):
    # 1. Initialize the Gemini client
    client = genai.Client(api_key=api_key)
    model = model or GEMINI_GENERATE_MODEL

    # 2. Create the prompt
    prompt = build_context_prompt(
        preceding=preceding_code,
        previous=previous_code,
        file_context=file_context,
        error_context=error_context,
        variable_context=variable_context,
        validation_context=validation_context)
    prompt += f"""
INSTRUCTIONS for New Cell:
{instructions}

Code:
"""

    if debug:
        print("Prompt:", prompt)

    # 3. Generate content
    response = client.models.generate_content(
        model=model,
        contents=prompt,
        config=types.GenerateContentConfig(
            system_instruction=SYSTEM_INSTRUCTIONS
        )
    )
    if debug:
        print("Response:", response.text)
    # 4. Process the response
    code = strip_markdown_code_fences(response.text)
    return code


def gemini_validate_code(api_key, previous_code, code_to_validate, instructions, variable_context=None, model=None, debug=False):
    client = genai.Client(api_key=api_key)
    model = model or GEMINI_VALIDATE_MODEL

    prompt = build_context_prompt(
        preceding=previous_code,
        variable_context=variable_context
    )
    prompt += f"""

CODE TO VALIDATE:
{code_to_validate}

INSTRUCTIONS for Validation:
{instructions}

Validation Result:
"""

    if debug:
        print("Prompt:", prompt)

    response = client.models.generate_content(
        model=model,
        contents=prompt,
        config=types.GenerateContentConfig(
            system_instruction=CHECKING_INSTRUCTIONS
        )
    )
    if debug:
        print("Response:", response.text)
    return parse_validation_response(response.text)
