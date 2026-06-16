# 🎯 Job Hunt Studio

A free, open-source, **run-from-anywhere** job-hunt dashboard. Browse and filter a
curated role database, track your application status, and generate **tailored
cover letters with your own free LLM key** — all in a static web app with no
backend. Your personal data never leaves your browser.

**Live:** https://bhaveshbakshi633.github.io/job-hunt-studio/

![status](https://img.shields.io/badge/status-live-brightgreen) ![license](https://img.shields.io/badge/license-MIT-blue)

## Features
- **Curated job board** — `data/jobs.json`, ranked by fit (A/B/C), market, source.
- **Status tracking** — per-role, saved in your browser (localStorage).
- **AI cover letters** — bring a free key (Groq / Google Gemini / OpenRouter);
  it's stored only in your browser and called directly from it.
- **Bring-your-own profile** — import a local `profile.json`; never uploaded.
- **Auto-refreshing** — a scheduled cloud job re-scrapes and re-curates the board
  every 6 hours (see below).
- **Local apply assistant** — `tools/apply_assistant.py` auto-fills LinkedIn Easy
  Apply forms in your own browser and stops at Submit for you to approve.

## Use it
Just open the live URL. In **Settings**: pick an AI provider, paste a free key,
and (optionally) import your `profile.json` (template: `profile.example.json`).

Run locally instead:
```bash
git clone https://github.com/bhaveshbakshi633/job-hunt-studio
cd job-hunt-studio && python3 -m http.server 8080   # → http://localhost:8080
```

## Privacy
This public repo contains **no personal data**. Your profile, answers and any API
key live only in your browser's local storage. `profile.json` and
`tools/profile.yaml` are git-ignored.

## Free LLM keys
- Groq — console.groq.com · Google Gemini — aistudio.google.com · OpenRouter — openrouter.ai

## Auto-curation
A scheduled job refreshes `data/jobs.json` every 6 hours: it scrapes fresh
robotics / embodied-AI / ML postings, ranks them by fit, and commits the update —
so the board is always current. See `AGENTS.md` for the schema and curation rules.

## License
MIT — see `LICENSE`.
