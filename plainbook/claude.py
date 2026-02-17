import anthropic

from .ai_common import (
    SYSTEM_INSTRUCTIONS,
    CHECKING_INSTRUCTIONS,
    build_context_prompt,
    parse_validation_response,
    strip_markdown_code_fences,
)

# CLAUDE_MODEL = "claude-sonnet-4-5-20250929"
CLAUDE_MODEL = "claude-haiku-4-5-20251001"

def claude_generate_code(
    api_key,
    preceding_code=None,
    previous_code=None,
    instructions=None,
    file_context=None,
    error_context=None,
    variable_context=None,
    validation_context=None,
    debug=False):
    client = anthropic.Anthropic(api_key=api_key)

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

    message = client.messages.create(
        model=CLAUDE_MODEL,
        max_tokens=4096,
        system=SYSTEM_INSTRUCTIONS,
        messages=[{"role": "user", "content": prompt}],
    )
    response_text = message.content[0].text
    if debug:
        print("Response:", response_text)
    code = strip_markdown_code_fences(response_text)
    return code


def claude_validate_code(api_key, previous_code, code_to_validate, instructions, variable_context=None, debug=False):
    client = anthropic.Anthropic(api_key=api_key)

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

    message = client.messages.create(
        model=CLAUDE_MODEL,
        max_tokens=1024,
        system=CHECKING_INSTRUCTIONS,
        messages=[{"role": "user", "content": prompt}],
    )
    response_text = message.content[0].text
    if debug:
        print("Response:", response_text)
    return parse_validation_response(response_text)
