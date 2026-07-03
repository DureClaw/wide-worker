// Wide Worker — single entry point for the SEA exe (launcher + brain in one).
// Assets (extension/, chrome/) are resolved next to the exe, not next to this
// source, because in a SEA build there is no real source file on disk.
import http from "node:http";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, writeFileSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Assets (extension/, chrome/) sit next to this entry file. Under caxa the
// file extracts to a temp dir and app.mjs runs from there with its siblings, so
// import.meta.dirname is correct in every mode (plain node, caxa exe).
const here = fileURLToPath(new URL(".", import.meta.url));
const ROOT = here.replace(/[\\/]$/, "");

const PORT = Number(process.env.PORT ?? 4111);
const TOKEN = process.env.BRAIN_TOKEN ?? "";
const CLAUDE_BIN = process.env.CLAUDE_BIN ?? "claude";
const BARYON_URL = (process.env.BARYON_API_URL ?? "https://api.baryon.ai").replace(/\/$/, "");
const BARYON_KEY = process.env.BARYON_API_KEY ?? "";
const BARYON_MODEL = process.env.BARYON_MODEL ?? "claude-sonnet-5";
const PROFILE = join(ROOT, "profile");
const EXT = join(ROOT, "extension");

// ---------- brain backends ----------
function askClaude(prompt) {
  return new Promise((resolve, reject) => {
    const proc = spawn(CLAUDE_BIN, ["-p", prompt, "--output-format", "text"], {
      stdio: ["ignore", "pipe", "pipe"], shell: process.platform === "win32",
    });
    let out = "", err = "";
    const t = setTimeout(() => { try { proc.kill(); } catch {} reject(new Error("claude timeout")); }, 120_000);
    proc.stdout.on("data", (d) => (out += d));
    proc.stderr.on("data", (d) => (err += d));
    proc.on("error", (e) => { clearTimeout(t); reject(e); });
    proc.on("close", (c) => { clearTimeout(t); c === 0 && out.trim() ? resolve(out.trim()) : reject(new Error("claude exit " + c + ": " + err.slice(0, 200))); });
  });
}
async function askBaryon(prompt) {
  if (!BARYON_KEY) throw new Error("BARYON_API_KEY not set");
  const r = await fetch(BARYON_URL + "/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": BARYON_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: BARYON_MODEL, max_tokens: 2048, messages: [{ role: "user", content: prompt }] }),
  });
  if (!r.ok) throw new Error("baryon " + r.status + ": " + (await r.text()).slice(0, 200));
  const j = await r.json();
  const text = (j.content ?? []).map((c) => c.text ?? "").join("").trim();
  if (!text) throw new Error("baryon empty");
  return text;
}
async function exec(prompt) {
  try { return { output: await askClaude(prompt), backend: "claude-cli" }; }
  catch (e1) { try { return { output: await askBaryon(prompt), backend: "baryon-api" }; }
    catch (e2) { throw new Error("claude: " + e1.message + " | baryon: " + e2.message); } }
}
function probeClaude() {
  return new Promise((res) => {
    const p = spawn(CLAUDE_BIN, ["--version"], { stdio: ["ignore", "pipe", "pipe"], shell: process.platform === "win32" });
    let o = ""; p.stdout.on("data", (d) => (o += d)); p.on("error", () => res(null)); p.on("close", (c) => res(c === 0 ? o.trim() : null));
  });
}

// ---------- brain HTTP server ----------
function startBrain() {
  const server = http.createServer(async (req, res) => {
    res.setHeader("access-control-allow-origin", "*");
    res.setHeader("access-control-allow-headers", "content-type, authorization");
    res.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
    if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }
    const json = (c, o) => { res.writeHead(c, { "content-type": "application/json" }); res.end(JSON.stringify(o)); };
    if (req.method === "GET" && req.url === "/health") {
      const claude = await probeClaude();
      return json(200, { ok: true, service: "wide-worker", version: "0.1.0", backends: { "claude-cli": claude ?? false, "baryon-api": BARYON_KEY ? BARYON_URL : false } });
    }
    if (req.method === "POST" && req.url === "/brain/exec") {
      if (TOKEN) { if ((req.headers["authorization"] ?? "") !== "Bearer " + TOKEN) return json(401, { error: "unauthorized" }); }
      let body = ""; req.on("data", (d) => { body += d; if (body.length > 1e6) req.destroy(); });
      req.on("end", async () => {
        try {
          const { prompt } = JSON.parse(body || "{}");
          if (!prompt) return json(400, { error: "prompt required" });
          console.log("[exec]", String(prompt).slice(0, 70));
          json(200, await exec(String(prompt)));
        } catch (e) { console.error("[fail]", e.message); json(500, { error: String(e.message ?? e) }); }
      });
      return;
    }
    json(404, { error: "use GET /health or POST /brain/exec" });
  });
  server.listen(PORT, async () => {
    console.log(`wide-worker brain on http://localhost:${PORT}`);
    let ok = false; try { await askClaude("Reply with exactly: OK"); ok = true; } catch {}
    if (ok) console.log("  ✅ brain ready — claude-cli");
    else if (BARYON_KEY) console.log("  ✅ brain ready — baryon-api");
    else console.log("  ⚠️  두뇌 미준비: BARYON_API_KEY 를 config.local.json 에 넣으세요 (claude -p 는 구독 headless 미지원).");
  });
}

// ---------- Chromium launcher ----------
function findChromium() {
  if (process.env.CHROMIUM_PATH && existsSync(process.env.CHROMIUM_PATH)) return process.env.CHROMIUM_PATH;
  const base = join(ROOT, "chrome");
  if (!existsSync(base)) return null;
  const exe = process.platform === "win32" ? "chrome.exe" : "chrome";
  const isDir = (p) => { try { return statSync(p).isDirectory(); } catch { return false; } };
  for (const d of readdirSync(base)) {
    if (!isDir(join(base, d))) continue;
    for (const inner of readdirSync(join(base, d))) {
      if (!isDir(join(base, d, inner))) continue;
      const p = join(base, d, inner, exe);
      if (existsSync(p)) return p;
    }
  }
  return null;
}
function seedConfig() {
  writeFileSync(join(EXT, "config.local.json"), JSON.stringify({
    bus: "", brainUrl: `http://localhost:${PORT}`, brainToken: TOKEN, name: "wideworker@local", standalone: true,
  }, null, 2));
}

// ---------- main ----------
startBrain();
const chromium = findChromium();
if (!chromium) {
  console.error("Chromium 없음 — install 시 chrome/ 폴더가 exe 옆에 있어야 합니다.");
} else {
  if (!existsSync(PROFILE)) mkdirSync(PROFILE, { recursive: true });
  seedConfig();
  console.log("chromium:", chromium);
  setTimeout(() => {
    const b = spawn(chromium, [
      `--user-data-dir=${PROFILE}`, `--load-extension=${EXT}`, `--disable-extensions-except=${EXT}`,
      "--no-first-run", "--no-default-browser-check", "--start-maximized", "https://www.google.com",
    ], { stdio: "ignore" });
    b.on("close", () => process.exit(0));
    console.log("  브라우저 실행 — webclaw 로드됨");
  }, 800);
}
process.on("SIGINT", () => process.exit(0));
