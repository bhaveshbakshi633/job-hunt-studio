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
const saveStatus = m => localStorage.setItem("jobapply_status", JSON.stringify(m));
const setStatus = (k, s) => { const m = statusMap(); m[k] = s; saveStatus(m); };
const profile = () => JSON.parse(localStorage.getItem("jobapply_profile") || "null");
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const safeUrl = u => { try { const x = new URL(u); return (x.protocol === "http:" || x.protocol === "https:") ? u : "#"; } catch { return "#"; } };
const debounce = (fn, ms = 160) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

async function boot() {
  const grid = $("#grid");
  try {
    const res = await fetch("data/jobs.json");
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
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
  pruneStatus();
  [...new Set(JOBS.map(j => j.market))].sort().forEach(m => {
    const o = document.createElement("option"); o.value = o.textContent = m; $("#market").appendChild(o);
  });
  $("#search").addEventListener("input", debounce(render));
  ["market", "fit", "status", "sort"].forEach(id => $("#" + id).addEventListener("change", render));
  $("#exportBtn").onclick = exportCsv;
  // event delegation — one listener for the whole grid (keyboard + mouse)
  $("#grid").addEventListener("click", e => { const c = e.target.closest(".card"); if (c) openJob(c.dataset.uid); });
  wireSettings(); wireModals();
  render();
}

// drop saved statuses whose jobs no longer exist (keeps localStorage clean)
function pruneStatus() {
  const live = new Set(JOBS.map(key));
  const m = statusMap(); let changed = false;
  for (const k of Object.keys(m)) if (!live.has(k)) { delete m[k]; changed = true; }
  if (changed) saveStatus(m);
}

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
  const grid = $("#grid");
  grid.setAttribute("aria-busy", "false");
  grid.innerHTML = rows.length ? rows.map(j => card(j, m)).join("")
    : `<div class="empty"><p>No roles match these filters.</p></div>`;
}

function card(j, m) {
  const st = m[key(j)] || "To review";
  return `<button class="card fitedge${j.fit}" data-uid="${esc(key(j))}" aria-label="${esc(j.role)} at ${esc(j.company)}">
    <span class="fitbadge fit${j.fit}">${j.fit}</span>
    <h3>${esc(j.role)}</h3>
    <div class="co">${esc(j.company)} · ${esc(j.location)}</div>
    <div class="row">
      <span class="meta">${esc(j.market)}</span>
      ${j.remote ? `<span class="meta remote">Remote</span>` : ""}
      <span class="meta">${esc(j.source)}</span>
      ${j.salary ? `<span class="meta">${esc(j.salary)}</span>` : ""}
      <span class="status st-${st.replace(/\s/g, "")}">${esc(st)}</span>
    </div></button>`;
}

function openJob(uid) {
  const j = JOBS.find(x => key(x) === uid);
  if (!j) return;
  const st = statusMap()[uid] || "To review";
  $("#modalBody").innerHTML = `
    <h2 id="modalTitle">${esc(j.role)}</h2>
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
      <button id="genCl">✨ Generate with AI</button>
      <button id="copyCl" class="ghost">Copy</button>
      <span id="clMsg" class="muted"></span>
    </div>
    <textarea id="clOut" aria-label="Cover letter" placeholder="Click Generate (needs an AI key in Settings) — or write your own."></textarea>
    <hr/>
    <h3>Answer bank</h3>
    <div id="ab" class="copyable">${answerBankHtml()}</div>`;
  openModal("#modal");
  $("#stSel").onchange = e => { setStatus(uid, e.target.value); render(); };
  $("#genCl").onclick = () => genCoverLetter(j);
  $("#copyCl").onclick = async () => {
    try { await navigator.clipboard.writeText($("#clOut").value); msg("#clMsg", "Copied ✓"); }
    catch { $("#clOut").select(); msg("#clMsg", "Press Ctrl/Cmd+C to copy"); }
  };
}

function answerBankHtml() {
  const p = profile();
  if (!p) return "Import your profile in Settings to see your answer bank here.";
  const a = p.answers || {}, s = p.status || {};
  return esc(Object.entries(a).map(([k, v]) => `• ${k}: ${v}`).join("\n") + "\n\n" +
    Object.entries(s).map(([k, v]) => `• ${k}: ${v}`).join("\n"));
}

async function genCoverLetter(j) {
  const out = $("#clOut"); const p = profile();
  out.value = "Generating…";
  try {
    const sys = "You write concise, specific, non-generic cover letters (max 230 words) for an engineer. Use only facts provided. British spelling, sober tone.";
    const usr = `Candidate profile:\n${JSON.stringify(p || { note: "no profile imported — keep it generic" })}\n\n` +
      `Role: ${j.role} at ${j.company} (${j.location}). Write a tailored cover letter. End with name and contact from the profile if present.`;
    out.value = await LLM.chat(sys, usr);
  } catch (e) {
    out.value = "⚠ " + e.message + "\n\nOpen Settings to add a free AI key (Groq / Gemini / OpenRouter).";
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
    try { localStorage.setItem("jobapply_profile", JSON.stringify(JSON.parse(await f.text()))); msg("#profileState", "Profile loaded ✓"); render(); }
    catch { msg("#profileState", "⚠ Invalid JSON file."); }
  };
  $("#clearProfile").onclick = () => { localStorage.removeItem("jobapply_profile"); msg("#profileState", "Cleared."); render(); };
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
