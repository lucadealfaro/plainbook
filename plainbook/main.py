# General imports
import argparse
import asyncio
import datetime
from functools import wraps
import json
from .plainbook import CellExecutionError
import os
from pathlib import Path
import secrets
import socket
import yaml
import sys
import webbrowser
# Bottle imports
from bottle import route, template, get, post, static_file, view, HTTPError
from bottle import run, default_app, request, response, redirect, TEMPLATE_PATH

# print(f"DEBUGGER PYTHON: {sys.executable}")

# Plainbook imports
from .plainbook import ExecutionError
from .claude import get_claude_models
from .gemini import get_gemini_models

APP_FOLDER = os.path.dirname(__file__)
TEMPLATE_PATH.insert(0, os.path.join(APP_FOLDER, 'views'))

app_path = Path(APP_FOLDER)
PARENT_FOLDER = app_path.parent
TEST_INPUTS = os.path.join(PARENT_FOLDER, "tests/files")
ROOT_DIR = os.path.abspath(os.sep)

# Configuration file, the 'Good Citizen' way
APP_NAME = "plainbook"
CONFIG_DIR = Path.home() / ".config" / APP_NAME
CONFIG_DIR.mkdir(parents=True, exist_ok=True)
SETTINGS_FILE = CONFIG_DIR / "settings.yaml"
INVALID_TOKEN_MESSAGE = '<p class="has-text-danger has-text-centered mb-4">Invalid token. Please try again.</p>'

# Parse command line arguments
parser = argparse.ArgumentParser(description='Run the plainbook notebook server')
parser.add_argument('notebook',
                    help='Path to the notebook file to open')
parser.add_argument('--debug', action='store_true', default=False,
                    help='Enable debug mode')
parser.add_argument('--dump-ai-requests', action='store_true', default=False,
                    help='Dump the full text of AI requests to stdout')
parser.add_argument('--port', type=int, default=8080,
                    help='Port to run the server on')
parser.add_argument('--host', type=str,
                    default='0.0.0.0' if os.environ.get('CODESPACES') else '127.0.0.1',
                    help='Host to bind the server to (default: 0.0.0.0 in Codespaces, 127.0.0.1 otherwise)')
args = parser.parse_args()

try:
    with open(SETTINGS_FILE, 'r') as f:
        settings = yaml.safe_load(f)
except FileNotFoundError:
    settings = {}

# _saved_settings tracks what was loaded from (and should be written to) the file.
# Environment-variable keys are applied only to the in-memory settings dict so
# they are never persisted to disk.
_saved_settings = dict(settings)

# Fill in missing API keys from environment variables (e.g. Codespaces secrets)
for env_var, setting_key in [('CLAUDE_API_KEY', 'claude_api_key'), ('GEMINI_API_KEY', 'gemini_api_key')]:
    if not settings.get(setting_key) and os.environ.get(env_var):
        settings[setting_key] = os.environ[env_var]

AI_PROVIDER_REGISTRY = [
    {"id": "gemini:2.5-flash", "name": "Gemini 2.5 Flash", "major": "gemini", "key_setting": "gemini_api_key", "model": "gemini-2.5-flash"},
    {"id": "gemini:2.5-pro",   "name": "Gemini 2.5 Pro",   "major": "gemini", "key_setting": "gemini_api_key", "model": "gemini-2.5-pro"},
    {"id": "gemini:3-flash",   "name": "Gemini 3 Flash",   "major": "gemini", "key_setting": "gemini_api_key", "model": "gemini-3-flash-preview"},
    {"id": "gemini:3-pro",     "name": "Gemini 3 Pro",     "major": "gemini", "key_setting": "gemini_api_key", "model": "gemini-3-pro-preview"},
    {"id": "claude:haiku",     "name": "Claude Haiku",      "major": "claude", "key_setting": "claude_api_key", "model": "claude-haiku-4-5-20251001"},
    {"id": "claude:sonnet",    "name": "Claude Sonnet",     "major": "claude", "key_setting": "claude_api_key", "model": "claude-sonnet-4-5-20250929"},
    {"id": "claude:opus",      "name": "Claude Opus",       "major": "claude", "key_setting": "claude_api_key", "model": "claude-opus-4-20250514"},
]

def _update_claude_models():
    """Fetch latest Claude model IDs from the API and update the registry.
    On success, saves the model IDs to settings. On failure, falls back
    to previously saved model IDs."""
    api_key = settings.get('claude_api_key')
    if not api_key:
        return
    latest = None
    try:
        latest = get_claude_models(api_key)
        # Save to settings for offline fallback
        settings['claude_models'] = latest
        with open(SETTINGS_FILE, 'w') as f:
            yaml.dump(settings, f)
        if args.debug:
            print(f"Updated Claude models: { {k: v for k, v in latest.items() if v} }")
    except Exception as e:
        print(f"Warning: could not fetch Claude models: {e}")
        # Fall back to previously saved models
        latest = settings.get('claude_models')
        if latest and args.debug:
            print(f"Using cached Claude models: { {k: v for k, v in latest.items() if v} }")
    if latest:
        for provider in AI_PROVIDER_REGISTRY:
            if provider['major'] != 'claude':
                continue
            family = provider['id'].split(':')[1]  # "haiku", "sonnet", or "opus"
            if latest.get(family):
                provider['model'] = latest[family]

_update_claude_models()


def _update_gemini_models():
    """Fetch latest Gemini model IDs from the API and update the registry.
    On success, saves the model IDs to settings. On failure, falls back
    to previously saved model IDs."""
    api_key = settings.get('gemini_api_key')
    if not api_key:
        return
    # Derive families from registry (e.g. "gemini:2.5-flash" -> "2.5-flash")
    families = [p['id'].split(':')[1] for p in AI_PROVIDER_REGISTRY if p['major'] == 'gemini']
    latest = None
    try:
        latest = get_gemini_models(api_key, families)
        settings['gemini_models'] = latest
        with open(SETTINGS_FILE, 'w') as f:
            yaml.dump(settings, f)
        if args.debug:
            print(f"Updated Gemini models: { {k: v for k, v in latest.items() if v} }")
    except Exception as e:
        print(f"Warning: could not fetch Gemini models: {e}")
        latest = settings.get('gemini_models')
        if latest and args.debug:
            print(f"Using cached Gemini models: { {k: v for k, v in latest.items() if v} }")
    if latest:
        for provider in AI_PROVIDER_REGISTRY:
            if provider['major'] != 'gemini':
                continue
            family = provider['id'].split(':')[1]
            if latest.get(family):
                provider['model'] = latest[family]

_update_gemini_models()


def _ensure_active_ai_provider():
    """Validate active_ai_provider setting; auto-select first available if invalid."""
    current = settings.get('active_ai_provider')
    for p in AI_PROVIDER_REGISTRY:
        if p['id'] == current and settings.get(p['key_setting']):
            return current
    # Current is invalid or missing — pick first provider with a key
    for p in AI_PROVIDER_REGISTRY:
        if settings.get(p['key_setting']):
            settings['active_ai_provider'] = p['id']
            return p['id']
    settings['active_ai_provider'] = None
    return None

_ensure_active_ai_provider()

def _get_or_create_debug_token():
    """Return a stable debug token from settings, creating one if absent or stale (>24h)."""
    token_info = settings.get('debug_token')
    if token_info:
        created = token_info.get('created')
        token = token_info.get('token')
        if token and created:
            age = datetime.datetime.now() - created
            if age.total_seconds() < 86400:
                return token
    # Create a new debug token.
    token = secrets.token_hex(32)
    settings['debug_token'] = {
        'token': token,
        'created': datetime.datetime.now(),
    }
    with open(SETTINGS_FILE, 'w') as f:
        yaml.dump(settings, f)
    return token

AUTH_TOKEN = _get_or_create_debug_token() if args.debug else secrets.token_hex(32)
                    
notebook_path = os.path.abspath(args.notebook)

from .plainbook import Plainbook
notebook = Plainbook(notebook_path, debug=args.debug, dump_ai_requests=args.dump_ai_requests)
assert notebook.kc is not None
assert notebook.km.is_alive()
                    
# Static file routes 
@route('/js/<filepath:path>')
def server_static_js(filepath):
    return static_file(filepath, root=os.path.join(APP_FOLDER, 'js'))

@route('/css/<filepath:path>')
def server_static_css(filepath):
    return static_file(filepath, root=os.path.join(APP_FOLDER, 'css'))

@route('/fonts/<filepath:path>')
def server_static_fonts(filepath):
    return static_file(filepath, root=os.path.join(APP_FOLDER, 'fonts'))

@route('/images/<filepath:path>')
def server_static_images(filepath):
    return static_file(filepath, root=os.path.join(APP_FOLDER, 'images'))

# Authentication decorator
def require_token(func):
    @wraps(func)
    def wrapper(*args, **kwargs):
        token = request.query.get('token')
        if token != AUTH_TOKEN:
            raise HTTPError(403, 'Invalid or missing token')
        return func(*args, **kwargs)
    return wrapper

# Stateful decorator
def stateful(func):
    @wraps(func)
    def wrapper(*args, **kwargs):
        r = func(*args, **kwargs)
        s = notebook.get_state()
        r['state'] = s
        return r
    return wrapper

# Main routes
@get('/')
def index():
    token = request.query.get('token')
    if token == AUTH_TOKEN:
        return static_file('index.html', root=os.path.join(APP_FOLDER, 'views'))
    if os.environ.get('CODESPACES'):
        redirect('/?token=' + AUTH_TOKEN)
    return template('login', error_message='')

@post('/login')
def login():
    token = request.forms.get('token', '').strip()
    if token == AUTH_TOKEN:
        redirect('/?token=' + AUTH_TOKEN)
    return template('login', error_message=INVALID_TOKEN_MESSAGE)

@get('/get_notebook')
@stateful
@require_token
def get_notebook():
    _in_codespace = bool(os.environ.get('CODESPACES'))
    return dict(
        nb=notebook.get_json(),
        has_gemini_key=bool(settings.get('gemini_api_key')),
        has_claude_key=bool(settings.get('claude_api_key')),
        debug=args.debug,
        active_ai_provider=settings.get('active_ai_provider'),
        ai_providers=AI_PROVIDER_REGISTRY,
        is_codespace=_in_codespace,
    )

@post('/set_key')
@require_token
def set_key():
    data = request.json
    gemini_api_key = data.get('gemini_api_key', '')
    claude_api_key = data.get('claude_api_key', '')
    # Protocol: null = explicitly remove, '' = unchanged, non-empty = set new key.
    if gemini_api_key is None:
        gemini_api_key = ''
    elif gemini_api_key == '':
        gemini_api_key = _saved_settings.get('gemini_api_key', '')
    if claude_api_key is None:
        claude_api_key = ''
    elif claude_api_key == '':
        claude_api_key = _saved_settings.get('claude_api_key', '')
    # Save only user-provided keys to the file (never env-var keys)
    _saved_settings['gemini_api_key'] = gemini_api_key
    _saved_settings['claude_api_key'] = claude_api_key
    settings['gemini_api_key'] = gemini_api_key
    settings['claude_api_key'] = claude_api_key
    try:
        with open(SETTINGS_FILE, 'w') as f:
            yaml.dump(dict(_saved_settings), f)
    except Exception as e:
        return dict(status='error', message=str(e))
    # After saving, apply env-var fallbacks to in-memory settings only
    if os.environ.get('CODESPACES'):
        if not settings['gemini_api_key'] and os.environ.get('GEMINI_API_KEY'):
            settings['gemini_api_key'] = os.environ['GEMINI_API_KEY']
        if not settings['claude_api_key'] and os.environ.get('CLAUDE_API_KEY'):
            settings['claude_api_key'] = os.environ['CLAUDE_API_KEY']
    active = _ensure_active_ai_provider()
    return dict(
        status='success',
        active_ai_provider=active,
        has_gemini_key=bool(settings.get('gemini_api_key')),
        has_claude_key=bool(settings.get('claude_api_key')),
    )

@post('/set_active_ai')
@require_token
def set_active_ai():
    data = request.json
    provider_id = data.get('provider')
    valid_ids = [p['id'] for p in AI_PROVIDER_REGISTRY]
    if provider_id not in valid_ids:
        return dict(status='error', message=f'Unknown provider: {provider_id}')
    for p in AI_PROVIDER_REGISTRY:
        if p['id'] == provider_id:
            if not settings.get(p['key_setting']):
                return dict(status='error', message=f'No API key set for {p["name"]}')
            break
    settings['active_ai_provider'] = provider_id
    with open(SETTINGS_FILE, 'w') as f:
        yaml.dump(settings, f)
    return dict(status='success', active_ai_provider=provider_id)

@post('/edit_explanation')
@stateful
@require_token
def edit_explanation():
    data = request.json
    cell_index = data.get('cell_index')
    explanation = data.get('explanation')
    notebook.set_cell_explanation(cell_index, explanation)
    # Auto-generate cell name if not yet set
    cell = notebook.nb.cells[cell_index]
    cell_name = cell.metadata.get('name') if cell.cell_type == 'code' else None
    if cell.cell_type == 'code' and not cell_name:
        api_key, ai_provider, model, error = _get_ai_config()
        if not error:
            try:
                cell_name = notebook.generate_cell_name(
                    api_key, cell_index, ai_provider=ai_provider, model=model)
            except Exception as e:
                print(f"Warning: failed to generate cell name: {e}")
    return dict(status='success', cell_name=cell_name)

@post('/edit_code')
@stateful
@require_token
def edit_code():
    data = request.json
    cell_index = data.get('cell_index')
    source = data.get('source')
    notebook.set_cell_source(cell_index, source)
    return dict(status='success')

@post('/clear_code')
@stateful
@require_token
def clear_code():
    data = request.json
    cell_index = data.get('cell_index')
    notebook.clear_cell_code(cell_index)
    return dict(status='success')

@post('/edit_markdown')
@stateful
@require_token
def edit_markdown():
    data = request.json
    cell_index = data.get('cell_index')
    source = data.get('source')
    notebook.set_cell_source(cell_index, source)
    return dict(status='success')

@post('/insert_cell')
@stateful
@require_token
def insert_cell():
    data = request.json
    cell_type = data.get('cell_type')
    index = data.get('index')
    new_cell, idx = notebook.insert_cell(index, cell_type)
    return dict(status='success', cell=new_cell, index=idx)

@post('/delete_cell')
@stateful
@require_token
def delete_cell():
    data = request.json
    cell_index = data.get('cell_index')
    notebook.delete_cell(cell_index)
    return dict(status='success')

@post('/move_cell')
@stateful
@require_token
def move_cell():
    data = request.json
    cell_index = data.get('cell_index')
    new_index = data.get('new_index')
    notebook.move_cell(cell_index, new_index)
    return dict(status='success')


@get('/state')
@stateful
@require_token
def get_notebook_state():
    return {}

@post('/execute_cell')
@stateful
@require_token
def execute_cell():
    data = request.json
    cell_index = data.get('cell_index')
    if args.debug:
        print(f"Executing cell {cell_index}")
    try:
        outputs, details = notebook.execute_cell(cell_index)
        return dict(status="ok", details=details, outputs=outputs)
    except CellExecutionError as e:
        # The execution error is already captured in the cell outputs. 
        return dict(status="ok", details="CellExecutionError", 
                    outputs=notebook.nb.cells[cell_index].get('outputs', []))
    except ExecutionError as e:
        return dict(status='error', message=str(e))

@post('/reset_kernel')
@stateful
@require_token
def reset_kernel():
    notebook.reset_kernel()
    return dict(status='success')

@post('/interrupt_kernel')
@stateful
@require_token
def interrupt_kernel():
    try:
        notebook.interrupt_kernel()
        return dict(status='success')
    except Exception as e:
        return dict(status='error', message=str(e))
    
    
def _get_ai_config():
    """Resolve AI provider, model, and API key from server-side active provider setting."""
    ai_provider = settings.get('active_ai_provider')
    if not ai_provider:
        return None, None, None, 'No AI provider is active. Please set an API key in Settings.'
    for p in AI_PROVIDER_REGISTRY:
        if p['id'] == ai_provider:
            api_key = settings.get(p['key_setting'])
            if not api_key:
                return None, None, None, f'{p["name"]} API key not set.'
            return api_key, p['major'], p['model'], None
    return None, None, None, f'Unknown AI provider: {ai_provider}'

_BILLING_KEYWORDS = ['credit balance', 'billing', 'quota', 'rate limit', 'resource exhausted', 'exceeded your current']

def _check_billing_error(e):
    """If e looks like an AI billing/rate-limit error, return a friendly message; else None."""
    msg = str(e).lower()
    if any(kw in msg for kw in _BILLING_KEYWORDS):
        return ('AI usage limit reached. Please check your AI provider billing '
                'and increase your usage limits.')
    return None

@post('/generate_code')
@stateful
@require_token
def generate_code_cell():
    data = request.json
    cell_index = data.get('cell_index')
    validation_feedback = data.get('validation_feedback')
    api_key, ai_provider, model, error = _get_ai_config()
    if error:
        return dict(status='error', message=error)
    try:
        new_code, success = notebook.generate_code_cell(
            api_key, cell_index, ai_provider=ai_provider,
            model=model, validation_feedback=validation_feedback)
    except Exception as e:
        friendly = _check_billing_error(e)
        if friendly:
            return dict(status='error', message=friendly)
        raise
    if success:
        return dict(status='success', code=new_code)
    else:
        # The request was cancelled, we need to avoid updating the code.
        return dict(status='cancelled', code=None)


@post('/generate_test_code')
@stateful
@require_token
def generate_test_code():
    data = request.json
    cell_index = data.get('cell_index')
    validation_feedback = data.get('validation_feedback')
    api_key, ai_provider, model, error = _get_ai_config()
    if error:
        return dict(status='error', message=error)
    try:
        new_code, success = notebook.generate_test_code(
            api_key, cell_index, ai_provider=ai_provider,
            model=model, validation_feedback=validation_feedback)
    except Exception as e:
        friendly = _check_billing_error(e)
        if friendly:
            return dict(status='error', message=friendly)
        raise
    if success:
        return dict(status='success', code=new_code)
    else:
        return dict(status='cancelled', code=None)


@post('/execute_test_cell')
@stateful
@require_token
def execute_test_cell():
    data = request.json
    cell_index = data.get('cell_index')
    try:
        outputs = notebook.execute_test_cell(cell_index)
        return dict(status='ok', outputs=outputs)
    except NotImplementedError as e:
        return dict(status='error', message=str(e))
    except Exception as e:
        return dict(status='error', message=str(e))


@post('/validate_code')
@stateful
@require_token
def validate_code_cell():
    data = request.json
    cell_index = data.get('cell_index')
    api_key, ai_provider, model, error = _get_ai_config()
    if error:
        return dict(status='error', message=error)
    try:
        validation_result = notebook.validate_code_cell(api_key, cell_index, ai_provider=ai_provider, model=model)
    except Exception as e:
        friendly = _check_billing_error(e)
        if friendly:
            return dict(status='error', message=friendly)
        raise
    if validation_result is None:
        return dict(status='cancelled')
    return dict(status='success', validation=validation_result)


@post('/set_validation_visibility')
@stateful
@require_token
def set_validation_visibility():
    data = request.json
    cell_index = data.get('cell_index')
    is_hidden = data.get('is_hidden', False)
    notebook.set_validation_visibility(cell_index, is_hidden)
    return dict(status='success')
    
    
@post('/cancel_ai_request')
@stateful
@require_token
def cancel_ai_request():
    try:
        notebook.cancel_ai_request()
        return dict(status='success')
    except Exception as e:
        return dict(status='error', message=str(e))
    
    
@post('/clear_outputs')
@stateful
@require_token
def clear_outputs():
    notebook.clear_outputs()
    return dict(status='success')


@post('/lock_notebook')
@stateful
@require_token
def lock_notebook():
    data = request.json
    is_locked = data.get('is_locked', False)
    notebook.lock(is_locked)
    return {}


@post('/set_share_output')
@stateful
@require_token
def set_share_output():
    data = request.json
    share = data.get('share', True)
    notebook.set_share_output_with_ai(share)
    return {}


@get('/current_dir')
@require_token
def get_current_dir():
    """Returns the absolute path of the working directory where plainbook was launched."""
    return {"path": str(Path.cwd())}

@get('/home_dir')
@require_token
def get_home_dir():
    """Returns the absolute path of the current user's home directory."""
    return {"path": str(Path.home())}

@post('/file_list')
@require_token
def file_list():
    # 1. Get the path from the request body
    data = request.json
    requested_path = data.get('path', ROOT_DIR)    
    abs_path = os.path.abspath(requested_path)
    if not os.path.exists(abs_path):
        raise HTTPError(404, 'Path does not exist')
    if not os.path.isdir(abs_path):
        raise HTTPError(400, 'Path is not a directory')
    try:
        results = []
        for entry in os.scandir(abs_path):
            if not entry.name.startswith('.'):  # Skip hidden files
                # We gather name, full path, and determine if it's a file or dir
                results.append({
                    "name": entry.name,
                    "path": entry.path,
                    "type": "directory" if entry.is_dir() else "file"
                })
        # Sort: Directories first, then files alphabetically
        results.sort(key=lambda x: (x['type'] != 'directory', x['name'].lower()))
        return {"files": results} # Returning a list wrapped in a dict is a best practice

    except PermissionError:
        raise HTTPError(403, 'Permission denied')
    
    
@post('/set_files')
@require_token
def set_files():
    data = request.json
    files = data.get('files', [])
    missing_files = data.get('missing_files', [])
    notebook.set_input_files(files, missing_files)
    return dict(status='success', state=notebook.get_state())


@get('/get_files')
@require_token
def get_files():
    d = notebook.get_input_files()
    return dict(files=d['input_files'], missing_files=d['missing_input_files'])


@post('/set_ai_instructions')
@require_token
def set_ai_instructions():
    data = request.json
    instructions = data.get('ai_instructions', '')
    notebook.set_ai_instructions(instructions)
    return dict(status='success')


@get('/get_ai_instructions')
@require_token
def get_ai_instructions():
    return dict(ai_instructions=notebook.get_ai_instructions())


## Unit test stub endpoints

@post('/save_unit_tests')
@stateful
@require_token
def save_unit_tests():
    data = request.json
    cell_index = data.get('cell_index')
    unit_tests = data.get('unit_tests', {})
    notebook.save_unit_tests(cell_index, unit_tests)
    return dict(status='success')

@post('/save_unit_test_explanation')
@stateful
@require_token
def save_unit_test_explanation():
    data = request.json
    cell_index = data.get('cell_index')
    test_name = data.get('test_name')
    role = data.get('role')
    explanation = data.get('explanation')
    notebook.save_unit_test_explanation(cell_index, test_name, role, explanation)
    return dict(status='success')

@post('/save_unit_test_code')
@stateful
@require_token
def save_unit_test_code():
    data = request.json
    cell_index = data.get('cell_index')
    test_name = data.get('test_name')
    role = data.get('role')
    source = data.get('source')
    notebook.save_unit_test_code(cell_index, test_name, role, source)
    return dict(status='success')

@post('/clear_unit_test_code')
@stateful
@require_token
def clear_unit_test_code():
    data = request.json
    cell_index = data.get('cell_index')
    test_name = data.get('test_name')
    role = data.get('role')
    notebook.clear_unit_test_code(cell_index, test_name, role)
    return dict(status='success')

@post('/get_unit_test_state')
@require_token
def get_unit_test_state():
    data = request.json
    cell_index = data.get('cell_index')
    try:
        state = notebook.get_unit_test_state(cell_index)
        return dict(status='success', unit_test_state=state)
    except Exception as e:
        return dict(status='error', message=str(e))

@post('/run_unit_test_cell')
@stateful
@require_token
def run_unit_test_cell():
    data = request.json
    cell_index = data.get('cell_index')
    test_name = data.get('test_name')
    role = data.get('role')
    try:
        outputs = notebook.execute_unit_test_cell(cell_index, test_name, role)
        return dict(status='ok', outputs=outputs, role=role)
    except CellExecutionError:
        cell = notebook.nb.cells[cell_index]
        test = cell.metadata.get('unit_tests', {})[test_name]
        if role == 'setup':
            outs = test['setup'].get('outputs', [])
        elif role == 'target':
            outs = test.get('target', {}).get('outputs', [])
        else:
            outs = test['test'].get('outputs', [])
        return dict(status='ok', details='CellExecutionError', outputs=outs, role=role)
    except Exception as e:
        return dict(status='error', message=str(e))

@post('/generate_unit_test_cell_code')
@stateful
@require_token
def generate_unit_test_code():
    data = request.json
    cell_index = data.get('cell_index')
    test_name = data.get('test_name')
    role = data.get('role')
    validation_feedback = data.get('validation_feedback')
    api_key, ai_provider, model, error = _get_ai_config()
    if error:
        return dict(status='error', message=error)
    try:
        new_code, success = notebook.generate_unit_test_cell(
            api_key, cell_index, test_name, role,
            ai_provider=ai_provider, model=model,
            validation_feedback=validation_feedback)
    except Exception as e:
        friendly = _check_billing_error(e)
        if friendly:
            return dict(status='error', message=friendly)
        raise
    if success:
        return dict(status='success', code=new_code)
    else:
        return dict(status='cancelled', code=None)


@post('/debug_request')
@require_token
@stateful
def debug_request():
    try:
        data = request.json
        nb = data.get('notebook', None)
        if nb is not None:
            notebook.debug_request(nb)
        return dict(status='success')
    except Exception as e:
        return dict(status='error', message=str(e))


################################
# Server startup

def find_free_port():
    port = args.port
    while True:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            try:
                s.bind((args.host, port))
                return port
            except OSError:
                port += 2
            
def logger_middleware(app):
    def wrapper(environ, start_response):
        # This function catches the status code before it's sent to the browser
        def logging_start_response(status, headers, exc_info=None):
            print(f"{environ['REQUEST_METHOD']} {environ['PATH_INFO']} - {status}")
            return start_response(status, headers, exc_info)
        
        return app(environ, logging_start_response)
    return wrapper
    
    
def main():
    from . import __version__
    print(f"Plainbook {__version__}")
    port = find_free_port()
    url = f"http://127.0.0.1:{port}/?token={AUTH_TOKEN}"
    print(f"Authentication token: {AUTH_TOKEN}")
    if args.debug:
        print(f"Please load this URL: {url}")
    else:
        try:
            webbrowser.open(url)
        except Exception:
            print(f"If the browser does not open, please load this URL: {url}")
    app_with_logging = logger_middleware(default_app()) if args.debug else default_app()
    # Do not use reloader=True.
    try:
        run(app=app_with_logging, host=args.host, port=port,
            server='cheroot', numthreads=10, 
            debug=args.debug)
    except KeyboardInterrupt:
            print("\nStopping server...")
    finally:
        try:
            loop = asyncio.get_event_loop()
            if loop.is_running():
                loop.stop()
            if not loop.is_closed():
                loop.close()
        except:
            pass

if __name__ == '__main__': 
    main()
    