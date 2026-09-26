$ErrorActionPreference = 'Stop'

$repoRoot = Join-Path $env:USERPROFILE 'Desktop\aura-ki-isel-asistan'
$desktopDir = Join-Path $repoRoot 'desktop'
New-Item -ItemType Directory -Force -Path $repoRoot | Out-Null
New-Item -ItemType Directory -Force -Path $desktopDir | Out-Null

Write-Host 'AURA FORCE UPDATE basliyor...' -ForegroundColor Cyan

Stop-Process -Name 'electron' -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 700

$base = 'https://raw.githubusercontent.com/ysfylmz1112-cyber/aura-ki-isel-asistan/ea163f3adedb1ab98fd60bc8d00b7e1f8ccdafe1/'
$files = @(
  @{ Local = Join-Path $repoRoot 'index.html'; Remote = $base + 'index.html'; Required = 'desktop_scan_environment' },
  @{ Local = Join-Path $repoRoot 'local-ai.js'; Remote = $base + 'local-ai.js'; Required = 'Qwen2.5-1.5B-Instruct' },
  @{ Local = Join-Path $desktopDir 'main.cjs'; Remote = $base + 'desktop/main.cjs'; Required = 'desktop_scan_environment' },
  @{ Local = Join-Path $desktopDir 'preload.cjs'; Remote = $base + 'desktop/preload.cjs'; Required = 'auraDesktop' },
  @{ Local = Join-Path $desktopDir 'package.json'; Remote = $base + 'desktop/package.json'; Required = 'electron' },
  @{ Local = Join-Path $repoRoot 'AURA-Desktop-Start.ps1'; Remote = $base + 'AURA-Desktop-Start.ps1'; Required = 'Invoke-WebRequest' }
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
  Write-Host ('Dogrulandi: ' + $item['Local']) -ForegroundColor Green
}

Set-Location $repoRoot

Write-Host 'Dosya guncellemesi tamamlandi.' -ForegroundColor Green
Write-Host 'Son Desktop surumu:' -ForegroundColor Cyan
$main = Get-Content -Raw -LiteralPath (Join-Path $desktopDir 'main.cjs')
$m = [regex]::Match($main, "version:'([^']+)'")
if($m.Success){ Write-Host $m.Groups[1].Value -ForegroundColor Green }

if(-not (Test-Path (Join-Path $desktopDir 'node_modules'))){
  Set-Location $desktopDir
  npm install
}

Set-Location $repoRoot
Write-Host 'AURA Desktop baslatiliyor...' -ForegroundColor Green
Set-Location $desktopDir
npm start
