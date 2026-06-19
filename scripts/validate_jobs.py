#!/usr/bin/env python3
"""
Data-quality gate for data/jobs.json — stdlib only.

Asserts the invariants the board relies on and that the v2 hardening introduced:
  - ids are present and unique
  - uids are present and unique (status is keyed on uid — collisions corrupt it)
  - every required field is present on every job
  - fit is exactly "A" or "B" (C is a reject bucket and must never be persisted)
  - link is http(s) only (matches clean_link's sanitisation)
  - no exact (role, company) duplicates
  - meta.count, if present, matches the number of jobs

Run standalone for CI, or import `validate(data)` to get the error list. Exits
non-zero with a clear, grouped report when anything fails so CI blocks bad data.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "data" / "jobs.json"

# Every job must carry these keys (the live v2 schema).
REQUIRED_FIELDS = [
    "id", "uid", "role", "company", "location", "market", "remote",
    "fit", "source", "salary", "posted", "curated", "link", "notes",
]
# Of those, these must also be non-empty — the rest may legitimately be "".
NON_EMPTY_FIELDS = ["id", "uid", "role", "company", "fit", "curated", "link"]
VALID_FIT = {"A", "B"}


def _is_http(link: object) -> bool:
    return isinstance(link, str) and (link.startswith("http://") or link.startswith("https://"))


def validate(data: dict) -> list[str]:
    """Return a list of human-readable error strings (empty == data is clean)."""
    errors: list[str] = []

    if not isinstance(data, dict):
        return ["top-level JSON is not an object"]
    jobs = data.get("jobs")
    if not isinstance(jobs, list):
        return ["'jobs' is missing or is not a list"]
    if not jobs:
        return ["'jobs' is empty — nothing to serve"]

    seen_ids: dict[object, int] = {}
    seen_uids: dict[object, int] = {}
    seen_role_company: dict[tuple[str, str], int] = {}

    for idx, job in enumerate(jobs):
        # a stable label for messages: prefer id, fall back to list position
        label = f"id={job.get('id')}" if isinstance(job, dict) else f"index {idx}"
        if not isinstance(job, dict):
            errors.append(f"job at index {idx} is not an object")
            continue

        # required fields present
        for field in REQUIRED_FIELDS:
            if field not in job:
                errors.append(f"job {label}: missing required field '{field}'")
        # core fields non-empty
        for field in NON_EMPTY_FIELDS:
            val = job.get(field)
            if val is None or (isinstance(val, str) and not val.strip()):
                errors.append(f"job {label}: field '{field}' is empty")

        # fit in {A, B}
        fit = job.get("fit")
        if fit not in VALID_FIT:
            errors.append(f"job {label}: fit {fit!r} not in {{A, B}}")

        # link is http(s)
        if not _is_http(job.get("link")):
            errors.append(f"job {label}: link {job.get('link')!r} is not http(s)")

        # remote must be a clean bool
        if not isinstance(job.get("remote"), bool):
            errors.append(f"job {label}: 'remote' must be a boolean, got {job.get('remote')!r}")

        # unique id
        jid = job.get("id")
        if jid in seen_ids:
            errors.append(f"duplicate id {jid!r}: jobs at positions {seen_ids[jid]} and {idx}")
        elif jid is not None:
            seen_ids[jid] = idx

        # unique uid
        uid = job.get("uid")
        if uid in seen_uids:
            errors.append(f"duplicate uid {uid!r}: jobs at positions {seen_uids[uid]} and {idx}")
        elif uid is not None:
            seen_uids[uid] = idx

        # no exact (role, company) duplicates
        role = (job.get("role") or "")
        company = (job.get("company") or "")
        rc = (role, company)
        if rc in seen_role_company:
            errors.append(
                f"duplicate (role, company) {rc!r}: jobs at positions "
                f"{seen_role_company[rc]} and {idx}"
            )
        else:
            seen_role_company[rc] = idx

    # meta.count, when present, should match reality
    meta = data.get("meta")
    if isinstance(meta, dict) and "count" in meta and meta["count"] != len(jobs):
        errors.append(f"meta.count ({meta['count']}) != actual job count ({len(jobs)})")

    return errors


def main(argv: list[str]) -> int:
    path = Path(argv[1]) if len(argv) > 1 else DATA
    try:
        data = json.loads(path.read_text())
    except FileNotFoundError:
        print(f"FAIL: {path} not found", file=sys.stderr)
        return 2
    except json.JSONDecodeError as e:
        print(f"FAIL: {path} is not valid JSON — {e}", file=sys.stderr)
        return 2

    errors = validate(data)
    if errors:
        print(f"FAIL: {len(errors)} data-quality issue(s) in {path}:", file=sys.stderr)
        for e in errors:
            print(f"  - {e}", file=sys.stderr)
        return 1

    print(f"OK: {len(data['jobs'])} jobs validated in {path} — all invariants hold.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
