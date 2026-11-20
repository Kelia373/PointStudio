# Run the repository gates: type check + tdd_gate content/test checks.
# This is what CI runs (plus the boundary checks added later).

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$app = Join-Path $root 'apps\desktop'

Write-Host '[check] type check' -ForegroundColor Cyan
Set-Location $app
& (Join-Path $app 'node_modules\.bin\tsc.CMD') --noEmit
if ($LASTEXITCODE -ne 0) {
  Write-Host '[check] FAILED: type errors' -ForegroundColor Red
  exit $LASTEXITCODE
}

Write-Host '[check] repository gates' -ForegroundColor Cyan
Set-Location $root

# The bundled runtime python; override with POINTSTUDIO_PYTHON if it moves.
$python = $env:POINTSTUDIO_PYTHON
if (-not $python) {
  $python = 'C:\Users\Administrator\.dsh\dsh-runtimes\dsh-next-primary-runtime\dependencies\python\python.exe'
}
if (-not (Test-Path $python)) {
  Write-Host '[check] FAILED: python not found. Set POINTSTUDIO_PYTHON.' -ForegroundColor Red
  exit 1
}

& $python 'scripts\tdd_gate.py' --all
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host '[check] all good' -ForegroundColor Green
