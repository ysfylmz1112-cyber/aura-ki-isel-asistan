$ErrorActionPreference = 'Stop'

$repoRoot = Join-Path $env:USERPROFILE 'Desktop\aura-ki-isel-asistan'
$desktopDir = Join-Path $repoRoot 'desktop'
$rendererDir = Join-Path $desktopDir 'renderer'
$desktopInstaller = Join-Path $env:USERPROFILE 'Desktop\AURA-5.0.1-Setup.exe'
$releaseCommits = @{
  index = 'main'
  localAI = 'main'
  main = 'main'
  preload = 'main'
  package = 'main'
}
$rawBase = 'https://raw.githubusercontent.com/ysfylmz1112-cyber/aura-ki-isel-asistan/'

New-Item -ItemType Directory -Force -Path $repoRoot,$desktopDir,$rendererDir | Out-Null

Write-Host 'AURA 5.0.1 - TAM WINDOWS GUNCELLEMESI' -ForegroundColor Cyan
Write-Host 'Mevcut AURA surecleri kapatiliyor...' -ForegroundColor DarkCyan
Stop-Process -Name 'AURA' -Force -ErrorAction SilentlyContinue
Get-CimInstance Win32_Process -Filter "Name='electron.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -match 'aura-ki-isel-asistan[\\/]desktop' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Milliseconds 1000

$files = @(
  @{ Local = Join-Path $repoRoot 'index.html'; Remote = $rawBase + $releaseCommits.index + '/index.html'; Required = 'AURA 5.0'; Name = 'arayuz' },
  @{ Local = Join-Path $repoRoot 'local-ai.js'; Remote = $rawBase + $releaseCommits.localAI + '/local-ai.js'; Required = 'AURA 5.0'; Name = 'yerel-ai' },
  @{ Local = Join-Path $desktopDir 'main.cjs'; Remote = $rawBase + $releaseCommits.main + '/desktop/main.cjs'; Required = 'app.whenReady'; Name = 'desktop-core' },
  @{ Local = Join-Path $desktopDir 'preload.cjs'; Remote = $rawBase + $releaseCommits.preload + '/desktop/preload.cjs'; Required = 'auraDesktop'; Name = 'preload' },
  @{ Local = Join-Path $desktopDir 'package.json'; Remote = $rawBase + $releaseCommits.package + '/desktop/package.json'; Required = '5.0.0'; Name = 'paket' }
)

foreach($item in $files){
  Write-Host ('Guncelleniyor: ' + $item.Name) -ForegroundColor DarkCyan
  $remote = (Invoke-WebRequest -UseBasicParsing -Uri $item.Remote -Headers @{ 'Cache-Control' = 'no-cache' }).Content
  if([string]::IsNullOrWhiteSpace($remote) -or $remote -notmatch $item.Required){
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

Set-Location $desktopDir
Write-Host 'NPM bagimliliklari kuruluyor...' -ForegroundColor Cyan
npm install --no-audit --no-fund
if($LASTEXITCODE -ne 0){ throw 'NPM bagimliliklari kurulamadi.' }

if(Test-Path '.\dist'){
  Remove-Item '.\dist' -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host 'AURA 5.0.1 Setup EXE olusturuluyor...' -ForegroundColor Cyan
npm run build:win
if($LASTEXITCODE -ne 0){ throw 'AURA Setup EXE derlemesi basarisiz oldu.' }

$built = Get-ChildItem '.\dist\AURA-*-Setup.exe' -File -ErrorAction SilentlyContinue |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1

if(-not $built){ throw 'AURA Setup EXE bulunamadi.' }

Copy-Item -LiteralPath $built.FullName -Destination $desktopInstaller -Force

Write-Host ''
Write-Host '========================================' -ForegroundColor Green
Write-Host 'AURA 5.0.1 HAZIR' -ForegroundColor Green
Write-Host ('Kurulum: ' + $desktopInstaller) -ForegroundColor Green
Write-Host ('Boyut: ' + [math]::Round($built.Length/1MB,1) + ' MB') -ForegroundColor Green
Write-Host 'Qwen yerel AI + uygulama kontrolu + hafiza + PC HUD + telefon QR + telefona aktarim + web + Unity + kod modu aktif.' -ForegroundColor Green
Write-Host '========================================' -ForegroundColor Green

Start-Process -FilePath $desktopInstaller