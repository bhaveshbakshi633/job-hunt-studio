#!/usr/bin/env python3
"""
LinkedIn "Easy Apply" assistant — human-in-the-loop.

What it does: opens each job from jobs.csv in YOUR logged-in browser, clicks
Easy Apply, and auto-fills every field it can from profile.yaml. It STOPS at the
final Review/Submit screen so you read it and click Submit yourself.

What it deliberately does NOT do: it never clicks the final Submit for you
It never clicks the final Submit for you — that checkpoint is enforced by design.

This automates your own account for your own applications. LinkedIn's terms
restrict automation and aggressively detect it — keep volume low, supervise every
run, and accept that you are choosing this trade-off. See README.md.

Selectors break whenever LinkedIn changes its DOM; treat this as a scaffold you
maintain, not a fire-and-forget bot. It has NOT been tested in this environment.
"""

from __future__ import annotations

import csv
import sys
import time
from difflib import SequenceMatcher
from pathlib import Path

import yaml  # pip install pyyaml
from playwright.sync_api import sync_playwright  # pip install playwright

HERE = Path(__file__).parent
# Persistent browser profile dir — first run, log into LinkedIn manually here.
USER_DATA_DIR = HERE / ".browser_profile"
# There is deliberately NO auto-submit switch. The tool fills the form and always
# stops for you to click Submit yourself — structurally enforced, not a flag, so
# it can never mass-submit and get your account banned.
PER_JOB_PAUSE = 2.0  # seconds between actions — be gentle, don't hammer LinkedIn.


def load_profile() -> dict:
    return yaml.safe_load((HERE / "profile.yaml").read_text())


def load_jobs() -> list[dict]:
    with (HERE / "jobs.csv").open() as f:
        return list(csv.DictReader(f))


def _similar(a: str, b: str) -> float:
    return SequenceMatcher(None, a.lower(), b.lower()).ratio()


def answer_for(question: str, profile: dict) -> str | None:
    """Find the best free-text answer for a form question."""
    q = question.lower().strip()
    # years-of-experience numeric questions
    if "year" in q and ("experience" in q or "how many" in q):
        for skill, yrs in profile["experience_years"].items():
            if skill != "default" and skill.lower() in q:
                return str(yrs)
        return str(profile["experience_years"]["default"])
    # direct field mappings
    if "notice" in q:
        return profile["status"]["notice_period"]
    if "salary" in q or "compensation" in q or "ctc" in q or "expected" in q:
        return profile["status"].get("expected_ctc_india", "Flexible")
    # answer-bank substring match
    best, best_score = None, 0.0
    for key, val in profile["answers"].items():
        if key in q:
            return val
        s = _similar(key, q)
        if s > best_score:
            best, best_score = val, s
    return best if best_score > 0.55 else None


def fill_easy_apply_step(page, profile: dict) -> None:
    """Fill text inputs, textareas and obvious selects on the current modal step."""
    # text inputs & textareas
    for el in page.query_selector_all(
        "input[type=text], input:not([type]), textarea, input[type=tel], input[type=email]"
    ):
        try:
            if el.input_value().strip():
                continue  # already filled (LinkedIn often prefills name/email)
            label = _label_for(page, el)
            if not label:
                continue
            ans = answer_for(label, profile)
            if ans:
                el.fill(str(ans))
                print(f"    filled: {label[:60]!r} -> {str(ans)[:40]!r}")
        except Exception:
            pass
    # naive dropdown handling: pick the option matching our answer, else first real one
    for sel in page.query_selector_all("select"):
        try:
            label = _label_for(page, sel)
            ans = answer_for(label or "", profile) or profile["defaults"]["yes_no_default"]
            options = [o.inner_text().strip() for o in sel.query_selector_all("option")]
            choice = next((o for o in options if ans.lower() in o.lower()), None)
            if choice:
                sel.select_option(label=choice)
        except Exception:
            pass


def _label_for(page, el) -> str | None:
    """Best-effort: find the question text associated with a form element."""
    try:
        eid = el.get_attribute("id")
        if eid:
            lab = page.query_selector(f"label[for='{eid}']")
            if lab:
                return lab.inner_text().strip()
        # fallback: nearest preceding label text in the same field group
        handle = el.evaluate_handle(
            "n => { let p=n.closest('[data-test-form-element],fieldset,div'); "
            "return p ? p.querySelector('label,legend,span') : null; }"
        )
        if handle:
            txt = handle.evaluate("n => n ? n.innerText : ''")
            return txt.strip() if txt else None
    except Exception:
        return None
    return None


def apply_to(page, job: dict, profile: dict) -> str:
    print(f"\n=== {job['company']} — {job['role']}")
    page.goto(job["url"], wait_until="domcontentloaded")
    time.sleep(PER_JOB_PAUSE)

    btn = page.query_selector("button:has-text('Easy Apply')")
    if not btn:
        print("    no Easy Apply (likely external ATS) — opening for manual apply.")
        return "manual"

    btn.click()
    time.sleep(PER_JOB_PAUSE)

    # step through the multi-page modal
    for _ in range(12):
        fill_easy_apply_step(page, profile)
        # upload resume if a file input is present
        for fi in page.query_selector_all("input[type=file]"):
            rp = profile.get("resume_path", "")
            if rp and Path(rp).exists():
                try:
                    fi.set_input_files(rp)
                    print(f"    uploaded resume")
                except Exception:
                    pass
        nxt = page.query_selector("button:has-text('Next'), button:has-text('Continue')")
        review = page.query_selector("button:has-text('Review')")
        submit = page.query_selector("button:has-text('Submit application')")
        if submit:
            print("    >>> Review screen reached. Check it, then click Submit yourself.")
            input("    Press Enter here once you've submitted (or closed) this one... ")
            return "review-handed-off"
        (review or nxt).click() if (review or nxt) else None
        time.sleep(PER_JOB_PAUSE)

    print("    couldn't reach submit in 12 steps — handing off for manual completion.")
    input("    Press Enter once handled... ")
    return "handed-off"


def main() -> None:
    profile = load_profile()
    jobs = load_jobs()
    log_path = HERE / "applied_log.csv"
    results = []
    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(str(USER_DATA_DIR), headless=False)
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        # first run: log in manually, then press Enter
        page.goto("https://www.linkedin.com/feed/")
        if "login" in page.url or "checkpoint" in page.url:
            input("Log into LinkedIn in the opened window, then press Enter here... ")
        for job in jobs:
            try:
                status = apply_to(page, job, profile)
            except Exception as e:
                status = f"error: {e}"
                print(f"    {status}")
            results.append({**job, "status": status})
            time.sleep(PER_JOB_PAUSE)
        ctx.close()
    with log_path.open("w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["url", "company", "role", "status"])
        w.writeheader()
        w.writerows(results)
    print(f"\nDone. Log written to {log_path}")


if __name__ == "__main__":
    sys.exit(main())
