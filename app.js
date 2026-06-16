// Job Hunt Studio — loads jobs.json, tracks status in localStorage, tailors
// cover letters with your chosen free LLM. No backend; runs anywhere.
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const STATUSES = ["To review", "To apply", "Applied", "Interview", "Offer", "Rejected", "Skip"];

let JOBS = [];
const statusMap = () => JSON.parse(localStorage.getItem("jobapply_status") || "{}");
const setStatus = (id, s) => { const m = statusMap(); m[id] = s; localStorage.setItem("jobapply_status", JSON.stringify(m)); };
const profile = () => JSON.parse(localStorage.getItem("jobapply_profile") || "null");

async function boot() {
  try {
    const res = await fetch("data/jobs.json");
    const data = await res.json();
    JOBS = data.jobs || [];
  } catch (e) {
    $("#grid").innerHTML = `<p class="muted">Could not load data/jobs.json (${e}). If opening the file directly, run a local server: <code>python3 -m http.server</code> in /docs.</p>`;
    return;
  }
  const markets = [...new Set(JOBS.map(j => j.market))];
  markets.forEach(m => { const o = document.createElement("option"); o.value = o.textContent = m; $("#market").appendChild(o); });
  ["search", "market", "fit", "status"].forEach(id => $("#" + id).addEventListener("input", render));
  $("#exportBtn").onclick = exportCsv;
  wireSettings();
  render();
}

function render() {
  const q = $("#search").value.toLowerCase();
  const fM = $("#market").value, fF = $("#fit").value, fS = $("#status").value;
  const m = statusMap();
  const rows = JOBS.filter(j => {
    const st = m[j.id] || "To review";
    return (!q || (j.role + j.company).toLowerCase().includes(q)) &&
           (!fM || j.market === fM) && (!fF || j.fit === fF) && (!fS || st === fS);
  });
  const counts = JOBS.reduce((a, j) => { const s = m[j.id] || "To review"; a[s] = (a[s] || 0) + 1; return a; }, {});
  $("#stats").innerHTML = `<span><b>${JOBS.length}</b> roles</span>
    <span><b>${counts["Applied"] || 0}</b> applied</span>
    <span><b>${counts["To apply"] || 0}</b> queued</span>
    <span><b>${JOBS.filter(j => j.fit === "A").length}</b> A-fits</span>
    <span>${profile() ? "profile ✓" : "no profile"}</span>`;
  $("#grid").innerHTML = rows.map(card).join("") || `<p class="muted">No matches.</p>`;
  $$(".card").forEach(c => c.onclick = () => openJob(+c.dataset.id));
}

function card(j) {
  const st = statusMap()[j.id] || "To review";
  return `<div class="card" data-id="${j.id}">
    <h3>${esc(j.role)}</h3>
    <div class="co">${esc(j.company)} · ${esc(j.location)}</div>
    <div class="row">
      <span class="tag fit${j.fit}">Fit ${j.fit}</span>
      <span class="tag">${esc(j.market)}</span>
      <span class="tag">${esc(j.source)}</span>
      ${j.salary ? `<span class="tag">${esc(j.salary)}</span>` : ""}
      <span class="tag st">${esc(st)}</span>
    </div></div>`;
}

function openJob(id) {
  const j = JOBS.find(x => x.id === id);
  const st = statusMap()[id] || "To review";
  $("#modalBody").innerHTML = `
    <h2>${esc(j.role)}</h2>
    <p class="muted">${esc(j.company)} · ${esc(j.location)} · ${esc(j.market)} · Fit ${j.fit} · ${esc(j.source)} ${j.salary ? "· " + esc(j.salary) : ""} · ${esc(j.posted)}</p>
    ${j.notes ? `<p>${esc(j.notes)}</p>` : ""}
    <div class="btnrow">
      <a href="${j.link}" target="_blank" rel="noopener"><button>↗ Open & apply</button></a>
      <label style="margin:0">Status
        <select id="stSel">${STATUSES.map(s => `<option ${s === st ? "selected" : ""}>${s}</option>`).join("")}</select>
      </label>
    </div>
    <hr/>
    <h3>Tailored cover letter</h3>
    <div class="btnrow">
      <button id="genCl">✨ Generate with AI</button>
      <button id="copyCl" class="ghost">Copy</button>
    </div>
    <textarea id="clOut" placeholder="Click Generate (needs an AI key in Settings) — or write your own."></textarea>
    <hr/>
    <h3>Answer bank</h3>
    <div id="ab" class="copyable">${answerBankHtml()}</div>`;
  show("#modal");
  $("#stSel").onchange = e => { setStatus(id, e.target.value); render(); };
  $("#genCl").onclick = () => genCoverLetter(j);
  $("#copyCl").onclick = () => navigator.clipboard.writeText($("#clOut").value);
}

function answerBankHtml() {
  const p = profile();
  if (!p) return "Import your profile in Settings to see your answer bank here.";
  const a = p.answers || {};
  const s = p.status || {};
  return esc(Object.entries(a).map(([k, v]) => `• ${k}: ${v}`).join("\n") +
    "\n\n" + Object.entries(s).map(([k, v]) => `• ${k}: ${v}`).join("\n"));
}

async function genCoverLetter(j) {
  const out = $("#clOut");
  const p = profile();
  out.value = "Generating…";
  try {
    const sys = "You write concise, specific, non-generic cover letters (max 230 words) for an engineer. Use only facts provided. British spelling, sober tone.";
    const usr = `Candidate profile:\n${JSON.stringify(p || { note: "no profile imported — keep it generic" })}\n\n` +
      `Role: ${j.role} at ${j.company} (${j.location}). Write a tailored cover letter. End with name and contact from the profile if present.`;
    out.value = await LLM.chat(sys, usr);
  } catch (e) {
    out.value = "⚠ " + e.message + "\n\nOpen Settings to add a free AI key (Groq/Gemini/OpenRouter).";
  }
}

function exportCsv() {
  const m = statusMap();
  const rows = [["role", "company", "location", "market", "fit", "status", "link"]];
  JOBS.forEach(j => rows.push([j.role, j.company, j.location, j.market, j.fit, m[j.id] || "To review", j.link]));
  const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  a.download = "job-hunt-export.csv"; a.click();
}

function wireSettings() {
  $("#settingsBtn").onclick = () => {
    const c = LLM.cfg();
    $("#llmProvider").value = c.provider || "groq";
    $("#llmKey").value = c.key || "";
    $("#llmModel").value = c.model || "";
    $("#profileState").textContent = profile() ? "Profile loaded ✓" : "No profile loaded.";
    show("#settings");
  };
  $("#saveLlm").onclick = () => {
    LLM.save({ provider: $("#llmProvider").value, key: $("#llmKey").value.trim(), model: $("#llmModel").value.trim() });
    alert("AI settings saved (this browser only).");
  };
  $("#profileFile").onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try { const p = JSON.parse(await f.text()); localStorage.setItem("jobapply_profile", JSON.stringify(p)); $("#profileState").textContent = "Profile loaded ✓"; render(); }
    catch { alert("Invalid JSON."); }
  };
  $("#clearProfile").onclick = () => { localStorage.removeItem("jobapply_profile"); $("#profileState").textContent = "Cleared."; render(); };
  $$("[data-close]").forEach(b => b.onclick = () => hide("#modal"));
  $$("[data-close-settings]").forEach(b => b.onclick = () => hide("#settings"));
}

const show = s => $(s).classList.remove("hidden");
const hide = s => $(s).classList.add("hidden");
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
boot();
