#!/usr/bin/env python3

from bottle import route, template, request, get, post, static_file, view, run
import json
import os
import socket
import webbrowser
import sys

APP_FOLDER = os.path.dirname(__file__)
TEST_INPUTS = os.path.join(APP_FOLDER, "tests/files")

# Parse command line arguments
notebook_path = None
notebook_name = "Sample Notebook"

if len(sys.argv) > 1:
    notebook_path = os.path.abspath(sys.argv[1])
    notebook_name = os.path.splitext(os.path.basename(notebook_path))[0]

# Static file routes 
@route('/js/<filepath:path>')
def server_static_js(filepath):
    return static_file(filepath, root=os.path.join(APP_FOLDER, 'js'))

@route('/css/<filepath:path>')
def server_static_css(filepath):
    return static_file(filepath, root=os.path.join(APP_FOLDER, 'css'))

# Main routes
@route('/')
@view('index.html')
def index():
    return dict(notebook_name=notebook_name)

@get('/get_notebook')
def get_notebook():
    with open(notebook_path or os.path.join(TEST_INPUTS, "sample_notebook.ipynb")) as f:
        notebook = json.load(f)
    # Adds to each code cell a markdown component that explains the cell's code. 
    for cell in notebook['cells']:
        if cell['cell_type'] == 'code':
            explanation = [
                "This cell does something interesting.\n",
                " * It is nice to look at\n",
                " * It might be even interesting to understand\n",
            ]
            cell['metadata']['explanation'] = explanation
    return dict(
        nb=notebook,
    )
    
@post('/edit_explanation')
def edit_explanation():
    data = request.json
    cell_index = data.get('cell_index')
    explanation = data.get('explanation')
    # Here you would typically save the explanation to a database or file
    # For this example, we just log it
    print(f"Updated explanation for cell {cell_index}: {explanation}")
    return dict(status='success')

@post('/edit_code')
def edit_code():
    data = request.json
    cell_index = data.get('cell_index')
    source = data.get('source')
    # Here you would typically save the code to a database or file
    # For this example, we just log it
    print(f"Updated code for cell {cell_index}: {source}")
    return dict(status='success')

################################
# Server startup

def find_free_port(start_port):
    port = start_port
    while True:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            if s.connect_ex(('localhost', port)) != 0:
                return port
            port += 2
    
if __name__ == '__main__':    
    port = find_free_port(8080)
    url = f"http://127.0.0.1:{port}/"    
    try:
        webbrowser.open(url)
    except Exception:
        print(f"If the browser does not open, please load this URL: {url}")
    run(host='localhost', port=port, debug=True, reloader=True)