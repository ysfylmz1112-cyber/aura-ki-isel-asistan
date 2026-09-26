$ErrorActionPreference = 'Stop'

$repoRoot = Join-Path $env:USERPROFILE 'Desktop\aura-ki-isel-asistan'
$desktopDir = Join-Path $repoRoot 'desktop'
$rendererDir = Join-Path $desktopDir 'renderer'
$desktopExe = Join-Path $env:USERPROFILE 'Desktop\AURA.exe'

New-Item -ItemType Directory -Force -Path $repoRoot,$desktopDir,$rendererDir | Out-Null

Write-Host 'AURA 3.0 FORCE UPDATE' -ForegroundColor Cyan
Write-Host 'Mevcut AURA surecleri kapatiliyor...' -ForegroundColor DarkCyan

Stop-Process -Name 'AURA' -Force -ErrorAction SilentlyContinue
Stop-Process -Name 'electron' -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 1000

$files = @(
  @{ Local = Join-Path $repoRoot 'index.html'; Remote = 'https://raw.githubusercontent.com/ysfylmz1112-cyber/aura-ki-isel-asistan/e50129f189dfcde5b528634f439fc5d84786012f/index.html'; Required = 'desktop_scan_environment' },
  @{ Local = Join-Path $repoRoot 'local-ai.js'; Remote = 'https://raw.githubusercontent.com/ysfylmz1112-cyber/aura-ki-isel-asistan/e50129f189dfcde5b528634f439fc5d84786012f/local-ai.js'; Required = 'Qwen2.5-1.5B-Instruct' },
  @{ Local = Join-Path $desktopDir 'main.cjs'; Remote = 'https://raw.githubusercontent.com/ysfylmz1112-cyber/aura-ki-isel-asistan/e50129f189dfcde5b528634f439fc5d84786012f/desktop/main.cjs'; Required = 'desktop_scan_environment' },
  @{ Local = Join-Path $desktopDir 'preload.cjs'; Remote = 'https://raw.githubusercontent.com/ysfylmz1112-cyber/aura-ki-isel-asistan/e50129f189dfcde5b528634f439fc5d84786012f/desktop/preload.cjs'; Required = 'auraDesktop' },
  @{ Local = Join-Path $desktopDir 'package.json'; Remote = 'https://raw.githubusercontent.com/ysfylmz1112-cyber/aura-ki-isel-asistan/e50129f189dfcde5b528634f439fc5d84786012f/desktop/package.json'; Required = 'electron-builder' }
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

Write-Host 'AURA portable EXE olusturuluyor...' -ForegroundColor Cyan
if(Test-Path '.\dist'){
  Remove-Item '.\dist' -Recurse -Force -ErrorAction SilentlyContinue
}
npm run build:win
if($LASTEXITCODE -ne 0){ throw 'AURA EXE derlemesi basarisiz oldu.' }

$built = Get-ChildItem '.\dist\AURA-*-portable.exe' -File -ErrorAction SilentlyContinue |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1

if(-not $built){ throw 'AURA portable EXE bulunamadi.' }

Copy-Item -LiteralPath $built.FullName -Destination $desktopExe -Force

Write-Host ''
Write-Host '========================================' -ForegroundColor Green
Write-Host 'AURA EXE HAZIR' -ForegroundColor Green
Write-Host ('Dosya: ' + $desktopExe) -ForegroundColor Green
Write-Host ('Boyut: ' + [math]::Round($built.Length/1MB,1) + ' MB') -ForegroundColor Green
Write-Host '========================================' -ForegroundColor Green
Write-Host 'AURA EXE baslatiliyor...' -ForegroundColor Cyan

Start-Process -FilePath $desktopExe
