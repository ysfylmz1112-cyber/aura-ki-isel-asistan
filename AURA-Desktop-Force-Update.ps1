$ErrorActionPreference = 'Stop'

$repoRoot = Join-Path $env:USERPROFILE 'Desktop\aura-ki-isel-asistan'
$desktopDir = Join-Path $repoRoot 'desktop'
$rendererDir = Join-Path $desktopDir 'renderer'
$desktopInstaller = Join-Path $env:USERPROFILE 'Desktop\AURA-3.0.0-Setup.exe'

New-Item -ItemType Directory -Force -Path $repoRoot,$desktopDir,$rendererDir | Out-Null

Write-Host 'AURA 3.0 WINDOWS INSTALLER UPDATE' -ForegroundColor Cyan
Write-Host 'Mevcut AURA surecleri kapatiliyor...' -ForegroundColor DarkCyan

Stop-Process -Name 'AURA' -Force -ErrorAction SilentlyContinue
Stop-Process -Name 'electron' -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 1000

$files = @(
  @{ Local = Join-Path $repoRoot 'index.html'; Remote = 'https://raw.githubusercontent.com/ysfylmz1112-cyber/aura-ki-isel-asistan/dc0deec37b275419cd9f8e5bd350790c3e15948f/index.html'; Required = 'desktop_scan_environment' },
  @{ Local = Join-Path $repoRoot 'local-ai.js'; Remote = 'https://raw.githubusercontent.com/ysfylmz1112-cyber/aura-ki-isel-asistan/008f504c5dec99181d59512cd282599c682bb1fe/local-ai.js'; Required = 'Qwen2.5-1.5B-Instruct' },
  @{ Local = Join-Path $desktopDir 'main.cjs'; Remote = 'https://raw.githubusercontent.com/ysfylmz1112-cyber/aura-ki-isel-asistan/5c0b4c5c1062c35540eb3512194d5892a9147c3f/desktop/main.cjs'; Required = 'desktop_scan_environment' },
  @{ Local = Join-Path $desktopDir 'preload.cjs'; Remote = 'https://raw.githubusercontent.com/ysfylmz1112-cyber/aura-ki-isel-asistan/e50129f189dfcde5b528634f439fc5d84786012f/desktop/preload.cjs'; Required = 'auraDesktop' },
  @{ Local = Join-Path $desktopDir 'package.json'; Remote = 'https://raw.githubusercontent.com/ysfylmz1112-cyber/aura-ki-isel-asistan/86765212f8fe51928a31cbbb2232849460c5ecb9/desktop/package.json'; Required = 'electron-builder' }
)

foreach($item in $files){
  Write-Host ('Guncelleniyor: ' + $item.Local) -ForegroundColor DarkCyan
  $remote = (Invoke-WebRequest -UseBasicParsing -Uri $item.Remote -Headers @{ 'Cache-Control' = 'no-cache' }).Content
  if([string]::IsNullOrWhiteSpace($remote) -or $remote -notmatch [regex]::Escape($item.Required)){
    throw ('GitHub dosyasi dogrulanamadi: ' + $item.Remote)
  }
  if(Test-Path $item.Local){
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    Copy-Item -LiteralPath $item.Local -Destination ($item.Local + '.backup-' + $stamp) -Force
  }
  [System.IO.File]::WriteAllText($item.Local, $remote, (New-Object System.Text.UTF8Encoding($false)))
  Write-Host ('Dogrulandi: ' + $item.Local) -ForegroundColor Green
}

Copy-Item -LiteralPath (Join-Path $repoRoot 'index.html') -Destination (Join-Path $rendererDir 'index.html') -Force
Copy-Item -LiteralPath (Join-Path $repoRoot 'local-ai.js') -Destination (Join-Path $rendererDir 'local-ai.js') -Force
Write-Host 'Renderer dosyalari hazir.' -ForegroundColor Green

Set-Location $desktopDir
Write-Host 'NPM bagimliliklari kuruluyor/guncelleniyor...' -ForegroundColor Cyan
npm install --no-audit --no-fund
if($LASTEXITCODE -ne 0){ throw 'NPM bagimliliklari kurulamadı.' }

Write-Host 'AURA Windows Setup EXE olusturuluyor...' -ForegroundColor Cyan
if(Test-Path '.\dist'){
  Remove-Item '.\dist' -Recurse -Force -ErrorAction SilentlyContinue
}
npm run build:win
if($LASTEXITCODE -ne 0){ throw 'AURA EXE derlemesi basarisiz oldu.' }

$built = Get-ChildItem '.\dist\AURA-*-Setup.exe' -File -ErrorAction SilentlyContinue |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1

if(-not $built){ throw 'AURA Windows setup EXE bulunamadi.' }

Copy-Item -LiteralPath $built.FullName -Destination $desktopInstaller -Force

Write-Host ''
Write-Host '========================================' -ForegroundColor Green
Write-Host 'AURA KURULUM DOSYASI HAZIR' -ForegroundColor Green
Write-Host ('Dosya: ' + $desktopInstaller) -ForegroundColor Green
Write-Host ('Boyut: ' + [math]::Round($built.Length/1MB,1) + ' MB') -ForegroundColor Green
Write-Host '========================================' -ForegroundColor Green
Write-Host 'AURA kurulumu baslatiliyor...' -ForegroundColor Cyan

Start-Process -FilePath $desktopInstaller
