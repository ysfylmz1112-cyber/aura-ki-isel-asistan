$ErrorActionPreference = 'Stop'

$repoRoot = Join-Path $env:USERPROFILE 'Desktop\aura-ki-isel-asistan'
$desktopDir = Join-Path $repoRoot 'desktop'
$rendererDir = Join-Path $desktopDir 'renderer'
$desktopInstaller = Join-Path $env:USERPROFILE 'Desktop\AURA-5.3.2-Setup.exe'
$releaseBranch = 'main'

New-Item -ItemType Directory -Force -Path $repoRoot,$desktopDir,$rendererDir | Out-Null
Set-Location $repoRoot

Write-Host 'AURA 5.3.2 - TAM WINDOWS GUNCELLEMESI' -ForegroundColor Cyan
Write-Host 'GitHub ana dal kontrol ediliyor...' -ForegroundColor DarkCyan

if(-not (Get-Command git -ErrorAction SilentlyContinue)){
  throw 'Git bulunamadi. Git yukleyip tekrar deneyin.'
}

git fetch origin $releaseBranch --quiet
if($LASTEXITCODE -ne 0){
  throw 'GitHub deposu guncellenemedi. Internet ve GitHub baglantisini kontrol edin.'
}

$releaseRef = (git rev-parse ('origin/' + $releaseBranch)).Trim()
if([string]::IsNullOrWhiteSpace($releaseRef)){
  throw 'Guncel AURA commit SHA bulunamadi.'
}

Write-Host ('Guncel surum commit: ' + $releaseRef) -ForegroundColor DarkGray

Write-Host 'Mevcut AURA surecleri kapatiliyor...' -ForegroundColor DarkCyan
Stop-Process -Name 'AURA' -Force -ErrorAction SilentlyContinue
Get-CimInstance Win32_Process -Filter "Name='electron.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -match 'aura-ki-isel-asistan[\\/]desktop' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Milliseconds 1200

$files = @(
  @{ Local = Join-Path $repoRoot 'index.html'; GitPath = 'index.html'; Required = 'function safeDriveListRequest'; Name = 'arayuz' },
  @{ Local = Join-Path $repoRoot 'local-ai.js'; GitPath = 'local-ai.js'; Required = 'function isDriveListRequest'; Name = 'yerel-ai' },
  @{ Local = Join-Path $desktopDir 'main.cjs'; GitPath = 'desktop/main.cjs'; Required = "app.whenReady().then(async()=>"; Name = 'desktop-core' },
  @{ Local = Join-Path $desktopDir 'prepare-renderer.cjs'; GitPath = 'desktop/prepare-renderer.cjs'; Required = 'AURA renderer sync'; Name = 'renderer-sync' },
  @{ Local = Join-Path $desktopDir 'preload.cjs'; GitPath = 'desktop/preload.cjs'; Required = 'contextBridge.exposeInMainWorld'; Name = 'preload' },
  @{ Local = Join-Path $desktopDir 'package.json'; GitPath = 'desktop/package.json'; Required = '"version": "5.3.2"'; Name = 'paket' },
  @{ Local = Join-Path $desktopDir 'openclaw.cjs'; GitPath = 'desktop/openclaw.cjs'; Required = 'module.exports'; Name = 'openclaw' }
)

foreach($item in $files){
  Write-Host ('Guncelleniyor: ' + $item.Name) -ForegroundColor DarkCyan

  $showArg = $releaseRef + ':' + $item.GitPath
  $remoteLines = @(git show $showArg 2>$null)
  if($LASTEXITCODE -ne 0 -or $remoteLines.Count -eq 0){
    throw ('GitHub dosyasi alinamadi: ' + $item.GitPath)
  }

  $remote = ($remoteLines -join [Environment]::NewLine)
  if([string]::IsNullOrWhiteSpace($remote)){
    throw ('GitHub dosyasi bos: ' + $item.GitPath)
  }
if($item.GitPath -eq 'desktop/package.json'){
    try {
      $pkg = $remote | ConvertFrom-Json
      if([string]$pkg.version -ne '5.3.2'){
        throw ('Beklenmeyen package.json sürümü: ' + [string]$pkg.version)
      }
    } catch {
      throw ('GitHub dosyasi dogrulanamadi: ' + $item.GitPath + ' | package.json JSON/sürüm doğrulaması başarısız.')
    }
  } elseif(-not [string]::IsNullOrWhiteSpace($item.Required) -and $remote.IndexOf($item.Required,[System.StringComparison]::Ordinal) -lt 0){
    throw ('GitHub dosyasi dogrulanamadi: ' + $item.GitPath + ' | AURA guncel commitinde beklenen imza bulunamadi.')
  }

  if(Test-Path $item.Local){
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    Copy-Item -LiteralPath $item.Local -Destination ($item.Local + '.backup-' + $stamp) -Force
  }

  [System.IO.File]::WriteAllText(
    $item.Local,
    $remote,
    (New-Object System.Text.UTF8Encoding($false))
  )

  Write-Host ('Dogrulandi: ' + $item.GitPath) -ForegroundColor Green
}

Write-Host 'Renderer dosyalari esleniyor...' -ForegroundColor DarkCyan
Copy-Item -LiteralPath (Join-Path $repoRoot 'index.html') -Destination (Join-Path $rendererDir 'index.html') -Force
Copy-Item -LiteralPath (Join-Path $repoRoot 'local-ai.js') -Destination (Join-Path $rendererDir 'local-ai.js') -Force

Set-Location $desktopDir
Write-Host 'NPM bagimliliklari kuruluyor...' -ForegroundColor Cyan
npm install --no-audit --no-fund
if($LASTEXITCODE -ne 0){
  throw 'NPM bagimliliklari kurulamadi.'
}

if(Test-Path '.\dist'){
  Remove-Item '.\dist' -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host 'AURA 5.3.2 Setup EXE olusturuluyor...' -ForegroundColor Cyan
npm run build:win
if($LASTEXITCODE -ne 0){
  throw 'AURA Setup EXE derlemesi basarisiz oldu.'
}

$built = Get-ChildItem '.\dist\AURA-*-Setup.exe' -File -ErrorAction SilentlyContinue |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1

if(-not $built){
  throw 'AURA Setup EXE bulunamadi.'
}

Copy-Item -LiteralPath $built.FullName -Destination $desktopInstaller -Force

Write-Host ''
Write-Host '========================================' -ForegroundColor Green
Write-Host 'AURA 5.3.2 HAZIR' -ForegroundColor Green
Write-Host ('Kurulum: ' + $desktopInstaller) -ForegroundColor Green
Write-Host ('Boyut: ' + [math]::Round($built.Length/1MB,1) + ' MB') -ForegroundColor Green
Write-Host 'Qwen yerel AI + hafiza + PC Core + canli HUD + ses + telefon + web + Unity + kod modu + pano + ekran goruntusu aktif.' -ForegroundColor Green
Write-Host '========================================' -ForegroundColor Green

Start-Process -FilePath $desktopInstaller
