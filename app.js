// Job Hunt Studio — loads jobs.json, tracks status in localStorage (keyed by a
// stable uid so a board refresh can't mis-assign it), tailors cover letters with
// your chosen free LLM. No backend; runs anywhere.
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const STATUSES = ["To review", "To apply", "Applied", "Interview", "Offer", "Rejected", "Skip"];

let JOBS = [];
let lastFocus = null;
const key = j => j.uid || String(j.id);                       // stable status key
const statusMap = () => JSON.parse(localStorage.getItem("jobapply_status") || "{}");
const saveStatus = m => lsWrite("jobapply_status", JSON.stringify(m));
const setStatus = (k, s) => { const m = statusMap(); m[k] = s; saveStatus(m); };
const profile = () => JSON.parse(localStorage.getItem("jobapply_profile") || "null");
// generated cover letters, keyed by the same stable uid as status (survives reopening / board refresh)
const lettersMap = () => JSON.parse(localStorage.getItem("jobapply_letters") || "{}");
const saveLetters = m => lsWrite("jobapply_letters", JSON.stringify(m));
// any narrowing control engaged? (sort is not a filter, so it's excluded)
const filtersActive = () => !!($("#search").value.trim() || $("#market").value || $("#fit").value || $("#status").value);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const safeUrl = u => { try { const x = new URL(u); return (x.protocol === "http:" || x.protocol === "https:") ? u : "#"; } catch { return "#"; } };
const debounce = (fn, ms = 160) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
// transient, screen-reader-announced note for resilience events (quota, backup/restore).
// CSP-safe: writes into a static #toast region; no inline handlers, no injected markup.
let toastTimer;
function notify(text, ms = 4500) {
  const t = $("#toast");
  if (!t) { console.warn("notify:", text); return; }
  t.textContent = text;
  t.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add("hidden"), ms);
}
// Guard every localStorage write. A full quota (or storage locked down by the browser) must
// not crash a status change or silently drop data — surface it and point the user at a backup.
function lsWrite(k, v) {
  try { localStorage.setItem(k, v); return true; }
  catch (e) {
    const quota = !!e && (e.name === "QuotaExceededError" ||
      e.name === "NS_ERROR_DOM_QUOTA_REACHED" || e.code === 22 || e.code === 1014);
    notify(quota
      ? "⚠ Local storage is full — your change wasn't saved. Back up your status (JSON), then clear old cover-letter drafts."
      : "⚠ Couldn't save to this browser's local storage.");
    console.error("localStorage write failed for", k, e);
    return false;
  }
}
// Language of Parts (WCAG 3.1.2): tag titles in a non-Latin script so a screen reader
// switches pronunciation. Returns a BCP-47 code, or "" for plain Latin text (incl. ™/punctuation).
const langOf = s => {
  const t = String(s ?? "");
  if (/[぀-ゟ゠-ヿ]/.test(t)) return "ja";              // hiragana / katakana
  if (/[가-힯ᄀ-ᇿ]/.test(t)) return "ko";              // hangul
  if (/[؀-ۿ]/.test(t)) return "ar";                          // arabic
  if (/[֐-׿]/.test(t)) return "he";                          // hebrew
  if (/[Ѐ-ӿ]/.test(t)) return "ru";                          // cyrillic
  if (/[一-鿿]/.test(t)) return "zh";                          // cjk ideographs
  return "";
};
// build a lang="..." attribute fragment, only when a switch is warranted
const langAttr = s => { const l = langOf(s); return l ? ` lang="${l}"` : ""; };

/**
 * Load the board with one retry — a single dropped request on a flaky connection or a
 * cold static host shouldn't strand the user on the error state. Two attempts, brief backoff.
 * @returns {Promise<{meta:object, jobs:object[]}>} parsed jobs.json
 */
async function fetchJobs() {
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch("data/jobs.json", { cache: "no-store" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      return await res.json();
    } catch (e) {
      lastErr = e;
      if (attempt === 0) await new Promise(r => setTimeout(r, 400));   // settle, then retry once
    }
  }
  throw lastErr;
}

/** Boot the app: load jobs, run the data self-check, wire controls + modals, render once. */
async function boot() {
  const grid = $("#grid");
  try {
    const data = await fetchJobs();
    if (!Array.isArray(data.jobs)) throw new Error("malformed data");
    JOBS = data.jobs;
  } catch (e) {
    grid.setAttribute("aria-busy", "false");
    grid.innerHTML = `<div class="empty"><p>Couldn't load the job board.</p>
      <button id="retry">Retry</button></div>`;
    $("#retry").onclick = () => location.reload();
    console.error("jobs.json load failed:", e);
    return;
  }
  // self-check: status/letters ride on uid; a missing uid silently falls back to id and can
  // collide across refreshes, so surface it loudly rather than corrupting the pipeline quietly.
  const noUid = JOBS.filter(j => !j.uid).length;
  if (noUid) console.warn(`jobs.json: ${noUid} of ${JOBS.length} item(s) missing a uid — status keys fall back to id; re-run scripts/refresh_jobs.py.`);
  pruneStatus();
  [...new Set(JOBS.map(j => j.market))].sort().forEach(m => {
    const o = document.createElement("option"); o.value = o.textContent = m; $("#market").appendChild(o);
  });
  $("#search").addEventListener("input", debounce(render));
  ["market", "fit", "status", "sort"].forEach(id => $("#" + id).addEventListener("change", render));
  $("#exportBtn").onclick = exportCsv;
  $("#backupBtn").onclick = exportStatusJson;
  // CSP-safe file picker: a real <button> proxies the hidden <input> (no inline handlers)
  $("#importStatusBtn").onclick = () => $("#importStatusFile").click();
  $("#importStatusFile").onchange = e => { importStatusJson(e.target.files[0]); e.target.value = ""; };
  $("#clearFilters").onclick = clearFilters;
  // event delegation — one listener for the whole grid (keyboard + mouse)
  $("#grid").addEventListener("click", e => {
    if (e.target.closest("#clearInEmpty")) { clearFilters(); return; }   // one-click clear from the empty state
    const c = e.target.closest(".card"); if (c) openJob(c.dataset.uid);
  });
  wireSettings(); wireModals(); wireHint();
  render();
}

// drop saved statuses and letters whose jobs no longer exist (keeps localStorage clean)
function pruneStatus() {
  const live = new Set(JOBS.map(key));
  const m = statusMap(); let changed = false;
  for (const k of Object.keys(m)) if (!live.has(k)) { delete m[k]; changed = true; }
  if (changed) saveStatus(m);
  const lm = lettersMap(); let lchanged = false;
  for (const k of Object.keys(lm)) if (!live.has(k)) { delete lm[k]; lchanged = true; }
  if (lchanged) saveLetters(lm);
}

/** Filter, sort and paint the grid from the current controls; reads status once and reuses it. */
function render() {
  const q = $("#search").value.trim().toLowerCase();
  const fM = $("#market").value, fF = $("#fit").value, fS = $("#status").value, sort = $("#sort").value;
  const m = statusMap();
  let rows = JOBS.filter(j => {
    const st = m[key(j)] || "To review";
    const hit = !q || j.role.toLowerCase().includes(q) || j.company.toLowerCase().includes(q);
    return hit && (!fM || j.market === fM) && (!fF || j.fit === fF) && (!fS || st === fS);
  });
  const cmp = {
    fit: (a, b) => (a.fit > b.fit ? 1 : a.fit < b.fit ? -1 : a.company.localeCompare(b.company)),
    company: (a, b) => a.company.localeCompare(b.company),
    role: (a, b) => a.role.localeCompare(b.role),
    status: (a, b) => (m[key(a)] || "To review").localeCompare(m[key(b)] || "To review"),
  }[sort];
  rows.sort(cmp);

  const counts = JOBS.reduce((a, j) => { const s = m[key(j)] || "To review"; a[s] = (a[s] || 0) + 1; return a; }, {});
  $("#stats").innerHTML = `<span><b>${JOBS.length}</b> roles</span>
    <span><b>${counts["Applied"] || 0}</b> applied</span>
    <span><b>${counts["To apply"] || 0}</b> queued</span>
    <span><b>${JOBS.filter(j => j.fit === "A").length}</b> A-fits</span>
    <span>${profile() ? "profile ✓" : "no profile"}</span>`;
  $("#count").textContent = `${rows.length} of ${JOBS.length}`;
  $("#clearFilters").classList.toggle("hidden", !filtersActive());
  const grid = $("#grid");
  grid.setAttribute("aria-busy", "false");
  if (rows.length) {
    grid.innerHTML = rows.map(j => card(j, m)).join("");
  } else if (filtersActive()) {
    // narrowed to nothing — explain why and offer a one-click reset (wired via the grid delegate)
    grid.innerHTML = `<div class="empty"><p>No roles match these filters.</p>
      <p class="muted">Try a broader search, or a different market, fit, or status.</p>
      <button id="clearInEmpty">Clear filters</button></div>`;
  } else {
    grid.innerHTML = `<div class="empty"><p>No roles to show yet.</p>
      <p class="muted">Run the refresh script to populate the board.</p></div>`;
  }
}

// reset every narrowing control (sort is preserved) and re-render
function clearFilters() {
  $("#search").value = "";
  ["market", "fit", "status"].forEach(id => { $("#" + id).value = ""; });
  render();
  $("#search").focus();
}

/**
 * Render one job as a focusable card button.
 * @param {object} j a job record
 * @param {Record<string,string>} m shared uid→status map — passed in so no card reads localStorage
 * @returns {string} card markup
 */
function card(j, m) {
  const st = m[key(j)] || "To review";
  return `<button class="card fitedge${j.fit}" data-uid="${esc(key(j))}" aria-label="${esc(j.role)} at ${esc(j.company)}">
    <span class="fitbadge fit${j.fit}">${j.fit}</span>
    <h3${langAttr(j.role)}>${esc(j.role)}</h3>
    <div class="co">${esc(j.company)} · ${esc(j.location)}</div>
    <div class="row">
      <span class="meta">${esc(j.market)}</span>
      ${j.remote ? `<span class="meta remote">Remote</span>` : ""}
      <span class="meta">${esc(j.source)}</span>
      ${j.salary ? `<span class="meta">${esc(j.salary)}</span>` : ""}
      <span class="status st-${st.replace(/\s/g, "")}">${esc(st)}</span>
    </div></button>`;
}

/**
 * Open the detail modal for a job: status control, cover-letter tooling, answer bank.
 * @param {string} uid the stable status key (uid, or id fallback)
 */
function openJob(uid) {
  const j = JOBS.find(x => key(x) === uid);
  if (!j) return;
  const st = statusMap()[uid] || "To review";
  $("#modalBody").innerHTML = `
    <h2 id="modalTitle"${langAttr(j.role)}>${esc(j.role)}</h2>
    <p class="muted">${esc(j.company)} · ${esc(j.location)} · ${esc(j.market)}${j.remote ? " · Remote" : ""} · Fit ${j.fit} · ${esc(j.source)}${j.salary ? " · " + esc(j.salary) : ""}${j.posted ? " · " + esc(j.posted) : ""}</p>
    ${j.notes ? `<p>${esc(j.notes)}</p>` : ""}
    <div class="btnrow">
      <a href="${esc(safeUrl(j.link))}" target="_blank" rel="noopener noreferrer"><button>Open &amp; apply ↗</button></a>
      <label class="inline">Status
        <select id="stSel">${STATUSES.map(s => `<option ${s === st ? "selected" : ""}>${esc(s)}</option>`).join("")}</select>
      </label>
    </div>
    <hr/>
    <h3>Tailored cover letter</h3>
    <div class="btnrow">
      <label class="inline" for="clLen">Length
        <select id="clLen">
          <option value="short">Short</option>
          <option value="standard" selected>Standard</option>
          <option value="detailed">Detailed</option>
        </select>
      </label>
      <label class="inline" for="clTone">Tone
        <select id="clTone">
          <option value="formal" selected>Formal</option>
          <option value="warm">Warm</option>
          <option value="direct">Direct</option>
        </select>
      </label>
      <button id="genCl">✨ Generate with AI</button>
      <button id="copyCl" class="ghost">Copy</button>
      <span id="clMsg" class="muted" aria-live="polite"></span>
    </div>
    <textarea id="clOut" aria-label="Cover letter" placeholder="Pick a length and tone, then Generate (needs an AI key in Settings) — or write your own."></textarea>
    <hr/>
    <h3>Answer bank</h3>
    <div id="ab" class="copyable">${answerBankHtml()}</div>`;
  openModal("#modal");
  $("#stSel").onchange = e => { setStatus(uid, e.target.value); render(); };
  // restore any saved letter and the length/tone it was generated with
  const saved = lettersMap()[uid];
  if (saved) {
    $("#clOut").value = saved.text || "";
    if (saved.length) $("#clLen").value = saved.length;
    if (saved.tone) $("#clTone").value = saved.tone;
    msg("#clMsg", "Saved draft loaded ✓");
  } else {
    msg("#clMsg", clReadiness());
  }
  $("#clLen").onchange = () => persistLetter(uid);
  $("#clTone").onchange = () => persistLetter(uid);
  // persist manual edits too, so a hand-written letter also survives reopening
  $("#clOut").addEventListener("input", debounce(() => persistLetter(uid), 400));
  $("#genCl").onclick = () => genCoverLetter(j, uid);
  $("#copyCl").onclick = async () => {
    try { await navigator.clipboard.writeText($("#clOut").value); msg("#clMsg", "Copied ✓"); }
    catch { $("#clOut").select(); msg("#clMsg", "Press Ctrl/Cmd+C to copy"); }
  };
}

// store/update/remove this job's letter; selects ride along so reopening restores them
function persistLetter(uid) {
  const text = $("#clOut").value;
  const m = lettersMap();
  if (text.trim()) {
    m[uid] = { text, length: $("#clLen").value, tone: $("#clTone").value, ts: Date.now() };
  } else if (m[uid]) {
    delete m[uid];                                   // cleared by hand — don't keep an empty record
  } else { return; }
  saveLetters(m);
}

// plain-English readiness note shown before the first generation
function clReadiness() {
  if (!LLM.cfg().key) return "No AI key set — add a free key in Settings to generate, or write your own below.";
  if (!profile()) return "No profile imported — generation will be grounded only in the role and notes. Import your profile in Settings to personalise it.";
  return "";
}

function answerBankHtml() {
  const p = profile();
  if (!p) return "Import your profile in Settings to see your answer bank here.";
  const a = p.answers || {}, s = p.status || {};
  return esc(Object.entries(a).map(([k, v]) => `• ${k}: ${v}`).join("\n") + "\n\n" +
    Object.entries(s).map(([k, v]) => `• ${k}: ${v}`).join("\n"));
}

const CL_LENGTH = {
  short: "Keep it tight: roughly 120–150 words across two short paragraphs.",
  standard: "Aim for roughly 200–230 words across three paragraphs.",
  detailed: "Allow more room: roughly 300–340 words across three or four paragraphs.",
};
const CL_TONE = {
  formal: "Tone: formal, measured and professional.",
  warm: "Tone: warm and personable, while staying professional.",
  direct: "Tone: direct and confident — lead with concrete impact.",
};
const CL_TEMP = { formal: 0.4, warm: 0.6, direct: 0.45 };

// Build the grounded prompt. Every candidate fact must come from the profile; the model is
// told to use bracketed placeholders rather than invent anything that isn't supplied.
function coverLetterPrompt(j, p, length, tone) {
  const sys =
    "You are an expert cover-letter writer for an engineer. Write in British English. " +
    "Ground every statement strictly in the supplied candidate profile, role, company and notes. " +
    "Never invent employers, job titles, dates, metrics, qualifications or any fact not present in the inputs. " +
    "If a useful detail is missing, leave a clearly bracketed placeholder such as [your relevant experience] rather than fabricating it. " +
    "Avoid clichés, generic filler and flattery. Speak to this specific role and company.";
  const profileBlock = p
    ? `Candidate profile (the ONLY source of facts about the candidate):\n${JSON.stringify(p)}`
    : "No candidate profile was provided. Do not invent any personal history; use bracketed placeholders like [your relevant experience] wherever candidate specifics belong.";
  const usr =
    `${profileBlock}\n\n` +
    `Target role: ${j.role}\nCompany: ${j.company}\nLocation: ${j.location}` +
    `${j.market ? `\nMarket: ${j.market}` : ""}${j.remote ? "\nRemote: yes" : ""}\n` +
    `Role notes (use these to tailor specifics): ${j.notes || "none provided"}\n\n` +
    `${CL_LENGTH[length] || CL_LENGTH.standard}\n${CL_TONE[tone] || CL_TONE.formal}\n` +
    `Write the cover letter only — no preamble, no subject line, no commentary. ` +
    `End with the candidate's name and contact details from the profile if present; otherwise close with a bracketed [Your name] placeholder.`;
  return { sys, usr };
}

async function genCoverLetter(j, uid) {
  const out = $("#clOut"); const p = profile();
  // graceful degradation: no key means no generation — say so plainly, don't fire a doomed request
  if (!LLM.cfg().key) {
    out.value = "⚠ No AI key set.\n\nOpen Settings and add a free key (Groq / Gemini / OpenRouter) to generate a tailored letter. You can also write your own here — it will be saved for this role.";
    msg("#clMsg", "No AI key — see Settings.");
    return;
  }
  const length = $("#clLen").value, tone = $("#clTone").value;
  out.value = "Generating…";
  msg("#clMsg", p ? "Working…" : "No profile — keeping it grounded, with placeholders for your details…");
  try {
    const { sys, usr } = coverLetterPrompt(j, p, length, tone);
    out.value = await LLM.chat(sys, usr, { temperature: CL_TEMP[tone] ?? 0.5 });
    persistLetter(uid);                              // keep the generated draft for next time
    msg("#clMsg", "Generated ✓ — saved for this role.");
  } catch (e) {
    out.value = "⚠ " + e.message + "\n\nOpen Settings to check your free AI key (Groq / Gemini / OpenRouter).";
    msg("#clMsg", "Generation failed.");
  }
}

// Export ONLY applied roles, UTF-8 BOM for Excel, neutralise CSV formula injection.
function exportCsv() {
  const m = statusMap();
  const applied = JOBS.filter(j => (m[key(j)] || "To review") === "Applied");
  if (!applied.length) return msgStatus("Nothing marked Applied yet.");
  const safe = c => { let v = String(c ?? ""); if (/^[=+\-@]/.test(v)) v = "'" + v; return `"${v.replace(/"/g, '""')}"`; };
  const rows = [["role", "company", "location", "market", "remote", "fit", "status", "link"]];
  applied.forEach(j => rows.push([j.role, j.company, j.location, j.market, j.remote ? "yes" : "no", j.fit, "Applied", j.link]));
  const csv = "﻿" + rows.map(r => r.map(safe).join(",")).join("\r\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  a.download = "applied-jobs.csv"; a.click();
}

// Back up the full status map as JSON so a user can restore their pipeline after clearing
// the browser, switching machines, or a storage wipe. uid-keyed throughout (same keys as on
// disk), wrapped in a small envelope so import can recognise and validate the file.
function exportStatusJson() {
  const m = statusMap();
  const payload = {
    meta: { app: "job-hunt-studio", kind: "status-backup", version: 1, exported: new Date().toISOString() },
    status: m,
  };
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
  a.download = "job-status-backup.json"; a.click();
  const n = Object.keys(m).length;
  notify(`Backed up ${n} tracked role${n === 1 ? "" : "s"} (JSON).`);
}

// Restore from a status backup. Merges onto current status (non-destructive), accepts either the
// wrapped envelope or a bare uid→status map, and validates every entry: keys stay uid strings and
// values must be a known status. Prunes to live jobs so a stale backup can't resurrect dead keys.
async function importStatusJson(file) {
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    const incoming = parsed && typeof parsed.status === "object" && parsed.status ? parsed.status : parsed;
    if (!incoming || typeof incoming !== "object" || Array.isArray(incoming)) throw new Error("not a status map");
    const m = statusMap();
    let n = 0;
    for (const [k, v] of Object.entries(incoming)) {
      if (typeof k === "string" && k && typeof v === "string" && STATUSES.includes(v)) { m[k] = v; n++; }
    }
    if (!n) { notify("⚠ No valid statuses found in that file."); return; }
    if (!saveStatus(m)) return;                        // lsWrite already surfaced the quota note
    pruneStatus();                                     // drop any entries for jobs not on this board
    render();
    notify(`Restored ${n} status${n === 1 ? "" : "es"} from backup.`);
  } catch (e) {
    notify("⚠ Invalid status backup — expected a JSON status map.");
    console.error("status import failed:", e);
  }
}

function wireSettings() {
  $("#settingsBtn").onclick = () => {
    const c = LLM.cfg();
    $("#llmProvider").value = c.provider || "groq";
    $("#llmKey").value = c.key || ""; $("#llmModel").value = c.model || "";
    $("#profileState").textContent = profile() ? "Profile loaded ✓" : "No profile loaded.";
    openModal("#settings");
  };
  $("#saveLlm").onclick = () => {
    LLM.save({ provider: $("#llmProvider").value, key: $("#llmKey").value.trim(), model: $("#llmModel").value.trim() });
    msg("#profileState", "AI settings saved (this browser only) ✓");
  };
  $("#profileFile").onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const parsed = JSON.parse(await f.text());                      // validate JSON before we touch storage
      if (lsWrite("jobapply_profile", JSON.stringify(parsed))) { msg("#profileState", "Profile loaded ✓"); render(); }
    } catch { msg("#profileState", "⚠ Invalid JSON file."); }
  };
  $("#clearProfile").onclick = () => { localStorage.removeItem("jobapply_profile"); msg("#profileState", "Cleared."); render(); };
}

// First-run hint: reveal once, then remember the dismissal so it never nags a returning user.
function wireHint() {
  const banner = $("#hint"); if (!banner) return;
  if (localStorage.getItem("jobapply_hint_dismissed") !== "1") banner.classList.remove("hidden");
  $("#hintDismiss").onclick = () => {
    lsWrite("jobapply_hint_dismissed", "1");            // best-effort; hide regardless of storage state
    banner.classList.add("hidden");
  };
}

// Modal a11y: focus trap, Esc, backdrop click, focus return.
function wireModals() {
  $$("[data-close]").forEach(b => b.onclick = () => closeModal("#modal"));
  $$("[data-close-settings]").forEach(b => b.onclick = () => closeModal("#settings"));
  $$(".modal").forEach(mod => mod.addEventListener("click", e => { if (e.target === mod) closeModal("#" + mod.id); }));
  document.addEventListener("keydown", e => {
    const open = $(".modal:not(.hidden)"); if (!open) return;
    if (e.key === "Escape") closeModal("#" + open.id);
    if (e.key === "Tab") trapTab(e, open);
  });
}
function openModal(sel) {
  lastFocus = document.activeElement;
  $(sel).classList.remove("hidden");
  const f = $(sel).querySelector("button, a, select, input, textarea"); if (f) f.focus();
}
function closeModal(sel) { $(sel).classList.add("hidden"); if (lastFocus) lastFocus.focus(); }
function trapTab(e, mod) {
  const f = [...mod.querySelectorAll("button, a[href], select, input, textarea")].filter(x => !x.disabled && x.offsetParent !== null);
  if (!f.length) return;
  const first = f[0], last = f[f.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

const msg = (sel, t) => { const e = $(sel); if (e) { e.textContent = t; } };
const msgStatus = t => { const e = $("#count"); if (e) e.textContent = t; };
boot();
