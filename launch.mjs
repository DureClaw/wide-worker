// Wide Worker launcher — single-machine autonomous browser agent.
// Starts the local brain bridge, then launches a bundled Chromium with the
// webclaw extension pre-loaded and a dedicated profile. Everything runs on
// this one machine; no fleet bus or remote master required.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 4111);
const PROFILE = join(ROOT, "profile");
const EXT = join(ROOT, "extension");

// Locate the bundled Chromium (installed by @puppeteer/browsers into ./chrome).
function findChromium() {
  if (process.env.CHROMIUM_PATH && existsSync(process.env.CHROMIUM_PATH)) return process.env.CHROMIUM_PATH;
  const base = join(ROOT, "chrome");
  if (!existsSync(base)) return null;
  const exe = process.platform === "win32" ? "chrome.exe" : "chrome";
  // chrome/<platform-version>/chrome-<platform>/chrome.exe
  for (const d of readdirSync(base)) {
    for (const inner of readdirSync(join(base, d))) {
      const p = join(base, d, inner, exe);
      if (existsSync(p)) return p;
    }
  }
  return null;
}

// Seed the extension's config so webclaw runs standalone: no bus, brain on
// localhost. (bus empty → webclaw skips fleet join; brainUrl drives the HUD.)
function seedExtensionConfig() {
  const cfg = {
    bus: "",
    brainUrl: `http://localhost:${PORT}`,
    brainToken: process.env.BRAIN_TOKEN ?? "",
    name: "wideworker@local",
    standalone: true,
  };
  writeFileSync(join(EXT, "config.local.json"), JSON.stringify(cfg, null, 2));
}

const chromium = findChromium();
if (!chromium) {
  console.error("Chromium이 없습니다. 먼저 설치하세요:");
  console.error("  npx @puppeteer/browsers install chrome@stable");
  process.exit(1);
}
if (!existsSync(PROFILE)) mkdirSync(PROFILE, { recursive: true });
seedExtensionConfig();

console.log("Wide Worker — 단독 머신 자율 브라우저 에이전트");
console.log("  chromium:", chromium);
console.log("  extension:", EXT);

// 1) brain bridge
const brain = spawn(process.execPath, [join(ROOT, "brain-bridge.mjs")], {
  stdio: "inherit",
  env: process.env,
});

// 2) Chromium with webclaw pre-loaded
const args = [
  `--user-data-dir=${PROFILE}`,
  `--load-extension=${EXT}`,
  `--disable-extensions-except=${EXT}`,
  "--no-first-run",
  "--no-default-browser-check",
  "--start-maximized",
  "https://www.google.com",
];
setTimeout(() => {
  const browser = spawn(chromium, args, { stdio: "ignore", detached: false });
  browser.on("close", () => { try { brain.kill(); } catch {} process.exit(0); });
  console.log("  브라우저 실행됨 — webclaw 확장이 자동 로드됩니다.");
}, 800);

process.on("SIGINT", () => { try { brain.kill(); } catch {} process.exit(0); });
