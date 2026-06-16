#!/usr/bin/env python3
"""
Auto-refresh the job board. Runs in CI every 6h.

Scrapes fresh robotics/embodied-AI postings via the Apify API (token from the
APIFY_TOKEN env/secret), curates them to the owner's interests with keyword
scoring, merges into data/jobs.json (dedupe by link, stable ids), and writes it
back. The workflow commits any change.

Stdlib only — no pip install needed.
"""
from __future__ import annotations

import json
import os
import sys
import urllib.request
from datetime import date
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "data" / "jobs.json"
TOKEN = os.environ.get("APIFY_TOKEN", "")
API = "https://api.apify.com/v2/acts/{actor}/run-sync-get-dataset-items?token={tok}"

# (actor, input, market, source). maxItems kept modest to bound cost per run.
QUERIES = [
    ("valig~linkedin-jobs-scraper", {"title": "Robotics Engineer", "location": "India", "datePosted": "r604800", "limit": 40}, "India", "LinkedIn"),
    ("valig~linkedin-jobs-scraper", {"title": "Reinforcement Learning", "location": "India", "datePosted": "r604800", "limit": 25}, "India", "LinkedIn"),
    ("valig~linkedin-jobs-scraper", {"title": "Robotics Engineer", "location": "Worldwide", "remote": ["2"], "datePosted": "r604800", "limit": 40}, "Remote/Global", "LinkedIn"),
    ("valig~linkedin-jobs-scraper", {"title": "Robotics Engineer", "location": "Singapore", "datePosted": "r604800", "limit": 25}, "Singapore", "LinkedIn"),
    ("valig~linkedin-jobs-scraper", {"title": "Robotics Engineer", "location": "United Arab Emirates", "datePosted": "r604800", "limit": 25}, "UAE", "LinkedIn"),
    ("kaix~indeed-scraper", {"keyword": "robotics", "location": "India", "country": "IN", "maxItems": 40, "sort": "date", "searchMode": "basic", "fromDays": "7"}, "India", "Indeed"),
]

# fit scoring
A = ["humanoid", "reinforcement learning", "sim-to-real", "sim2real", "isaac", "mujoco",
     "manipulation", "locomotion", "ros2", "ros ", "controls engineer", "robot learning", "embodied"]
B = ["robotics", "perception", "slam", "autonomy", "computer vision", "motion planning",
     "mechatronics", "c++", "control"]
NOISE = ["rpa", "test automation", "teacher", "faculty", "trainer", "data collector",
         "business development", "sales", "recruiter", "marketing", "intern", "copywriter"]


def fetch(actor: str, payload: dict) -> list[dict]:
    url = API.format(actor=actor, tok=TOKEN)
    req = urllib.request.Request(
        url, data=json.dumps(payload).encode(), headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(req, timeout=180) as r:
        return json.loads(r.read().decode())


def norm(item: dict, market: str, source: str) -> dict | None:
    if source == "LinkedIn":
        role = (item.get("title") or "").strip()
        company = (item.get("companyName") or "").strip()
        loc = (item.get("location") or "").strip()
        link = item.get("url") or ""
        salary = item.get("salary") or ""
        posted = item.get("postedTimeAgo") or ""
    else:  # Indeed (kaix)
        role = ((item.get("title") or {}).get("text") or "").strip()
        company = ((item.get("company") or {}).get("name") or "").strip()
        loc = ((item.get("location") or {}).get("formatted") or "").strip()
        link = (item.get("urls") or {}).get("indeed") or ""
        salary = (item.get("salary") or {}).get("text") or ""
        posted = (item.get("dates") or {}).get("age") or ""
    if not role or not link:
        return None
    return {"role": role, "company": company, "location": loc, "market": market,
            "source": source, "salary": salary or "", "posted": posted or "", "link": link, "notes": ""}


def fit(role: str) -> str | None:
    t = role.lower()
    if any(n in t for n in NOISE):
        return None
    if any(k in t for k in A):
        return "A"
    if any(k in t for k in B):
        return "B"
    return "C"


def main() -> int:
    if not TOKEN:
        print("APIFY_TOKEN not set — aborting.", file=sys.stderr)
        return 1
    existing = json.loads(DATA.read_text())
    jobs = existing["jobs"]
    by_link = {j["link"]: j for j in jobs}
    next_id = max((j["id"] for j in jobs), default=0) + 1
    added = 0
    for actor, payload, market, source in QUERIES:
        try:
            items = fetch(actor, payload)
        except Exception as e:
            print(f"query failed ({actor}/{market}): {e}", file=sys.stderr)
            continue
        for it in items:
            j = norm(it, market, source)
            if not j or j["link"] in by_link:
                continue
            f = fit(j["role"])
            if not f:
                continue
            j["fit"] = f
            j["id"] = next_id
            next_id += 1
            by_link[j["link"]] = j
            jobs.append(j)
            added += 1
    existing["jobs"] = jobs
    existing["meta"]["generated"] = date.today().isoformat()
    existing["meta"]["count"] = len(jobs)
    DATA.write_text(json.dumps(existing, indent=2, ensure_ascii=False) + "\n")
    print(f"Refresh complete: +{added} new roles, {len(jobs)} total.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
