// Wide Worker — brain bridge for webclaw on Windows (zero-dependency, Node 18+).
//
// webclaw delegates non-marker instructions to a "brain" at BRAIN_URL/brain/exec.
// This bridge serves that endpoint on the Windows box using, in order:
//   1) the local Claude Code CLI (subscription — no API key needed), or
//   2) api.baryon.ai (Anthropic-compatible /v1/messages, BARYON_API_KEY).
//
// Run:  node brain-bridge.mjs          (or start.cmd)
// Env:  PORT=4111  BRAIN_TOKEN=...     (optional bearer auth, matches the
//       "Brain token" field in the webclaw popup)
//       CLAUDE_BIN=claude              BARYON_API_URL=https://api.baryon.ai
//       BARYON_API_KEY=...             BARYON_MODEL=claude-sonnet-5
import http from "node:http";
import { spawn } from "node:child_process";

const PORT = Number(process.env.PORT ?? 4111);
const TOKEN = process.env.BRAIN_TOKEN ?? "";
const CLAUDE_BIN = process.env.CLAUDE_BIN ?? "claude";
const BARYON_URL = (process.env.BARYON_API_URL ?? "https://api.baryon.ai").replace(/\/$/, "");
const BARYON_KEY = process.env.BARYON_API_KEY ?? "";
const BARYON_MODEL = process.env.BARYON_MODEL ?? "claude-sonnet-5";
const CLAUDE_TIMEOUT_MS = Number(process.env.CLAUDE_TIMEOUT_MS ?? 120_000);

// --- backend 1: Claude Code CLI (subscription) -----------------------------
function askClaude(prompt) {
  return new Promise((resolve, reject) => {
    // -p: print-and-exit; text output; tools disallowed so it's a pure LLM call.
    const proc = spawn(CLAUDE_BIN, ["-p", prompt, "--output-format", "text"], {
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32", // resolve claude.cmd shims on Windows
    });
    let out = "", err = "";
    const t = setTimeout(() => { try { proc.kill(); } catch {} ; reject(new Error("claude timeout")); }, CLAUDE_TIMEOUT_MS);
    proc.stdout.on("data", (d) => (out += d));
    proc.stderr.on("data", (d) => (err += d));
    proc.on("error", (e) => { clearTimeout(t); reject(e); });
    proc.on("close", (code) => {
      clearTimeout(t);
      if (code === 0 && out.trim()) resolve(out.trim());
      else reject(new Error("claude exit " + code + ": " + err.slice(0, 300)));
    });
  });
}

// --- backend 2: api.baryon.ai (Anthropic-compatible) ------------------------
async function askBaryon(prompt) {
  if (!BARYON_KEY) throw new Error("BARYON_API_KEY not set");
  const r = await fetch(BARYON_URL + "/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": BARYON_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: BARYON_MODEL,
      max_tokens: 2048,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!r.ok) throw new Error("baryon " + r.status + ": " + (await r.text()).slice(0, 300));
  const j = await r.json();
  const text = (j.content ?? []).map((c) => c.text ?? "").join("").trim();
  if (!text) throw new Error("baryon empty response");
  return text;
}

async function exec(prompt) {
  try {
    return { output: await askClaude(prompt), backend: "claude-cli" };
  } catch (e1) {
    try {
      return { output: await askBaryon(prompt), backend: "baryon-api" };
    } catch (e2) {
      throw new Error("all backends failed — claude: " + e1.message + " | baryon: " + e2.message);
    }
  }
}

// --- probes (for /health) ----------------------------------------------------
function probeClaude() {
  return new Promise((resolve) => {
    const proc = spawn(CLAUDE_BIN, ["--version"], { stdio: ["ignore", "pipe", "pipe"], shell: process.platform === "win32" });
    let out = "";
    proc.stdout.on("data", (d) => (out += d));
    proc.on("error", () => resolve(null));
    proc.on("close", (c) => resolve(c === 0 ? out.trim() : null));
  });
}

// --- HTTP server --------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  // CORS: the webclaw offscreen document fetches from a chrome-extension origin.
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-headers", "content-type, authorization");
  res.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  const json = (code, obj) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };

  if (req.method === "GET" && req.url === "/health") {
    const claude = await probeClaude();
    return json(200, { ok: true, service: "wide-worker", version: "0.1.0", backends: { "claude-cli": claude ?? false, "baryon-api": BARYON_KEY ? BARYON_URL : false } });
  }

  if (req.method === "POST" && req.url === "/brain/exec") {
    if (TOKEN) {
      const auth = req.headers["authorization"] ?? "";
      if (auth !== "Bearer " + TOKEN) return json(401, { error: "unauthorized" });
    }
    let body = "";
    req.on("data", (d) => { body += d; if (body.length > 1_000_000) req.destroy(); });
    req.on("end", async () => {
      try {
        const { prompt } = JSON.parse(body || "{}");
        if (!prompt) return json(400, { error: "prompt required" });
        console.log("[exec]", String(prompt).slice(0, 80));
        const r = await exec(String(prompt));
        console.log("[done]", r.backend, String(r.output).slice(0, 80));
        json(200, r);
      } catch (e) {
        console.error("[fail]", e.message);
        json(500, { error: String(e.message ?? e) });
      }
    });
    return;
  }

  json(404, { error: "not found — use GET /health or POST /brain/exec {prompt}" });
});

server.listen(PORT, () => {
  console.log(`wide-worker brain bridge listening on http://0.0.0.0:${PORT}`);
  console.log(`  webclaw popup → Brain URL: http://<this-pc-ip>:${PORT}` + (TOKEN ? " (+ Brain token)" : ""));
  console.log(`  backends: claude-cli(${CLAUDE_BIN}) → baryon(${BARYON_KEY ? BARYON_URL : "unset"})`);
});
