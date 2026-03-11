## feat: add AI-generated notebook summary button and first-cell insertion

- Add `Summary` action to the navbar and wire the UI event flow.
- Implement the frontend handler to call the summary API, refresh the notebook, and focus the first cell.
- Add the `/generate_notebook_summary` backend endpoint with existing AI config and billing error handling.
- Add notebook-level `generate_notebook_summary()` logic to:
    - generate a markdown summary from notebook context
    - insert a new first markdown cell when missing
    - update an existing auto-generated summary when present
    - tag the summary cell with `metadata.plainbook_summary = true`
- Add provider support for notebook summaries in Gemini and Claude integrations.
- Add shared summary system instructions and a markdown-fence stripping helper.
- Register the new `summarize_notebook` provider hook in the AI provider registry.