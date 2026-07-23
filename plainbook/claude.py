import os

import anthropic

from .ai_common import (
    SYSTEM_INSTRUCTIONS,
    TEST_SYSTEM_INSTRUCTIONS,
    UNIT_TEST_SYSTEM_INSTRUCTIONS,
    CHECKING_INSTRUCTIONS,
    NAME_GENERATION_INSTRUCTIONS,
    AMEND_EXPLANATION_INSTRUCTIONS,
    NOTEBOOK_VERIFY_INSTRUCTIONS,
    TEST_VERIFY_INSTRUCTIONS,
    FOLD_SYSTEM_INSTRUCTIONS,
    add_tokens,
    build_context_prompt,
    build_unit_test_prompt,
    build_name_prompt,
    build_amend_explanation_prompt,
    build_fold_prompt,
    dump_ai_request,
    log_ai_request_size,
    parse_validation_response,
    parse_verify_response,
    strip_markdown_code_fences,
)

# Default to Sonnet: it supports adaptive thinking, so it self-scales thinking
# depth to cell complexity (trivial cells get ~none, hard cells get it) — which
# suits the mixed difficulty of code-generation tasks. Override with ANTHROPIC_MODEL.
CLAUDE_MODEL = os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-5")

USE_BEDROCK = os.environ.get("CLAUDE_CODE_USE_BEDROCK") == "1"


def _response_text(message):
    """Return the concatenated text of a Claude message.

    ``message.content`` is a list of typed blocks (TextBlock, ThinkingBlock,
    ToolUseBlock, ...). We can't assume ``content[0]`` is text: when thinking is
    enabled the first block is a ThinkingBlock, which has no ``.text``. Select
    the text blocks by type and join them."""
    return "".join(
        block.text for block in message.content if block.type == "text"
    )


def _create_without_thinking(client, **kwargs):
    """Issue a messages.create request with thinking turned off.

    Used for cell-name generation, a trivial summarization where thinking would
    only add latency and cost. The reasoning-heavy calls (code generation,
    validation, verification) deliberately use the model default instead, since
    thinking can improve their output. Not every model accepts an explicit
    ``{"type": "disabled"}`` (e.g. Fable 5 rejects it), so fall back to a plain
    request if the model refuses the parameter."""
    try:
        return client.messages.create(thinking={"type": "disabled"}, **kwargs)
    except anthropic.BadRequestError:
        return client.messages.create(**kwargs)


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

    system_instructions = SYSTEM_INSTRUCTIONS

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
        log_ai_request_size("claude generate_code", system_instructions, prompt,
                            preceding=preceding_code, instructions=instructions,
                            previous=previous_code, file_context=file_context,
                            error_context=error_context, variable_context=variable_context,
                            validation_context=validation_context)
    if dump_ai_requests:
        dump_ai_request(dump_ai_requests, "claude generate_code", {
            "model": model, "max_tokens": 4096,
            "system": system_instructions,
            "messages": [{"role": "user", "content": prompt}],
        })

    message = client.messages.create(
        model=model,
        max_tokens=4096,
        system=system_instructions,
        messages=[{"role": "user", "content": prompt}],
    )
    add_tokens(message.usage.input_tokens, message.usage.output_tokens)
    response_text = _response_text(message)
    if debug:
        print("Response:", response_text)
    code = strip_markdown_code_fences(response_text)
    return code


def claude_amend_explanation(
    api_key,
    explanation,
    error_context,
    previous_code,
    new_code,
    model=None,
    debug=False,
    dump_ai_requests=False):
    """Revise a cell's plain-language description so that regenerating code from it
    would avoid the error that was just fixed. Returns the amended description text.
    Uses the model default (thinking on where supported), since encoding a fix into
    the description is a reasoning task."""
    client = _get_client(api_key)
    model = model or CLAUDE_MODEL

    prompt = build_amend_explanation_prompt(
        explanation, error_context, previous_code, new_code)

    if debug:
        log_ai_request_size("claude amend_explanation", AMEND_EXPLANATION_INSTRUCTIONS, prompt)
    if dump_ai_requests:
        dump_ai_request(dump_ai_requests, "claude amend_explanation", {
            "model": model, "max_tokens": 1024,
            "system": AMEND_EXPLANATION_INSTRUCTIONS,
            "messages": [{"role": "user", "content": prompt}],
        })

    message = client.messages.create(
        model=model,
        max_tokens=1024,
        system=AMEND_EXPLANATION_INSTRUCTIONS,
        messages=[{"role": "user", "content": prompt}],
    )
    add_tokens(message.usage.input_tokens, message.usage.output_tokens)
    response_text = _response_text(message)
    if debug:
        print("Response to explanation amendment:", response_text)
    return response_text.strip()


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
        dump_ai_request(dump_ai_requests, "claude generate_test_code", {
            "model": model, "max_tokens": 4096,
            "system": TEST_SYSTEM_INSTRUCTIONS,
            "messages": [{"role": "user", "content": prompt}],
        })

    message = client.messages.create(
        model=model,
        max_tokens=4096,
        system=TEST_SYSTEM_INSTRUCTIONS,
        messages=[{"role": "user", "content": prompt}],
    )
    add_tokens(message.usage.input_tokens, message.usage.output_tokens)
    response_text = _response_text(message)
    if debug:
        print("Response:", response_text)
    code = strip_markdown_code_fences(response_text)
    return code


def claude_generate_unit_test_code(
    api_key,
    preceding_code=None,
    previous_code=None,
    instructions=None,
    file_context=None,
    error_context=None,
    variable_context=None,
    validation_context=None,
    setup_cell_context=None,
    target_cell_context=None,
    test_cell_context=None,
    variables_for_target_context=None,
    role=None,
    model=None,
    debug=False,
    dump_ai_requests=False):
    client = anthropic.Anthropic(api_key=api_key)
    model = model or CLAUDE_MODEL

    prompt = build_unit_test_prompt(
        preceding=preceding_code,
        previous=previous_code,
        instructions=instructions,
        file_context=file_context,
        error_context=error_context,
        variable_context=variable_context,
        validation_context=validation_context,
        setup_cell_context=setup_cell_context,
        target_cell_context=target_cell_context,
        test_cell_context=test_cell_context,
        variables_for_target_context=variables_for_target_context,
        role=role)

    if debug:
        log_ai_request_size("claude generate_unit_test", UNIT_TEST_SYSTEM_INSTRUCTIONS, prompt,
                            preceding=preceding_code, instructions=instructions,
                            previous=previous_code, file_context=file_context,
                            error_context=error_context, variable_context=variable_context,
                            validation_context=validation_context)
    if dump_ai_requests:
        dump_ai_request(dump_ai_requests, "claude generate_unit_test", {
            "model": model, "max_tokens": 4096,
            "system": UNIT_TEST_SYSTEM_INSTRUCTIONS,
            "messages": [{"role": "user", "content": prompt}],
        })

    message = client.messages.create(
        model=model,
        max_tokens=4096,
        system=UNIT_TEST_SYSTEM_INSTRUCTIONS,
        messages=[{"role": "user", "content": prompt}],
    )
    add_tokens(message.usage.input_tokens, message.usage.output_tokens)
    response_text = _response_text(message)
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
        dump_ai_request(dump_ai_requests, "claude validate_code", {
            "model": model, "max_tokens": 1024,
            "system": CHECKING_INSTRUCTIONS,
            "messages": [{"role": "user", "content": prompt}],
        })

    message = client.messages.create(
        model=model,
        max_tokens=1024,
        system=CHECKING_INSTRUCTIONS,
        messages=[{"role": "user", "content": prompt}],
    )
    add_tokens(message.usage.input_tokens, message.usage.output_tokens)
    response_text = _response_text(message)
    if debug:
        print("Response:", response_text)
    return parse_validation_response(response_text)


def _claude_verify(api_key, system_instructions, payload, label, model=None,
                   debug=False, dump_ai_requests=False):
    client = _get_client(api_key)
    model = model or CLAUDE_MODEL
    if debug:
        log_ai_request_size(f"claude {label}", system_instructions, payload)
    if dump_ai_requests:
        dump_ai_request(dump_ai_requests, f"claude {label}", {
            "model": model, "max_tokens": 2048,
            "system": system_instructions,
            "messages": [{"role": "user", "content": payload}],
        })
    message = client.messages.create(
        model=model,
        max_tokens=2048,
        system=system_instructions,
        messages=[{"role": "user", "content": payload}],
    )
    add_tokens(message.usage.input_tokens, message.usage.output_tokens)
    response_text = _response_text(message)
    if debug:
        print("Response:", response_text)
    return parse_verify_response(response_text)


def claude_verify_notebook(api_key, payload, model=None, debug=False, dump_ai_requests=False):
    return _claude_verify(api_key, NOTEBOOK_VERIFY_INSTRUCTIONS, payload,
                          "verify_notebook", model=model, debug=debug,
                          dump_ai_requests=dump_ai_requests)


def claude_verify_tests(api_key, payload, model=None, debug=False, dump_ai_requests=False):
    return _claude_verify(api_key, TEST_VERIFY_INSTRUCTIONS, payload,
                          "verify_tests", model=model, debug=debug,
                          dump_ai_requests=dump_ai_requests)


def claude_fold_additions(api_key, explanation=None, additions=None, model=None,
                          debug=False, dump_ai_requests=False):
    """Rewrites `explanation` to absorb `additions`. Returns the rewritten text."""
    client = _get_client(api_key)
    model = model or CLAUDE_MODEL

    system_instructions = FOLD_SYSTEM_INSTRUCTIONS

    prompt = build_fold_prompt(explanation or '', additions or [])
    if debug:
        log_ai_request_size("claude fold_additions", system_instructions, prompt,
                            instructions=explanation)
    if dump_ai_requests:
        dump_ai_request(dump_ai_requests, "claude fold_additions", {
            "model": model, "max_tokens": 2048,
            "system": system_instructions,
            "messages": [{"role": "user", "content": prompt}],
        })
    message = client.messages.create(
        model=model,
        max_tokens=2048,
        system=system_instructions,
        messages=[{"role": "user", "content": prompt}],
    )
    add_tokens(message.usage.input_tokens, message.usage.output_tokens)
    response_text = message.content[0].text
    if debug:
        print("Response to fold_additions:", response_text)
    return response_text.strip()


def claude_generate_cell_name(api_key, explanation, model=None, debug=False, dump_ai_requests=False):
    client = _get_client(api_key)
    model = model or CLAUDE_MODEL
    prompt = build_name_prompt(explanation)
    if debug:
        log_ai_request_size("claude generate_name", NAME_GENERATION_INSTRUCTIONS, prompt)
    if dump_ai_requests:
        dump_ai_request(dump_ai_requests, "claude generate_name", {
            "model": model, "max_tokens": 50,
            "system": NAME_GENERATION_INSTRUCTIONS,
            "messages": [{"role": "user", "content": prompt}],
        })
    message = _create_without_thinking(
        client,
        model=model,
        max_tokens=50,
        system=NAME_GENERATION_INSTRUCTIONS,
        messages=[{"role": "user", "content": prompt}],
    )
    add_tokens(message.usage.input_tokens, message.usage.output_tokens)
    response_text = _response_text(message)
    if debug:
        print("Response to name generation:", response_text)
    return response_text
