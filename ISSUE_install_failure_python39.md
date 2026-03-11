# Issue: `pip install plainbook` fails on Python 3.9 due to invalid f-string expression

## Summary
Installing `plainbook` from PyPI (`0.1.7`) fails during package installation on Python 3.9.

The failure is caused by invalid f-string expressions in `plainbook/ai_common.py` that include a backslash inside the expression part (for example `{'\n    '.join(parts)}`), which is not allowed in Python 3.9.

---

## Impact
- `pip install plainbook` does not complete successfully for affected users.
- Package cannot be used after install attempt.
- Error output is noisy because a secondary `pip` traceback appears after the initial syntax error.

---

## Environment / Specs
- OS: macOS
- Shell: `zsh`
- Python: 3.9 (Xcode-provided Python path seen in traceback)
  - `/Applications/Xcode.app/Contents/Developer/.../Python3.framework/Versions/3.9/...`
- Installer: `pip3`
- Package version: `plainbook==0.1.7`

---

## Steps to Reproduce
1. Open terminal on macOS with Python 3.9.
2. Run:
   - `pip3 install plainbook`
3. Observe install output and traceback.

---

## Expected Behavior
`plainbook` installs successfully with no syntax errors.

## Actual Behavior
Install fails with:

```text
SyntaxError: f-string expression part cannot include a backslash
File ".../site-packages/plainbook/ai_common.py", line 125
print(f"  Preceding context:\n    {'\n    '.join(parts)}")
```

Then `pip` emits a secondary error while formatting compile output:

```text
TypeError: encode() argument 'encoding' must be str, not None
```

---

## Root Cause
In `plainbook/ai_common.py`, the code uses backslash escapes inside f-string expression blocks:

- `print(f"  Preceding context:\n    {'\n    '.join(parts)}")`
- `print(f"  Cell information:\n    {'\n    '.join(parts)}")`

Python 3.9 rejects this syntax (`f-string expression part cannot include a backslash`).

---

## Proposed Fix
Refactor to compute the joined string before the f-string:

```python
joined = "\n    ".join(parts)
print(f"  Preceding context:\n    {joined}")
```

And similarly for the `Cell information` print.

This avoids backslashes in the f-string expression while preserving output format.

---

## Validation Plan
After patching:
1. Build and publish a new patch release (for example `0.1.8`).
2. Verify install on Python 3.9:
   - `pip3 install plainbook==0.1.8`
3. Optional: run import smoke test:
   - `python3 -c "import plainbook; print('ok')"`
4. Confirm no syntax errors and no compile-time failures.

---

## Acceptance Criteria
- [ ] Installation succeeds on Python 3.9.
- [ ] No `SyntaxError` in `ai_common.py` during install.
- [ ] Logging output remains unchanged in content/format.
- [ ] Patch release published with fix.
