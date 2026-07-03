// Wide Worker — single entry point for the SEA exe (launcher + brain in one).
// Assets (extension/, chrome/) are resolved next to the exe, not next to this
// source, because in a SEA build there is no real source file on disk.
import http from "node:http";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, writeFileSync, statSync, readFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

// Assets (extension/, chrome/) sit next to this entry file. Under caxa the
// file extracts to a temp dir and app.mjs runs from there with its siblings, so
// import.meta.dirname is correct in every mode (plain node, caxa exe).
const here = fileURLToPath(new URL(".", import.meta.url));
const ROOT = here.replace(/[\\/]$/, "");

const PORT = Number(process.env.PORT ?? 4111);
const TOKEN = process.env.BRAIN_TOKEN ?? "";
const CLAUDE_BIN = process.env.CLAUDE_BIN ?? "claude";
const CODEX_BIN = process.env.CODEX_BIN ?? "codex";
const BARYON_URL = (process.env.BARYON_API_URL ?? "https://api.baryon.ai").replace(/\/$/, "");
const BARYON_KEY = process.env.BARYON_API_KEY ?? "";
const BARYON_MODEL = process.env.BARYON_MODEL ?? "claude-sonnet-5";
// Backend order: which subscriptions to try, in order. All three by default.
const CHAIN = (process.env.WW_BACKENDS ?? "claude,codex,baryon").split(",").map((s) => s.trim()).filter(Boolean);
const PROFILE = join(ROOT, "profile");
const EXT = join(ROOT, "extension");

// ---------- brain backends ----------
// Pass the prompt over stdin, never as a CLI arg — with shell:true on Windows a
// prompt with spaces gets re-split by cmd into multiple args ("unexpected
// argument"). Both claude and codex read instructions from stdin.
function askClaude(prompt) {
  return new Promise((resolve, reject) => {
    const proc = spawn(CLAUDE_BIN, ["-p", "--output-format", "text"], {
      stdio: ["pipe", "pipe", "pipe"], shell: process.platform === "win32",
    });
    let out = "", err = "";
    const t = setTimeout(() => { try { proc.kill(); } catch {} reject(new Error("claude timeout")); }, 120_000);
    proc.stdout.on("data", (d) => (out += d));
    proc.stderr.on("data", (d) => (err += d));
    proc.on("error", (e) => { clearTimeout(t); reject(e); });
    proc.on("close", (c) => { clearTimeout(t); c === 0 && out.trim() ? resolve(out.trim()) : reject(new Error("claude exit " + c + ": " + err.slice(0, 200))); });
    proc.stdin.write(prompt); proc.stdin.end();
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
// backend 2: Codex CLI (ChatGPT subscription). Runs non-interactively and
// writes only the final assistant message to a file (--output-last-message),
// which avoids parsing the streaming log.
function askCodex(prompt) {
  return new Promise((resolve, reject) => {
    const outFile = join(tmpdir(), `ww-codex-${Date.now()}.txt`);
    // "-" → read the prompt from stdin (avoids the shell arg-splitting issue)
    const args = ["exec", "--skip-git-repo-check", "--ephemeral", "-s", "read-only",
      "--output-last-message", outFile, "-"];
    const proc = spawn(CODEX_BIN, args, { stdio: ["pipe", "ignore", "pipe"], shell: process.platform === "win32" });
    let err = "";
    const t = setTimeout(() => { try { proc.kill(); } catch {} reject(new Error("codex timeout")); }, 150_000);
    proc.stderr.on("data", (d) => (err += d));
    proc.on("error", (e) => { clearTimeout(t); reject(e); });
    proc.stdin.write(prompt); proc.stdin.end();
    proc.on("close", () => {
      clearTimeout(t);
      try {
        const out = readFileSync(outFile, "utf8").trim();
        try { rmSync(outFile); } catch {}
        out ? resolve(out) : reject(new Error("codex empty: " + err.slice(0, 200)));
      } catch (e) { reject(new Error("codex no output: " + err.slice(0, 200))); }
    });
  });
}
const BACKENDS = {
  claude: { fn: askClaude, label: "claude-cli" },
  codex: { fn: askCodex, label: "codex-cli" },
  baryon: { fn: askBaryon, label: "baryon-api" },
};
async function exec(prompt) {
  const errs = [];
  for (const key of CHAIN) {
    const b = BACKENDS[key];
    if (!b) continue;
    try { return { output: await b.fn(prompt), backend: b.label }; }
    catch (e) { errs.push(key + ": " + e.message); }
  }
  throw new Error(errs.join(" | ") || "no backend configured");
}
function probeBin(bin, args) {
  return new Promise((res) => {
    const p = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"], shell: process.platform === "win32" });
    let o = ""; p.stdout.on("data", (d) => (o += d)); p.on("error", () => res(null)); p.on("close", (c) => res(c === 0 ? o.trim() : null));
  });
}

// ---------- dashboard (product home — distinct from a plain browser) ----------
const DASHBOARD = `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Wide Worker</title>
<style>
  :root{--cyan:#00ffcc;--mag:#ff00ff;--bg:#0a0c18}
  *{box-sizing:border-box} html,body{margin:0;height:100%}
  body{background:radial-gradient(1200px 600px at 50% -10%,#12203a,#0a0c18 60%);color:#dbe7f0;
    font:15px/1.6 -apple-system,"Segoe UI",system-ui,sans-serif;display:flex;flex-direction:column;align-items:center;min-height:100%}
  .top{position:fixed;top:0;left:0;right:0;display:flex;align-items:center;gap:10px;padding:12px 18px;
    background:rgba(10,12,24,.6);backdrop-filter:blur(8px);border-bottom:1px solid rgba(0,255,204,.15)}
  .logo{font-weight:800;font-size:18px;letter-spacing:.5px}
  .logo b{background:linear-gradient(90deg,var(--cyan),var(--mag));-webkit-background-clip:text;background-clip:text;color:transparent}
  .pill{margin-left:auto;font:12px ui-monospace,monospace;color:#8fa9bd;display:flex;gap:8px;align-items:center}
  .dot{width:9px;height:9px;border-radius:50%;background:#64748b;box-shadow:0 0 8px currentColor}
  .dot.on{background:var(--cyan);color:var(--cyan)} .dot.off{background:#e11d48;color:#e11d48}
  main{width:100%;max-width:760px;padding:96px 20px 40px;flex:1;display:flex;flex-direction:column}
  .hero{text-align:center;margin:28px 0 22px}
  .hero h1{font-size:40px;margin:0 0 6px} .hero h1 b{background:linear-gradient(90deg,var(--cyan),var(--mag));-webkit-background-clip:text;background-clip:text;color:transparent}
  .hero p{color:#8fa9bd;margin:0}
  .box{display:flex;gap:10px;margin:18px 0}
  .box input{flex:1;padding:14px 16px;border-radius:12px;border:1px solid rgba(0,255,204,.35);
    background:rgba(0,0,0,.35);color:#eaf6ff;font-size:15px;outline:none}
  .box input:focus{border-color:var(--cyan);box-shadow:0 0 0 3px rgba(0,255,204,.12)}
  .box button{padding:0 20px;border:0;border-radius:12px;font-weight:700;cursor:pointer;
    background:linear-gradient(90deg,var(--cyan),#38bdf8);color:#04121a}
  .chips{display:flex;gap:8px;flex-wrap:wrap;justify-content:center;margin-bottom:6px}
  .chip{font-size:12px;color:#a7c4d6;border:1px solid rgba(0,255,204,.2);border-radius:999px;padding:5px 11px;cursor:pointer;background:rgba(0,255,204,.05)}
  .chip:hover{border-color:var(--cyan)}
  .log{flex:1;margin-top:16px;overflow-y:auto;display:flex;flex-direction:column;gap:8px}
  .msg{padding:10px 14px;border-radius:12px;max-width:88%;white-space:pre-wrap;word-break:break-word}
  .me{align-self:flex-end;background:rgba(255,209,102,.14);border:1px solid rgba(255,209,102,.3)}
  .ai{align-self:flex-start;background:rgba(0,255,204,.08);border:1px solid rgba(0,255,204,.2)}
  .sys{align-self:center;color:#6b8298;font-size:12px}
  .foot{color:#5b7186;font-size:12px;text-align:center;padding:14px}
</style></head><body>
  <div class="top"><span class="logo">◇ <b>Wide&nbsp;Worker</b></span>
    <span class="pill"><span class="dot" id="dot"></span><span id="stat">확인 중…</span></span></div>
  <main>
    <div class="hero"><h1>무엇을 <b>도와드릴까요?</b></h1><p>브라우저를 조종하는 자율 에이전트 — 지시하면 대신 실행합니다.</p></div>
    <div class="chips">
      <span class="chip" data-q="호랑이 이미지 5장 다운로드해줘">🐯 이미지 수집</span>
      <span class="chip" data-q="오늘 서울 날씨 검색해줘">🌤️ 검색</span>
      <span class="chip" data-q="이 브라우저로 무엇을 할 수 있어?">💡 사용법</span>
    </div>
    <div class="box"><input id="q" placeholder="지시를 입력하세요… (예: 파이썬 최신 릴리스 찾아줘)" autofocus>
      <button id="go">실행</button></div>
    <div class="log" id="log"></div>
  </main>
  <div class="foot">Wide Worker · 단독 머신 자율 브라우저 에이전트 · webclaw + brain</div>
<script>
const $=s=>document.querySelector(s), log=$("#log");
function add(cls,t){const d=document.createElement("div");d.className="msg "+cls;d.textContent=t;log.appendChild(d);d.scrollIntoView();}
async function health(){try{const r=await fetch("/health");const j=await r.json();
  const b=j.backends||{};const on=(j.chain||[]).filter(k=>b[k+"-cli"]||b[k+"-api"]);
  const ready=on.length>0;
  $("#dot").className="dot "+(ready?"on":"off");
  $("#stat").textContent=ready?("연결됨 · "+on.join(" › ")):"두뇌 미연결";
}catch(e){$("#dot").className="dot off";$("#stat").textContent="brain 연결 안 됨";}}
async function ask(q){if(!q.trim())return;add("me",q);$("#q").value="";add("sys","🔍 생각 중…");
  try{const r=await fetch("/brain/exec",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({prompt:q})});
    const j=await r.json();log.lastChild.remove();
    if(j.output){add("ai",j.output);}else{add("ai","⚠️ "+(j.error||"응답 없음"));}
  }catch(e){log.lastChild.remove();add("ai","⚠️ brain 연결 실패: "+e);}}
$("#go").onclick=()=>ask($("#q").value);
$("#q").addEventListener("keydown",e=>{if(e.key==="Enter")ask($("#q").value);});
document.querySelectorAll(".chip").forEach(c=>c.onclick=()=>ask(c.dataset.q));
health();setInterval(health,5000);
</script></body></html>`;

// ---------- brain HTTP server ----------
function startBrain() {
  const server = http.createServer(async (req, res) => {
    res.setHeader("access-control-allow-origin", "*");
    res.setHeader("access-control-allow-headers", "content-type, authorization");
    res.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
    if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }
    const json = (c, o) => { res.writeHead(c, { "content-type": "application/json" }); res.end(JSON.stringify(o)); };
    if (req.method === "GET" && (req.url === "/" || req.url === "/index.html")) {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); res.end(DASHBOARD); return;
    }
    if (req.method === "GET" && req.url === "/health") {
      const [claude, codex] = await Promise.all([
        probeBin(CLAUDE_BIN, ["--version"]), probeBin(CODEX_BIN, ["--version"]),
      ]);
      return json(200, {
        ok: true, service: "wide-worker", version: "0.1.0", chain: CHAIN,
        backends: { "claude-cli": claude ?? false, "codex-cli": codex ?? false, "baryon-api": BARYON_KEY ? BARYON_URL : false },
      });
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
  server.on("error", (e) => {
    if (e.code === "EADDRINUSE") {
      console.log(`  ℹ️  brain 이미 :${PORT} 에서 실행 중 — 기존 인스턴스 재사용, 브라우저만 엽니다.`);
    } else { console.error("brain error:", e.message); }
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
      "--no-first-run", "--no-default-browser-check", "--start-maximized",
      // hide the "테스트용 Chrome … 자동 테스트 전용" infobar of Chrome-for-Testing
      "--test-type", "--disable-features=Translate",
      "--hide-crash-restore-bubble", "--disable-session-crashed-bubble",
      `http://localhost:${PORT}/`,
    ], { stdio: "ignore" });
    b.on("close", () => process.exit(0));
    console.log("  브라우저 실행 — webclaw 로드됨");
  }, 800);
}
process.on("SIGINT", () => process.exit(0));
