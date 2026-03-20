import os

import anthropic

from .ai_common import (
    SYSTEM_INSTRUCTIONS,
    TEST_SYSTEM_INSTRUCTIONS,
    CHECKING_INSTRUCTIONS,
    NAME_GENERATION_INSTRUCTIONS,
    add_tokens,
    build_context_prompt,
    build_name_prompt,
    dump_ai_request,
    log_ai_request_size,
    parse_validation_response,
    strip_markdown_code_fences,
)

# CLAUDE_MODEL = "claude-sonnet-4-5-20250929"
CLAUDE_MODEL = os.environ.get("ANTHROPIC_MODEL", "claude-haiku-4-5-20251001")

USE_BEDROCK = os.environ.get("CLAUDE_CODE_USE_BEDROCK") == "1"


def _get_client(api_key=None):
    """Create an Anthropic client, using Bedrock if configured."""
    if USE_BEDROCK:
        return anthropic.AnthropicBedrock(aws_region=os.environ["AWS_REGION"])
    elif api_key:
        return anthropic.Anthropic(api_key=api_key)
    else:
        return None

def get_claude_models(api_key):
    """Fetches the latest model IDs for each Claude family (haiku, sonnet, opus)
    from the Anthropic API. Returns a dict like {"haiku": "claude-haiku-...", ...}.
    Models are returned most-recent-first by the API, so the first match per
    family is the latest."""
    client = _get_client(api_key)
    families = {"haiku": None, "sonnet": None, "opus": None}
    after_id = None
    while True:
        kwargs = {"limit": 100}
        if after_id:
            kwargs["after_id"] = after_id
        page = client.models.list(**kwargs)
        for model in page.data:
            for family in families:
                if families[family] is None and family in model.id:
                    families[family] = model.id
            if all(families.values()):
                return families
        if not page.has_more:
            break
        after_id = page.last_id
    return families


def claude_generate_code(
    api_key,
    preceding_code=None,
    previous_code=None,
    instructions=None,
    file_context=None,
    error_context=None,
    variable_context=None,
    validation_context=None,
    model=None,
    debug=False,
    dump_ai_requests=False):
    client = _get_client(api_key)
    model = model or CLAUDE_MODEL

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
        log_ai_request_size("claude generate_code", SYSTEM_INSTRUCTIONS, prompt,
                            preceding=preceding_code, instructions=instructions,
                            previous=previous_code, file_context=file_context,
                            error_context=error_context, variable_context=variable_context,
                            validation_context=validation_context)
    if dump_ai_requests:
        dump_ai_request("claude generate_code", SYSTEM_INSTRUCTIONS, prompt)

    message = client.messages.create(
        model=model,
        max_tokens=4096,
        system=SYSTEM_INSTRUCTIONS,
        messages=[{"role": "user", "content": prompt}],
    )
    add_tokens(message.usage.input_tokens, message.usage.output_tokens)
    response_text = message.content[0].text
    if debug:
        print("Response:", response_text)
    code = strip_markdown_code_fences(response_text)
    return code


def claude_generate_test_code(
    api_key,
    preceding_code=None,
    previous_code=None,
    instructions=None,
    file_context=None,
    error_context=None,
    variable_context=None,
    validation_context=None,
    model=None,
    debug=False,
    dump_ai_requests=False):
    client = _get_client(api_key)
    model = model or CLAUDE_MODEL

    prompt = build_context_prompt(
        preceding=preceding_code,
        previous=previous_code,
        file_context=file_context,
        error_context=error_context,
        variable_context=variable_context,
        validation_context=validation_context)
    prompt += f"""
INSTRUCTIONS for Test Cell:
{instructions}

Code:
"""

    if debug:
        log_ai_request_size("claude generate_test_code", TEST_SYSTEM_INSTRUCTIONS, prompt,
                            preceding=preceding_code, instructions=instructions,
                            previous=previous_code, file_context=file_context,
                            error_context=error_context, variable_context=variable_context,
                            validation_context=validation_context)
    if dump_ai_requests:
        dump_ai_request("claude generate_test_code", TEST_SYSTEM_INSTRUCTIONS, prompt)

    message = client.messages.create(
        model=model,
        max_tokens=4096,
        system=TEST_SYSTEM_INSTRUCTIONS,
        messages=[{"role": "user", "content": prompt}],
    )
    add_tokens(message.usage.input_tokens, message.usage.output_tokens)
    response_text = message.content[0].text
    if debug:
        print("Response:", response_text)
    code = strip_markdown_code_fences(response_text)
    return code


def claude_validate_code(api_key, previous_code, code_to_validate, instructions, variable_context=None, model=None, debug=False, dump_ai_requests=False):
    client = _get_client(api_key)
    model = model or CLAUDE_MODEL

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
        log_ai_request_size("claude validate_code", CHECKING_INSTRUCTIONS, prompt,
                            preceding=previous_code, instructions=instructions,
                            variable_context=variable_context)
    if dump_ai_requests:
        dump_ai_request("claude validate_code", CHECKING_INSTRUCTIONS, prompt)

    message = client.messages.create(
        model=model,
        max_tokens=1024,
        system=CHECKING_INSTRUCTIONS,
        messages=[{"role": "user", "content": prompt}],
    )
    add_tokens(message.usage.input_tokens, message.usage.output_tokens)
    response_text = message.content[0].text
    if debug:
        print("Response:", response_text)
    return parse_validation_response(response_text)


def claude_generate_cell_name(api_key, explanation, model=None, debug=False, dump_ai_requests=False):
    client = _get_client(api_key)
    model = model or CLAUDE_MODEL
    prompt = build_name_prompt(explanation)
    if debug:
        log_ai_request_size("claude generate_name", NAME_GENERATION_INSTRUCTIONS, prompt)
    if dump_ai_requests:
        dump_ai_request("claude generate_name", NAME_GENERATION_INSTRUCTIONS, prompt)
    message = client.messages.create(
        model=model,
        max_tokens=50,
        system=NAME_GENERATION_INSTRUCTIONS,
        messages=[{"role": "user", "content": prompt}],
    )
    add_tokens(message.usage.input_tokens, message.usage.output_tokens)
    response_text = message.content[0].text
    if debug:
        print("Response to name generation:", response_text)
    return response_text.strip()
