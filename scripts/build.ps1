# Build the desktop app once (output goes to apps\desktop\out).
# This is the "make" step; it does not start the app.

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$app = Join-Path $root 'apps\desktop'

Write-Host '[build] PointStudio desktop' -ForegroundColor Cyan

if (-not (Test-Path (Join-Path $app 'node_modules\electron'))) {
  Write-Host '[build] FAILED: dependencies are not installed.' -ForegroundColor Red
  exit 1
}

Set-Location $app
& (Join-Path $app 'node_modules\.bin\electron-vite.CMD') build
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host '[build] done, artifacts in apps\desktop\out' -ForegroundColor Green
