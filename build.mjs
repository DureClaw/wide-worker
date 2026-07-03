// Wide Worker build — produce WideWorker.exe via Node SEA (single executable).
// The exe embeds the launcher logic + brain bridge; the extension/, chrome/ and
// node_modules assets sit alongside it in the install dir (referenced at runtime
// relative to the exe). Run on Windows: node build.mjs
import { execSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const OUT = join(ROOT, "dist");
const isWin = process.platform === "win32";
const exeName = "WideWorker" + (isWin ? ".exe" : "");

function sh(cmd) { console.log("$ " + cmd); execSync(cmd, { stdio: "inherit", cwd: ROOT }); }

// 1) SEA config → blob
if (existsSync(OUT)) rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const seaCfg = {
  main: "app.mjs",
  output: join(OUT, "sea-prep.blob"),
  disableExperimentalSEAWarning: true,
  useSnapshot: false,
  useCodeCache: false,
};
writeFileSync(join(ROOT, "sea-config.json"), JSON.stringify(seaCfg, null, 2));
sh(`node --experimental-sea-config sea-config.json`);

// 2) copy the node binary → exe, then inject the blob
const outExe = join(OUT, exeName);
copyFileSync(process.execPath, outExe);

const SENTINEL = "NODE_SEA_FUSE_fce680ab2cc2b0ff";
if (isWin) {
  // postject via npx (no global install needed)
  sh(`npx --yes postject "${outExe}" NODE_SEA_BLOB "${join(OUT, "sea-prep.blob")}" --sentinel-fuse ${SENTINEL}`);
} else {
  sh(`npx --yes postject "${outExe}" NODE_SEA_BLOB "${join(OUT, "sea-prep.blob")}" --sentinel-fuse ${SENTINEL} --macho-segment-name NODE_SEA`);
}

console.log("\n✅ built:", outExe);
console.log("배포 폴더(dist/)에 exe + 옆에 extension/ chrome/ 를 함께 두고 실행하세요.");
