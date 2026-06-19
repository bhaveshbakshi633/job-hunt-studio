# 🎯 Job Hunt Studio

A free, open-source, **run-from-anywhere** job-hunt dashboard. Browse and filter a
curated role database, track your application status, and generate **tailored
cover letters with your own free LLM key** — all in a static web app with no
backend. Your personal data never leaves your browser.

**Live:** https://bhaveshbakshi633.github.io/job-hunt-studio/

![status](https://img.shields.io/badge/status-live-brightgreen) ![license](https://img.shields.io/badge/license-MIT-blue)

## Features
- **Curated job board** — 152 roles in `data/jobs.json`, ranked by fit (A/B),
  market, source. (Fit **C** is a reject bucket — it is dropped during curation,
  never persisted.)
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
robotics / embodied-AI / ML postings, re-scores them by fit, de-dupes on
`(role, company)`, and commits the update — so the board is current.
`scripts/curate.py` holds the shared scoring/sanitisation logic;
`scripts/validate_jobs.py` is a stdlib CI gate that blocks malformed data (unique
ids/uids, required fields, fit ∈ {A,B}, http(s)-only links, `meta.count` accurate).
See `AGENTS.md` for the schema and curation rules.

## Changelog

### v2 — adversarial-review hardening
A security/quality panel reviewed the board; this release lands every fix.
- **Curation correctness** — keyword matching is now word-boundary anchored, so
  `ros ` no longer matches inside `futuros` and `control` only scores with a
  robotics co-term. Tightening the noise/gig-farm/non-IC-seniority filters cut a
  678-row raw scrape to **154** genuinely relevant roles (now **152** after
  de-dupe), and fit is recomputed every run as **A/B only** (C is rejected).
- **Real market/remote** — `market` and the `remote` flag are derived from the
  posting's location, not the search bucket that found it.
- **Stable identity** — each role carries a `uid` (hash of its link) so saved
  status and generated letters survive a board refresh; status is uid-keyed.
- **XSS / injection defences** — a `Content-Security-Policy` meta (`script-src
  'self'`, no inline, no CDN), HTML-escaping of every rendered field, and
  `http(s)`-only link sanitisation at both ingest (`curate.clean_link`,
  `refresh_jobs`) and render (`app.js safeUrl`).
- **Leakage controls** — `<meta name="referrer" content="no-referrer">` plus
  `rel="noopener noreferrer"` on outbound links; API keys travel in headers only.
- **Accessibility** — the job modal is focus-trapped (Tab/Shift-Tab cycle, Esc and
  backdrop close, focus returns to the opener) with a skip-to-results link.
- **Data gate** — `scripts/validate_jobs.py` enforces the invariants above in CI.

## License
MIT — see `LICENSE`.
