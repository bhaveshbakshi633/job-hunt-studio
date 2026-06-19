#!/usr/bin/env python3
"""
Shared curation logic — used by both the one-off cleanup and the 6-hourly refresh.

Fixes the panel's findings:
- word-boundary keyword matching (no more "ros " inside "futuros")
- additive, recomputed-every-run fit (A/B only; C is a reject bucket = dropped)
- noise/gig-farm/non-IC-seniority exclusion (title AND company)
- "control" only scores with a robotics co-term
- real market/remote derived from the posting location, not the search bucket
- fuzzy dedupe on (role, company), not just URL
- stable uid (hash of link) so saved status survives refreshes
- http(s)-only link sanitisation
"""
from __future__ import annotations
import hashlib, re

A_KW = ["humanoid","reinforcement learning","sim-to-real","sim2real","isaac","mujoco",
        "manipulation","locomotion","ros2","robot learning","embodied","quadruped",
        "legged","whole-body","whole body","teleoperation","motion planning"]
B_KW = ["robotics","robot","perception","slam","autonomy","autonomous","computer vision",
        "mechatronics","navigation","controls engineer","control systems"]
ROBO_CTX = ["robot","robotic","ros","humanoid","autonom","mechatron","motion","manipulat","slam","drone","uav"]
NOISE = ["rpa","test automation","quality assurance"," qa ","teacher","faculty","professor",
         "lecturer","trainer","data collector","business development","sales","marketing",
         "copywriter","recruiter","internship","intern","data entry","bpo","accountant",
         "talent acquisition","customer success","preschool","kindergarten"]
GIG_CO = ["alignerr","mercor","appen","telus","scale ai","cntxt","remotasks","outlier","turing"]
SENIOR_DROP = ["manager","director","vice president"," vp","head of","chief","professor","lecturer"]


def _has(text: str, kw: str) -> bool:
    return re.search(r"(?<![a-z0-9])" + re.escape(kw) + r"(?![a-z0-9])", text) is not None


def fit_of(role: str, company: str) -> str | None:
    t = " " + role.lower() + " "
    c = company.lower()
    if any(n in t for n in NOISE) or any(n in c for n in NOISE):
        return None
    if any(g in c for g in GIG_CO):
        return None
    if any(s in t for s in SENIOR_DROP):           # keep IC: senior/lead/staff/principal
        return None
    score = 0
    if any(_has(t, k) for k in A_KW):
        score += 2
    has_ctx = any(x in t for x in ROBO_CTX)
    for k in B_KW:
        if _has(t, k):
            # "controls engineer"/"control systems" only count with robotics context
            if "control" in k and not has_ctx:
                continue
            score += 1
    if score >= 2:
        return "A"
    if score == 1 and has_ctx:
        return "B"
    return None


def market_of(location: str) -> tuple[str, bool]:
    l = location.lower()
    if any(x in l for x in ["remote", "worldwide", "anywhere"]):
        return "Remote/Global", True
    if "singapore" in l:
        return "Singapore", False
    if any(x in l for x in ["united arab emirates", "dubai", "abu dhabi", "sharjah", "uae", "دبي", "أبو"]):
        return "UAE", False
    if "india" in l or any(x in l for x in ["bengaluru","bangalore","mumbai","pune","hyderabad","chennai","delhi","gurugram","gurgaon","noida","kolkata","ahmedabad","kochi","jamnagar"]):
        return "India", False
    if not l.strip():
        return "Remote/Global", False
    return "Other (relocation)", False


def uid_of(link: str) -> str:
    return hashlib.sha1(link.encode()).hexdigest()[:10]


def clean_link(link: str) -> str | None:
    link = (link or "").strip()
    return link if link.startswith("http://") or link.startswith("https://") else None


def norm_key(role: str, company: str) -> tuple[str, str]:
    r = re.sub(r"\(.*?\)", "", role.lower())
    r = re.sub(r"[^a-z0-9 ]", "", r)
    r = re.sub(r"\s+", " ", r).strip()
    co = re.sub(r"[^a-z0-9]", "", company.lower())
    return r, co


def curate(raw_jobs: list[dict], today: str) -> list[dict]:
    """Take raw job dicts, return a clean, deduped, re-scored, market-correct list."""
    scored = []
    for j in raw_jobs:
        link = clean_link(j.get("link"))
        role = (j.get("role") or "").strip()
        company = (j.get("company") or "").strip()
        if not link or not role:
            continue
        fit = fit_of(role, company)
        if not fit:
            continue
        market, remote = market_of(j.get("location") or "")
        scored.append({
            "uid": uid_of(link), "role": role, "company": company,
            "location": (j.get("location") or "").strip(), "market": market, "remote": remote,
            "fit": fit, "source": j.get("source") or "", "salary": j.get("salary") or "",
            "posted": j.get("posted") or "", "curated": today, "link": link,
            "notes": j.get("notes") or "",
        })
    # keep A before B, then dedupe on (role, company)
    scored.sort(key=lambda x: 0 if x["fit"] == "A" else 1)
    seen, out = set(), []
    for j in scored:
        k = norm_key(j["role"], j["company"])
        if k in seen:
            continue
        seen.add(k)
        out.append(j)
    # stable id by position for display only; status keys on uid
    for i, j in enumerate(out, 1):
        j["id"] = i
    return out
