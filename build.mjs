// Wide Worker build — produce a single self-contained WideWorker.exe with caxa.
// caxa bundles the whole folder (app + extension + Chromium + a Node runtime)
// into one exe that self-extracts to a temp dir and runs. No code-signing
// dance (unlike Node SEA + postject on signed node.exe). Run on Windows:
//   node build.mjs
import { execSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const OUT = join(ROOT, "dist");
const isWin = process.platform === "win32";
const nodeExe = isWin ? "node.exe" : "node";

function sh(cmd) { console.log("$ " + cmd); execSync(cmd, { stdio: "inherit", cwd: ROOT }); }

if (existsSync(OUT)) rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

// Bundle a Node runtime inside the payload so the exe is self-contained.
const runtimeDir = join(ROOT, "runtime");
if (!existsSync(runtimeDir)) mkdirSync(runtimeDir, { recursive: true });
copyFileSync(process.execPath, join(runtimeDir, nodeExe));

const outExe = join(OUT, "WideWorker" + (isWin ? ".exe" : ""));

// caxa: input = this folder (minus build artifacts / profile / vcs), entry runs
// the bundled node against app.mjs at the extraction root ({{caxa}}).
sh(
  `npx --yes caxa ` +
  `--input "." ` +
  `--output "${outExe}" ` +
  `--exclude ".git" "dist" "profile" "runtime/.gitkeep" ` +
  `-- "{{caxa}}/runtime/${nodeExe}" "{{caxa}}/app.mjs"`
);

console.log("\n✅ built:", outExe);
console.log("   단일 exe — 실행 시 임시폴더로 추출 후 brain+Chromium+webclaw 기동.");
