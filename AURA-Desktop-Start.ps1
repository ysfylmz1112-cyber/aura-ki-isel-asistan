$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$project = Join-Path $root 'desktop'

Set-Location $root

if (Test-Path '.git') {
    Write-Host 'AURA guncellemeleri kontrol ediliyor...' -ForegroundColor Cyan
    git fetch origin main
    if ($LASTEXITCODE -eq 0) {
        $localHead = (git rev-parse HEAD).Trim()
        $remoteHead = (git rev-parse origin/main).Trim()

        if ($localHead -ne $remoteHead) {
            $dirty = git status --porcelain
            if ($dirty) {
                $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
                Write-Host "Yerel degisiklikler bulundu. Guvenli yedek (stash) olusturuluyor..." -ForegroundColor Yellow
                git stash push -u -m "AURA-auto-update-$stamp"
                if ($LASTEXITCODE -ne 0) { throw 'Yerel degisiklikler yedeklenemedi; guncelleme durduruldu.' }
            }

            git reset --hard origin/main
            if ($LASTEXITCODE -ne 0) { throw 'AURA guncellemesi uygulanamadi.' }

            Write-Host 'AURA son surume guncellendi.' -ForegroundColor Green
        } else {
            Write-Host 'AURA zaten guncel.' -ForegroundColor DarkGreen
        }
    } else {
        Write-Host 'GitHub kontrolu yapilamadi. Mevcut dosyalarla devam ediliyor.' -ForegroundColor Yellow
    }
}

Set-Location $project

if (-not (Test-Path '.\node_modules')) {
    Write-Host 'AURA Desktop bagimliliklari kuruluyor...' -ForegroundColor Cyan
    npm install
} else {
    npm install --no-audit --no-fund
}

Write-Host 'AURA Desktop baslatiliyor...' -ForegroundColor Green
npm start
