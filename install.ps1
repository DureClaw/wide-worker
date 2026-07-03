# Wide Worker one-liner installer (Windows PowerShell)
#   irm https://raw.githubusercontent.com/DureClaw/wide-worker/main/install.ps1 | iex
$ErrorActionPreference = "Stop"
$dir = Join-Path $env:USERPROFILE "dev\WideWorker"

Write-Host "== Wide Worker installer ==" -ForegroundColor Cyan

# prerequisites
try { $nodev = node --version } catch { Write-Host "node가 필요합니다: winget install OpenJS.NodeJS.LTS" -ForegroundColor Red; exit 1 }
Write-Host "node $nodev OK"

# clone or update
if (Test-Path (Join-Path $dir ".git")) {
  git -C $dir pull --ff-only
} else {
  New-Item -ItemType Directory -Force -Path (Split-Path $dir) | Out-Null
  git clone https://github.com/DureClaw/wide-worker.git $dir
}
Write-Host "installed → $dir"

# config scaffold
$cfg = Join-Path $dir "config.local.json"
if (-not (Test-Path $cfg)) { Copy-Item (Join-Path $dir "config.example.json") $cfg }

Write-Host ""
Write-Host "실행:  cd $dir ; .\start.cmd" -ForegroundColor Green
Write-Host "webclaw 팝업 → Brain URL: http://<이 PC IP>:4111  (같은 PC면 http://localhost:4111)"
Write-Host "api.baryon.ai 사용 시: `$env:BARYON_API_KEY 설정 후 start.cmd"
