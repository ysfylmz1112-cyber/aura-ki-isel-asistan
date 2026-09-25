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

# Yerel Electron ajanı eski kaldıysa Git durumundan bağımsız olarak güncel
# main.cjs dosyasını doğrudan GitHub'dan yenile.
$mainPath = Join-Path $project 'main.cjs'
$rawMainUrl = 'https://raw.githubusercontent.com/ysfylmz1112-cyber/aura-ki-isel-asistan/main/desktop/main.cjs'

try {
    $remoteMain = (Invoke-WebRequest -UseBasicParsing -Uri $rawMainUrl).Content
    if ($remoteMain -notmatch "desktop_scan_environment") {
        throw 'GitHub üzerindeki AURA Desktop kodunda desktop_scan_environment bulunamadı.'
    }

    $localMain = ''
    if (Test-Path $mainPath) {
        $localMain = Get-Content -Raw -LiteralPath $mainPath
    }

    if ($localMain -ne $remoteMain) {
        $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
        if ($localMain) {
            Copy-Item -LiteralPath $mainPath -Destination (Join-Path $project "main.cjs.backup-$stamp") -Force
        }
        Set-Content -LiteralPath $mainPath -Value $remoteMain -Encoding UTF8
        Write-Host 'AURA Desktop ajan kodu yenilendi.' -ForegroundColor Green
    }
}
catch {
    Write-Host ('Desktop ajan guncellemesi yapilamadi: ' + $_.Exception.Message) -ForegroundColor Yellow
}

if (-not (Test-Path '.\node_modules')) {
    Write-Host 'AURA Desktop bagimliliklari kuruluyor...' -ForegroundColor Cyan
    npm install
}

Write-Host 'AURA Desktop baslatiliyor...' -ForegroundColor Green
npm start
