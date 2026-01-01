import google.generativeai as genai

def generate_notebook_cell(api_key, previous_code, instructions):
    # 1. Configure the API
    genai.configure(api_key=api_key)
    
    # 2. Extract existing code for context
    # This helps Gemini know about previously defined variables/imports

    # 3. Initialize the model with a System Instruction
    model = genai.GenerativeModel(
        model_name="gemini-1.5-flash", # or gemini-1.5-pro for complex logic
        system_instruction="You are an assistant that writes Python code for Jupyter cells. "
                           "Return ONLY the code, no markdown formatting or explanations."
    )

    # 4. Create the prompt
    prompt = f"""
    CONTEXT (Existing Notebook Code):
    {previous_code}

    INSTRUCTIONS for New Cell:
    {instructions}
    
    Code:
    """

    response = model.generate_content(prompt)
    return response.text

# Usage
# instructions = "Create a plot using matplotlib showing the trend of the 'price' variable."
# new_code = generate_notebook_cell(api_key, previous_code, instructions)