# Start the desktop app in development mode (hot reload on).
# Run from anywhere; paths are resolved relative to this script.

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$app = $root   # 根目录即桌面应用（src/main、preload、renderer）
$electronModule = Join-Path $app 'node_modules\electron'
$electronExe = Join-Path $electronModule 'dist\electron.exe'

Write-Host '[dev] PointStudio desktop - development mode' -ForegroundColor Cyan

# 1. Dependencies live OUTSIDE the workspace (see AGENTS.md pitfall 0).
#    node_modules inside the workspace is a junction to D:\deveTools\ps-node.
if (-not (Test-Path $electronModule)) {
  Write-Host '[dev] FAILED: node_modules is missing.' -ForegroundColor Red
  Write-Host '      Dependencies must be installed in D:\deveTools\ps-node and junctioned in.' -ForegroundColor Yellow
  Write-Host '      See AGENTS.md, pitfall 0. Do not run pnpm install inside the workspace.' -ForegroundColor Yellow
  exit 1
}

# 2. electron package is present but its platform binary can be missing
#    because pnpm skips its postinstall script.
if (-not (Test-Path $electronExe)) {
  Write-Host '[dev] FAILED: electron binary is missing.' -ForegroundColor Red
  Write-Host '      Fix: cd into the electron package dir and run node install.js' -ForegroundColor Yellow
  Write-Host '      with ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/' -ForegroundColor Yellow
  exit 1
}

# 3. DSH sessions inject this; it turns electron into plain node and breaks startup.
if ($env:ELECTRON_RUN_AS_NODE) {
  Write-Host '[dev] clearing ELECTRON_RUN_AS_NODE (injected by the tooling)' -ForegroundColor DarkGray
  Remove-Item Env:\ELECTRON_RUN_AS_NODE
}

Set-Location $app
Write-Host '[dev] starting electron-vite, keep this window open' -ForegroundColor Green
& (Join-Path $app 'node_modules\.bin\electron-vite.CMD') dev
