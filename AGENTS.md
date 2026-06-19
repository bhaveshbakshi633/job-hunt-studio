# AGENTS.md — for AI agents maintaining this board

This public repo hosts the **Job Hunt Studio** site and its job database. A
scheduled agent keeps `data/jobs.json` fresh. Follow these rules.

## Threat model
This is a **public, backend-less static site**; the data it renders comes from
**untrusted third-party scrapers** (LinkedIn/Indeed via Apify). Assume any
scraped field is attacker-controlled.
- **Stored XSS via job fields** — the primary risk. Defences (keep all of them):
  the `Content-Security-Policy` meta (`script-src 'self'`, no inline, no CDN;
  `style-src 'self'`, no inline styles), HTML-escaping of every field in
  `app.js` (`esc`), and `http(s)`-only link sanitisation (`app.js safeUrl`,
  `curate.clean_link`, `refresh_jobs.norm`). Never introduce inline `<script>`
  or `on*=` handlers, `javascript:` URLs, or `innerHTML` of un-escaped data.
- **Display spoofing** — control bytes / ANSI escapes / Unicode bidi-override
  chars in scraped titles. `refresh_jobs.norm` strips control & format chars at
  the ingest boundary; `validate_jobs.py` is the CI backstop.
- **Referrer / URL leakage** — `<meta name="referrer" content="no-referrer">`
  plus `rel="noopener noreferrer"` on outbound links; provider API keys travel
  in request headers, never URLs.
- **Secret exposure** — see Hard rules 1 & 3. The user's LLM key is client-side
  only (localStorage); it is the user's own low-value free-tier key, not ours.
- **Out of scope** — a malicious browser extension on the user's machine (can
  read localStorage), and `frame-ancestors`/HSTS (cannot be set from a `<meta>`
  CSP — configure at the hosting layer if/when available).

## Hard rules
1. **No personal data in this repo.** It is public. Never commit phone numbers,
   emails, salary figures, answer banks, or `profile.json` / `tools/profile.yaml`
   (they are git-ignored). Those live in the owner's separate PRIVATE repo.
2. **Never auto-submit job applications.** This board surfaces and curates roles;
   a human applies. Don't add code that submits to LinkedIn/Indeed unattended.
3. **Never commit secrets** (Apify token, API keys). Use repo/Action secrets.
4. **Verify before claiming** a run succeeded — re-read `jobs.json` and confirm it
   parses and the count changed.

## Curation target (the owner's interests)
Robotics / embodied-AI engineering, ~mid-level. Markets: **India, Remote/Global,
Singapore, UAE.** Keywords: humanoid, reinforcement learning, sim-to-real, Isaac
Lab / MuJoCo, ROS2, C++ real-time control, manipulation, SLAM, perception,
controls. Drop noise: RPA, generic test-automation, teaching, data-collection gigs.

## `data/jobs.json` schema
```jsonc
{ "meta": { "owner": "", "generated": "YYYY-MM-DD", "source": "", "count": <int> },
  "jobs": [ { "id": <int unique>, "uid": "<10-hex, sha1(link)>", "role": "", "company": "",
    "location": "", "market": "India|Remote/Global|Singapore|UAE|Other (relocation)",
    "remote": <bool>, "fit": "A|B", "source": "LinkedIn|Indeed", "salary": "",
    "posted": "", "curated": "YYYY-MM-DD", "link": "", "notes": "" } ] }
```
Fit: **A** = direct hit (humanoid/RL/sim2real/ROS2-C++/manipulation/controls);
**B** = adjacent robotics/perception/autonomy. **C** (plausible stretch) is a
reject bucket — scored, then dropped; it is **never** persisted. `uid` keys the
user's saved status/letters, so it must be present and unique. `market` and
`remote` are derived from the posting's `location`, not the search bucket.
`curate.curate()` is the single source of truth for scoring and sanitisation;
`validate_jobs.py` enforces these invariants and exits non-zero on any breach.

## Scheduled refresh (every 6h)
1. Scrape fresh postings via the **Apify HTTP API** (token from a secret), e.g.
   actors `valig/linkedin-jobs-scraper` and `kaix/indeed-scraper`, across the
   markets/keywords above.
2. Hand the raw rows to `curate.curate()`: word-boundary keyword scoring, noise /
   gig-farm / non-IC-seniority exclusion, fuzzy `(role, company)` de-dupe, real
   market/remote from the location, stable `uid`, http(s)-only link sanitisation.
3. Renumber `id` by position for display; `meta.generated`/`meta.count` are set
   from the curated list (status rides on `uid`, so ids may safely renumber).
4. Run `python3 scripts/validate_jobs.py` — it must pass before commit.
5. Commit: `chore: refresh job board (<n> roles, +<new>)` and push to `main`.
