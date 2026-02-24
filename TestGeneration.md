# Generating the code for test cells

The code in test cells is able to access the state of a notebook after any previous cell, and we need to explain to the  the AI how to access such states. 

To access the state of a variable x after a cell that has name (stored in cell.metadata["name"]) some_name, the code can use __state__some_name.x .  

So we pass to the code generation for tests all the usual arguments we pass for code generation, and also instructions on how to access variables after states, and also, the full list of previous state names (for code cells only). 

Can you update gemini.py, claude.py, plainbook.py, to reflect this change? 
