#!/usr/bin/env python3
"""
Auto-refresh the job board. Runs in CI every 6h.

Scrapes fresh robotics/embodied-AI postings via the Apify API (token from the
APIFY_TOKEN secret, sent as a Bearer header — never in the URL), then RE-CURATES
the entire board through scripts/curate.py: word-boundary scoring, noise/gig/non-IC
exclusion, real market detection, fuzzy dedupe, and an absolute `curated` date.

Because the whole set is re-curated every run, the board can't balloon (the old
append-only bug) and stale duplicates are collapsed. A hard cap is the backstop.

Stdlib only — no pip install needed.
"""
from __future__ import annotations

import json
import os
import sys
import urllib.request
from datetime import date, datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from curate import curate  # shared curation logic

DATA = Path(__file__).resolve().parent.parent / "data" / "jobs.json"
TOKEN = os.environ.get("APIFY_TOKEN", "")
RUN = "https://api.apify.com/v2/acts/{actor}/run-sync-get-dataset-items"
CAP = 300              # hard backstop on board size
MAX_AGE_DAYS = 45      # drop roles not seen by curation in this long

QUERIES = [
    ("valig~linkedin-jobs-scraper", {"title": "Robotics Engineer", "location": "India", "datePosted": "r604800", "limit": 40}, "LinkedIn"),
    ("valig~linkedin-jobs-scraper", {"title": "Reinforcement Learning", "location": "India", "datePosted": "r604800", "limit": 25}, "LinkedIn"),
    ("valig~linkedin-jobs-scraper", {"title": "Humanoid", "location": "Worldwide", "remote": ["2"], "datePosted": "r604800", "limit": 30}, "LinkedIn"),
    ("valig~linkedin-jobs-scraper", {"title": "Robotics Engineer", "location": "Singapore", "datePosted": "r604800", "limit": 25}, "LinkedIn"),
    ("valig~linkedin-jobs-scraper", {"title": "Robotics Engineer", "location": "United Arab Emirates", "datePosted": "r604800", "limit": 25}, "LinkedIn"),
    ("kaix~indeed-scraper", {"keyword": "robotics", "location": "India", "country": "IN", "maxItems": 40, "sort": "date", "searchMode": "basic", "fromDays": "7"}, "Indeed"),
]


def fetch(actor: str, payload: dict) -> list[dict]:
    req = urllib.request.Request(
        RUN.format(actor=actor),
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {TOKEN}"},
    )
    with urllib.request.urlopen(req, timeout=240) as r:
        return json.loads(r.read().decode())


def norm(item: dict, source: str) -> dict | None:
    if source == "LinkedIn":
        role, company = item.get("title"), item.get("companyName")
        loc, link = item.get("location"), item.get("url")
        salary, posted = item.get("salary"), item.get("postedTimeAgo")
    else:  # Indeed (kaix)
        role = (item.get("title") or {}).get("text")
        company = (item.get("company") or {}).get("name")
        loc = (item.get("location") or {}).get("formatted")
        link = (item.get("urls") or {}).get("indeed")
        salary = (item.get("salary") or {}).get("text")
        posted = (item.get("dates") or {}).get("age")
    if not role or not link:
        return None
    return {"role": role, "company": company, "location": loc, "source": source,
            "salary": salary or "", "posted": posted or "", "link": link, "notes": ""}


def main() -> int:
    if not TOKEN:
        print("APIFY_TOKEN not set — aborting.", file=sys.stderr)
        return 1
    today = date.today().isoformat()
    raw = []
    for actor, payload, source in QUERIES:
        try:
            for it in fetch(actor, payload):
                j = norm(it, source)
                if j:
                    raw.append(j)
        except Exception as e:
            print(f"query failed ({actor}): {e}", file=sys.stderr)

    existing = json.loads(DATA.read_text()).get("jobs", [])
    before = len(existing)
    # keep existing roles, but expire ones not re-seen for a long time
    cutoff = (datetime.now(timezone.utc).date()).toordinal() - MAX_AGE_DAYS
    fresh_links = {j["link"] for j in raw if j.get("link")}
    kept = [j for j in existing
            if j.get("link") in fresh_links
            or date.fromisoformat(j.get("curated", today)).toordinal() >= cutoff]

    merged = curate(kept + raw, today)        # recompute fit, dedupe, drop noise/C
    merged = merged[:CAP]
    for i, j in enumerate(merged, 1):
        j["id"] = i

    out = {"meta": {"owner": "Bhavesh Bakshi", "generated": today,
                    "source": "Apify (LinkedIn+Indeed), curated", "count": len(merged)},
           "jobs": merged}
    DATA.write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n")
    print(f"Refresh complete: {before} -> {len(merged)} curated roles "
          f"({sum(j['fit']=='A' for j in merged)} A, {sum(j['fit']=='B' for j in merged)} B).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
