$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$project = Join-Path $root 'desktop'

Set-Location $root

if (Test-Path '.git') {
    Write-Host 'AURA guncellemeleri kontrol ediliyor...' -ForegroundColor Cyan
    git fetch origin
    if ($LASTEXITCODE -eq 0) {
        git pull --ff-only origin main
        if ($LASTEXITCODE -ne 0) {
            Write-Host 'Yerel degisiklikler nedeniyle otomatik guncelleme yapilamadi. Mevcut kodla devam ediliyor.' -ForegroundColor Yellow
        }
    }
}

Set-Location $project

if (-not (Test-Path '.\node_modules')) {
    Write-Host 'AURA Desktop bagimliliklari kuruluyor...' -ForegroundColor Cyan
    npm install
}

Write-Host 'AURA Desktop baslatiliyor...' -ForegroundColor Green
npm start
