# General imports
import argparse
import asyncio
from functools import wraps
import json
from nbclient.exceptions import CellExecutionError
import os
from pathlib import Path
import secrets
import socket
import yaml
import sys
import webbrowser
# Bottle imports
from bottle import route, template, get, post, static_file, view, HTTPError
from bottle import run, default_app, request, TEMPLATE_PATH

# print(f"DEBUGGER PYTHON: {sys.executable}")

# Plainbook imports
from .plainbook import Plainbook, ExecutionError

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

try:
    with open(SETTINGS_FILE, 'r') as f:
        settings = yaml.safe_load(f)
except FileNotFoundError:
    settings = {}

# Parse command line arguments
parser = argparse.ArgumentParser(description='Run the plainbook notebook server')
parser.add_argument('notebook', nargs='?', 
                    default=os.path.join(TEST_INPUTS, 'sample_notebook.ipynb'),
                    help='Path to the notebook file to open')
parser.add_argument('--debug', action='store_true', default=False,
                    help='Enable debug mode')
parser.add_argument('--port', type=int, default=8080,
                    help='Port to run the server on')
args = parser.parse_args()

AUTH_TOKEN = "secret" if args.debug else secrets.token_hex(32)
                    
notebook_path = os.path.abspath(args.notebook)
    
notebook = Plainbook(notebook_path, debug=args.debug)
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

# Authentication decorator
def require_token(func):
    @wraps(func)
    def wrapper(*args, **kwargs):
        token = request.query.get('token')
        if token != AUTH_TOKEN:
            raise HTTPError(403, 'Invalid or missing token')
        return func(*args, **kwargs)
    return wrapper

# Main routes
@get('/')
@require_token
def index():
    return static_file('index.html', root=os.path.join(APP_FOLDER, 'views'))

@get('/get_notebook')
@require_token
def get_notebook():
    return dict(
        nb=notebook.get_json(),
        state=notebook.get_state(),
        gemini_api_key=settings.get('gemini_api_key'),
        debug=args.debug
    )

@post('/set_key')
@require_token
def set_key():
    data = request.json
    gemini_api_key = data.get('gemini_api_key', '')
    settings['gemini_api_key'] = gemini_api_key
    # Save settings to file
    try:
        with open(SETTINGS_FILE, 'w') as f:
            yaml.dump(settings, f)
        return dict(status='success')
    except Exception as e:
        return dict(status='error', message=str(e))
    
@post('/edit_explanation')
@require_token
def edit_explanation():
    data = request.json
    cell_index = data.get('cell_index')
    explanation = data.get('explanation')
    notebook.set_cell_explanation(cell_index, explanation)
    return dict(status='success', state=notebook.get_state())

@post('/edit_code')
@require_token
def edit_code():
    data = request.json
    cell_index = data.get('cell_index')
    source = data.get('source')
    notebook.set_cell_source(cell_index, source)
    return dict(status='success', state=notebook.get_state())

@post('/edit_markdown')
@require_token
def edit_markdown():
    data = request.json
    cell_index = data.get('cell_index')
    source = data.get('source')
    notebook.set_cell_source(cell_index, source)
    return dict(status='success', state=notebook.get_state())

@post('/insert_cell')
@require_token
def insert_cell():
    data = request.json
    cell_type = data.get('cell_type')
    index = data.get('index')
    new_cell, idx = notebook.insert_cell(index, cell_type)
    return dict(status='success', cell=new_cell, index=idx, state=notebook.get_state())

@post('/delete_cell')
@require_token
def delete_cell():
    data = request.json
    cell_index = data.get('cell_index')
    notebook.delete_cell(cell_index)
    return dict(status='success', state=notebook.get_state())

@post('/move_cell')
@require_token
def move_cell():
    data = request.json
    cell_index = data.get('cell_index')
    new_index = data.get('new_index')
    notebook.move_cell(cell_index, new_index)
    return dict(status='success', state=notebook.get_state())

@get('/state')
@require_token
def get_notebook_state():
    return dict(state=notebook.get_state())

@post('/execute_cell')
@require_token
def execute_cell():
    data = request.json
    cell_index = data.get('cell_index')
    print(f"Executing cell {cell_index}")
    try:
        outputs, details = notebook.execute_cell(cell_index)
        return dict(status="ok", details=details, outputs=outputs, state=notebook.get_state())
    except CellExecutionError as e:
        # The execution error is already captured in the cell outputs. 
        return dict(status="ok", details="CellExecutionError", 
                    state=notebook.get_state(),
                    outputs=notebook.nb.cells[cell_index].get('outputs', []))
    except ExecutionError as e:
        return dict(status='error', message=str(e))

@post('/reset_kernel')
@require_token
def reset_kernel():
    notebook.reset_kernel()
    return dict(status='success', state=notebook.get_state())

@post('/interrupt_kernel')
@require_token
def interrupt_kernel():
    try:
        notebook.interrupt_kernel()
        return dict(status='success', state=notebook.get_state())
    except Exception as e:
        return dict(status='error', message=str(e))
    
@post('/generate_code')
@require_token
def generate_code_cell():
    data = request.json
    cell_index = data.get('cell_index')
    gemini_api_key = settings.get('gemini_api_key')
    if not gemini_api_key:
        return dict(status='error', message='Gemini API key not set.')
    new_code, success = notebook.generate_code_cell(gemini_api_key, cell_index)
    if success:
        return dict(status='success', code=new_code, state=notebook.get_state())
    else:
        # The request was cancelled, we need to avoid updating the code.
        return dict(status='cancelled', code=None, state=notebook.get_state())
    
    
@post('/validate_code')
@require_token
def validate_code_cell():
    data = request.json
    cell_index = data.get('cell_index')
    gemini_api_key = settings.get('gemini_api_key')
    if not gemini_api_key:
        return dict(status='error', message='Gemini API key not set.')
    validation_result = notebook.validate_code_cell(gemini_api_key, cell_index)
    return dict(status='success', validation=validation_result, state=notebook.get_state())

@post('/set_validation_visibility')
@require_token
def set_validation_visibility():
    data = request.json
    cell_index = data.get('cell_index')
    is_hidden = data.get('is_hidden', False)
    notebook.set_validation_visibility(cell_index, is_hidden)
    return dict(status='success', state=notebook.get_state())
    
@post('/cancel_ai_request')
@require_token
def cancel_ai_request():
    try:
        notebook.cancel_ai_request()
        return dict(status='success', state=notebook.get_state())
    except Exception as e:
        return dict(status='error', message=str(e))
    
@post('/lock_notebook')
@require_token
def lock_notebook():
    data = request.json
    is_locked = data.get('is_locked', False)
    notebook.lock(is_locked)
    return dict(state=notebook.get_state())

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

@post('/debug_request')
@require_token
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
                s.bind(('127.0.0.1', port))
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
    port = find_free_port()
    url = f"http://127.0.0.1:{port}/?token={AUTH_TOKEN}"
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
        run(app=app_with_logging, host='127.0.0.1', port=port, 
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
    