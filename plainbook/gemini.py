from google import genai
from google.genai import types

from .ai_common import (
    SYSTEM_INSTRUCTIONS,
    TEST_SYSTEM_INSTRUCTIONS,
    UNIT_TEST_SYSTEM_INSTRUCTIONS,
    CHECKING_INSTRUCTIONS,
    NAME_GENERATION_INSTRUCTIONS,
    NOTEBOOK_VERIFY_INSTRUCTIONS,
    TEST_VERIFY_INSTRUCTIONS,
    add_tokens,
    build_context_prompt,
    build_unit_test_prompt,
    build_name_prompt,
    dump_ai_request,
    log_ai_request_size,
    parse_validation_response,
    parse_verify_response,
    strip_markdown_code_fences,
)


def get_gemini_models(api_key, families):
    """Fetches latest Gemini model IDs for the given families from the API.
    families: list of family keys like ["2.5-flash", "2.5-pro", "3-flash", "3-pro"]
    Returns a dict mapping family key to model ID.
    Prefers shorter model names (base aliases like "gemini-2.5-flash" over
    versioned names like "gemini-2.5-flash-001")."""
    client = genai.Client(api_key=api_key)
    result = {f: None for f in families}
    for model in client.models.list():
        model_id = model.name
        if model_id.startswith("models/"):
            model_id = model_id[len("models/"):]
        for family in families:
            prefix = f"gemini-{family}"
            if model_id.startswith(prefix):
                if result[family] is None or len(model_id) < len(result[family]):
                    result[family] = model_id
    return result


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
    debug=False,
    dump_ai_requests=False):
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
        log_ai_request_size("gemini generate_code", SYSTEM_INSTRUCTIONS, prompt,
                            preceding=preceding_code, instructions=instructions,
                            previous=previous_code, file_context=file_context,
                            error_context=error_context, variable_context=variable_context,
                            validation_context=validation_context)
    if dump_ai_requests:
        dump_ai_request(dump_ai_requests, "gemini generate_code", {
            "model": model,
            "contents": prompt,
            "system_instruction": SYSTEM_INSTRUCTIONS,
        })

    # 3. Generate content
    response = client.models.generate_content(
        model=model,
        contents=prompt,
        config=types.GenerateContentConfig(
            system_instruction=SYSTEM_INSTRUCTIONS
        )
    )
    if response.usage_metadata:
        add_tokens(response.usage_metadata.prompt_token_count, response.usage_metadata.candidates_token_count)
    if debug:
        print("Response:", response.text)
    # 4. Process the response
    code = strip_markdown_code_fences(response.text)
    return code


def gemini_generate_test_code(
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
    client = genai.Client(api_key=api_key)
    model = model or GEMINI_GENERATE_MODEL

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
        log_ai_request_size("gemini generate_test_code", TEST_SYSTEM_INSTRUCTIONS, prompt,
                            preceding=preceding_code, instructions=instructions,
                            previous=previous_code, file_context=file_context,
                            error_context=error_context, variable_context=variable_context,
                            validation_context=validation_context)
    if dump_ai_requests:
        dump_ai_request(dump_ai_requests, "gemini generate_test_code", {
            "model": model,
            "contents": prompt,
            "system_instruction": TEST_SYSTEM_INSTRUCTIONS,
        })

    response = client.models.generate_content(
        model=model,
        contents=prompt,
        config=types.GenerateContentConfig(
            system_instruction=TEST_SYSTEM_INSTRUCTIONS
        )
    )
    if response.usage_metadata:
        add_tokens(response.usage_metadata.prompt_token_count, response.usage_metadata.candidates_token_count)
    if debug:
        print("Response:", response.text)
    code = strip_markdown_code_fences(response.text)
    return code


def gemini_generate_unit_test_code(
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
    client = genai.Client(api_key=api_key)
    model = model or GEMINI_GENERATE_MODEL

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
        log_ai_request_size("gemini generate_unit_test", UNIT_TEST_SYSTEM_INSTRUCTIONS, prompt,
                            preceding=preceding_code, instructions=instructions,
                            previous=previous_code, file_context=file_context,
                            error_context=error_context, variable_context=variable_context,
                            validation_context=validation_context)
    if dump_ai_requests:
        dump_ai_request(dump_ai_requests, "gemini generate_unit_test", {
            "model": model,
            "contents": prompt,
            "system_instruction": UNIT_TEST_SYSTEM_INSTRUCTIONS,
        })

    response = client.models.generate_content(
        model=model,
        contents=prompt,
        config=types.GenerateContentConfig(
            system_instruction=UNIT_TEST_SYSTEM_INSTRUCTIONS
        )
    )
    if response.usage_metadata:
        add_tokens(response.usage_metadata.prompt_token_count, response.usage_metadata.candidates_token_count)
    if debug:
        print("Response:", response.text)
    code = strip_markdown_code_fences(response.text)
    return code


def gemini_validate_code(api_key, previous_code, code_to_validate, instructions, variable_context=None, model=None, debug=False, dump_ai_requests=False):
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
        log_ai_request_size("gemini validate_code", CHECKING_INSTRUCTIONS, prompt,
                            preceding=previous_code, instructions=instructions,
                            variable_context=variable_context)
    if dump_ai_requests:
        dump_ai_request(dump_ai_requests, "gemini validate_code", {
            "model": model,
            "contents": prompt,
            "system_instruction": CHECKING_INSTRUCTIONS,
        })

    response = client.models.generate_content(
        model=model,
        contents=prompt,
        config=types.GenerateContentConfig(
            system_instruction=CHECKING_INSTRUCTIONS
        )
    )
    if response.usage_metadata:
        add_tokens(response.usage_metadata.prompt_token_count, response.usage_metadata.candidates_token_count)
    if debug:
        print("Response:", response.text)
    return parse_validation_response(response.text)


def _gemini_verify(api_key, system_instructions, payload, label, model=None,
                   debug=False, dump_ai_requests=False):
    client = genai.Client(api_key=api_key)
    model = model or GEMINI_VALIDATE_MODEL
    if debug:
        log_ai_request_size(f"gemini {label}", system_instructions, payload)
    if dump_ai_requests:
        dump_ai_request(dump_ai_requests, f"gemini {label}", {
            "model": model,
            "contents": payload,
            "system_instruction": system_instructions,
        })
    response = client.models.generate_content(
        model=model,
        contents=payload,
        config=types.GenerateContentConfig(
            system_instruction=system_instructions
        )
    )
    if response.usage_metadata:
        add_tokens(response.usage_metadata.prompt_token_count, response.usage_metadata.candidates_token_count)
    if debug:
        print("Response:", response.text)
    return parse_verify_response(response.text)


def gemini_verify_notebook(api_key, payload, model=None, debug=False, dump_ai_requests=False):
    return _gemini_verify(api_key, NOTEBOOK_VERIFY_INSTRUCTIONS, payload,
                          "verify_notebook", model=model, debug=debug,
                          dump_ai_requests=dump_ai_requests)


def gemini_verify_tests(api_key, payload, model=None, debug=False, dump_ai_requests=False):
    return _gemini_verify(api_key, TEST_VERIFY_INSTRUCTIONS, payload,
                          "verify_tests", model=model, debug=debug,
                          dump_ai_requests=dump_ai_requests)


def gemini_generate_cell_name(api_key, explanation, model=None, debug=False, dump_ai_requests=False):
    client = genai.Client(api_key=api_key)
    model = model or GEMINI_GENERATE_MODEL
    prompt = build_name_prompt(explanation)
    if debug:
        log_ai_request_size("gemini generate_name", NAME_GENERATION_INSTRUCTIONS, prompt)
    if dump_ai_requests:
        dump_ai_request(dump_ai_requests, "gemini generate_name", {
            "model": model,
            "contents": prompt,
            "system_instruction": NAME_GENERATION_INSTRUCTIONS,
            "max_output_tokens": 50,
        })
    response = client.models.generate_content(
        model=model,
        contents=prompt,
        config=types.GenerateContentConfig(
            system_instruction=NAME_GENERATION_INSTRUCTIONS,
            max_output_tokens=50,
        ),
    )
    if response.usage_metadata:
        add_tokens(response.usage_metadata.prompt_token_count, response.usage_metadata.candidates_token_count)
    if debug:
        print("Response to name generation:", response.text)
    return response.text
