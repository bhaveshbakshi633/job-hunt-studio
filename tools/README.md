# Apply assistant (human-in-the-loop)

Local helper that opens each job in **your** logged-in browser, clicks LinkedIn
**Easy Apply**, auto-fills fields from `profile.yaml`, and **pauses at Submit** so
you review and click it yourself.

## Honest trade-offs
- LinkedIn's ToS restricts automation; running this risks **account restriction**.
  Keep volume low, supervise every run, leave `AUTO_SUBMIT = False`.
- Only Easy Apply jobs can be automated; external-ATS roles are opened for manual
  completion.
- Scaffold, not a finished product — selectors break when LinkedIn changes its DOM.

## Setup
```bash
cp profile.example.yaml profile.yaml   # then fill it in (git-ignored)
python3 -m venv .venv && source .venv/bin/activate
pip install playwright pyyaml && python -m playwright install chromium
python apply_assistant.py
```
First run: log into LinkedIn in the window, press Enter. For each job it fills the
form and stops at Review — you click Submit, press Enter, next.
