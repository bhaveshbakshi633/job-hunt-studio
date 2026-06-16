# AGENTS.md — for AI agents maintaining this board

This public repo hosts the **Job Hunt Studio** site and its job database. A
scheduled agent keeps `data/jobs.json` fresh. Follow these rules.

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
  "jobs": [ { "id": <int unique>, "role": "", "company": "", "location": "",
    "market": "India|Remote/Global|Singapore|UAE", "fit": "A|B|C",
    "source": "LinkedIn|Indeed", "salary": "", "posted": "", "link": "", "notes": "" } ] }
```
Fit: **A** = direct hit (humanoid/RL/sim2real/ROS2-C++/manipulation/controls);
**B** = adjacent robotics/perception/autonomy; **C** = plausible stretch.

## Scheduled refresh (every 6h)
1. Scrape fresh postings via the **Apify HTTP API** (token from a secret), e.g.
   actors `valig/linkedin-jobs-scraper` and `kaix/indeed-scraper`, across the
   markets/keywords above.
2. De-dupe by `link`; rank with the fit guide; cap noise.
3. Merge with existing `jobs.json` (keep ids stable; assign new ids by max+1);
   update `meta.generated` and `meta.count`.
4. Commit: `chore: refresh job board (<n> roles, +<new>)` and push to `main`.
