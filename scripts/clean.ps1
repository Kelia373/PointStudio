# Remove build output and local caches. Does not touch dependencies
# (they live outside the workspace and are expensive to rebuild).

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

Write-Host '[clean] removing build output' -ForegroundColor Cyan

$targets = @(
  'apps\desktop\out',
  'apps\desktop\node_modules\.vite',
  'node_modules\.vite',
  '*.tsbuildinfo',
  'run.log'
)

foreach ($target in $targets) {
  $path = Join-Path $root $target
  if (Test-Path $path) {
    Remove-Item -Path $path -Recurse -Force -ErrorAction SilentlyContinue
    Write-Host "  removed $target" -ForegroundColor DarkGray
  }
}

Write-Host '[clean] done' -ForegroundColor Green
