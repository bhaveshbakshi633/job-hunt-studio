// Provider-agnostic LLM client. Key lives in localStorage only; calls go straight
// to the provider from the browser. Free tiers: Groq, Google Gemini, OpenRouter.
const LLM = {
  cfg() {
    return JSON.parse(localStorage.getItem("jobapply_llm") || "{}");
  },
  save(cfg) {
    localStorage.setItem("jobapply_llm", JSON.stringify(cfg));
  },
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
      const url = `${d.url}/${model}:generateContent?key=${encodeURIComponent(c.key)}`;
      const r = await fetch(url, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: system + "\n\n" + user }] }] }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error?.message || "Gemini error");
      return j.candidates?.[0]?.content?.parts?.[0]?.text || "(empty)";
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
    const j = await r.json();
    if (!r.ok) throw new Error(j.error?.message || "LLM error");
    return j.choices?.[0]?.message?.content || "(empty)";
  },
};
