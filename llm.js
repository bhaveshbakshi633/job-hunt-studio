// Provider-agnostic LLM client. Key lives in localStorage only; calls go straight
// to the provider from the browser. Free tiers: Groq, Google Gemini, OpenRouter.
const LLM = {
  cfg() { return JSON.parse(localStorage.getItem("jobapply_llm") || "{}"); },
  save(cfg) { localStorage.setItem("jobapply_llm", JSON.stringify(cfg)); },
  defaults: {
    groq: { url: "https://api.groq.com/openai/v1/chat/completions", model: "llama-3.3-70b-versatile" },
    openrouter: { url: "https://openrouter.ai/api/v1/chat/completions", model: "meta-llama/llama-3.3-70b-instruct:free" },
    gemini: { url: "https://generativelanguage.googleapis.com/v1beta/models", model: "gemini-2.0-flash" },
  },
  async chat(system, user) {
    const c = this.cfg();
    if (!c.key) throw new Error("No API key set — open Settings and add a free key.");
    const provider = c.provider || "groq";
    const d = this.defaults[provider];
    const model = c.model || d.model;

    if (provider === "gemini") {
      // key in a header, never the URL (URLs leak via history/referrer/logs)
      const r = await fetch(`${d.url}/${model}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": c.key },
        body: JSON.stringify({ contents: [{ parts: [{ text: system + "\n\n" + user }] }] }),
      });
      if (!r.ok) throw new Error(await this._err(r));   // check status BEFORE parsing
      const j = await r.json();
      return j.candidates?.[0]?.content?.parts?.[0]?.text || "(empty response)";
    }

    // OpenAI-compatible (Groq, OpenRouter)
    const r = await fetch(d.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${c.key}` },
      body: JSON.stringify({
        model,
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
        temperature: 0.5,
      }),
    });
    if (!r.ok) throw new Error(await this._err(r));
    const j = await r.json();
    return j.choices?.[0]?.message?.content || "(empty response)";
  },
  async _err(r) {
    let detail = "";
    try { const j = await r.json(); detail = j.error?.message || JSON.stringify(j.error || j); }
    catch { detail = (await r.text()).slice(0, 160); }
    if (r.status === 429) return `Rate limited (429) — free tier throttled, wait a moment.`;
    if (r.status === 401 || r.status === 403) return `Auth failed (${r.status}) — check your API key.`;
    return `Request failed (${r.status}). ${detail}`;
  },
};
