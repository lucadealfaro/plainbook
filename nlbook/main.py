# General imports
import argparse
from functools import wraps
import json
import os
from pathlib import Path
import secrets
import socket
import sys
import webbrowser
# Bottle imports
from bottle import route, template, get, post, static_file, view, HTTPError
from bottle import run, default_app, request, TEMPLATE_PATH

import sys
print(f"DEBUGGER PYTHON: {sys.executable}")

# NLBook imports
from .nlbook import LNBook, ExecutionError

APP_FOLDER = os.path.dirname(__file__)
TEMPLATE_PATH.insert(0, os.path.join(APP_FOLDER, 'views'))
app_path = Path(APP_FOLDER)
PARENT_FOLDER = app_path.parent
print(f"DEBUGGER PARENT FOLDER: {PARENT_FOLDER}")
TEST_INPUTS = os.path.join(PARENT_FOLDER, "tests/files")

# Parse command line arguments
parser = argparse.ArgumentParser(description='Run the nlbook notebook server')
parser.add_argument('notebook', nargs='?', 
                    default=os.path.join(TEST_INPUTS, 'sample_notebook.ipynb'),
                    help='Path to the notebook file to open')
parser.add_argument('--debug', action='store_true', default=False,
                    help='Enable debug mode')
args = parser.parse_args()

AUTH_TOKEN = "secret" if args.debug else secrets.token_hex(32)
                    
notebook_path = os.path.abspath(args.notebook)
if args.debug:
    notebook_path = os.path.join(TEST_INPUTS, 'sample_notebook.ipynb')
    
notebook = LNBook(notebook_path)
                    
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
    )
    
@post('/edit_explanation')
@require_token
def edit_explanation():
    data = request.json
    cell_index = data.get('cell_index')
    explanation = data.get('explanation')
    # Here you would typically save the explanation to a database or file
    # For this example, we just log it
    print(f"Updated explanation for cell {cell_index}: {explanation}")
    return dict(status='success')

@post('/edit_code')
@require_token
def edit_code():
    data = request.json
    cell_index = data.get('cell_index')
    source = data.get('source')
    # Here you would typically save the code to a database or file
    # For this example, we just log it
    print(f"Updated code for cell {cell_index}: {source}")
    return dict(status='success')

@get('/last_valid_cell')
@require_token
def last_valid_cell():
    last_valid = notebook.last_executed_cell
    return dict(last_valid_cell=last_valid)

@post('/execute_cell')
@require_token
def execute_cell():
    data = request.json
    cell_index = data.get('cell_index')
    print(f"Executing cell {cell_index}")
    try:
        outputs, details = notebook.execute_cell(cell_index)
        return dict(status="ok", details=details, outputs=outputs)
    except ExecutionError as e:
        return dict(status='error', message=str(e))

@post('/interrupt_kernel')
@require_token
def interrupt_kernel():
    try:
        notebook.interrupt_kernel()
        return dict(status='success')
    except Exception as e:
        return dict(status='error', message=str(e))


################################
# Server startup

def find_free_port(start_port):
    port = start_port
    while True:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            if s.connect_ex(('localhost', port)) != 0:
                return port
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
    port = find_free_port(8080)
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
    run(app=app_with_logging, host='localhost', port=port, server='waitress', 
        threads=16, debug=args.debug)

if __name__ == '__main__': 
    main()
    