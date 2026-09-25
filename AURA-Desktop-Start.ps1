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
$filesToRefresh = @(
    @{
        Name = 'main.cjs'
        Local = Join-Path $project 'main.cjs'
        Remote = 'https://raw.githubusercontent.com/ysfylmz1112-cyber/aura-ki-isel-asistan/main/desktop/main.cjs'
        Required = 'desktop_scan_environment'
    },
    @{
        Name = 'index.html'
        Local = Join-Path $root 'index.html'
        Remote = 'https://raw.githubusercontent.com/ysfylmz1112-cyber/aura-ki-isel-asistan/main/index.html'
        Required = 'PC taraması tamamlandı kanka'
    }
)

foreach ($item in $filesToRefresh) {
    try {
        $remote = (Invoke-WebRequest -UseBasicParsing -Uri $item.Remote).Content
        if ($remote -notmatch [regex]::Escape($item.Required)) {
            throw ($item.Name + ' için GitHub içeriği beklenen AURA kodunu içermiyor.')
        }

        $local = ''
        if (Test-Path $item.Local) {
            $local = Get-Content -Raw -LiteralPath $item.Local
        }

        if ($local -ne $remote) {
            $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
            if ($local) {
                $backup = $item.Local + '.backup-' + $stamp
                Copy-Item -LiteralPath $item.Local -Destination $backup -Force
            }
            Set-Content -LiteralPath $item.Local -Value $remote -Encoding UTF8
            Write-Host ('AURA dosyasi yenilendi: ' + $item.Name) -ForegroundColor Green
        }
    }
    catch {
        Write-Host ($item.Name + ' guncellenemedi: ' + $_.Exception.Message) -ForegroundColor Yellow
    }
}

if (-not (Test-Path '.\node_modules')) {
    Write-Host 'AURA Desktop bagimliliklari kuruluyor...' -ForegroundColor Cyan
    npm install
}

Write-Host 'AURA Desktop baslatiliyor...' -ForegroundColor Green
npm start
