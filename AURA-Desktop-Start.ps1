$ErrorActionPreference = 'Stop'
$project = Join-Path $PSScriptRoot 'desktop'
Set-Location $project
if (-not (Test-Path '.\node_modules')) {
  Write-Host 'AURA Desktop bagimliliklari kuruluyor...' -ForegroundColor Cyan
  npm install
}
Write-Host 'AURA Desktop baslatiliyor...' -ForegroundColor Green
npm start
