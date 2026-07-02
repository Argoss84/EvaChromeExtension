$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "Zip-Helpers.ps1")

$root = Split-Path -Parent $PSScriptRoot
$staging = Join-Path $root "dist\android-dev"
$adb = Join-Path $env:LOCALAPPDATA "Android\Sdk\platform-tools\adb.exe"

if (-not (Test-Path $adb)) {
  throw "adb introuvable. Installez Android SDK Platform-Tools ou lancez Android Studio."
}

if (Test-Path $staging) {
  try {
    Remove-Item $staging -Recurse -Force -ErrorAction Stop
  } catch {
    Write-Host "Reutilisation du dossier existant (fichiers verrouilles) : $staging"
  }
}

if (-not (Test-Path $staging)) {
  New-Item -ItemType Directory -Force -Path (Join-Path $staging "icons") | Out-Null
}

$files = @(
  "popup.html",
  "content.js",
  "style.css",
  "page-bridge.js",
  "browser-polyfill.js"
)

foreach ($file in $files) {
  Copy-Item (Join-Path $root $file) (Join-Path $staging $file) -Force
}

Copy-Item (Join-Path $root "manifest.firefox.json") (Join-Path $staging "manifest.json") -Force

foreach ($size in @(16, 32, 48, 128)) {
  Copy-Item (Join-Path $root "icons\icon$size.png") (Join-Path $staging "icons\icon$size.png") -Force
}

Write-Host ""
Write-Host "=== Evassistant - test Firefox Android ==="
Write-Host ""
Write-Host "1) Demarrez un emulateur Android (ou branchez un telephone en USB)."
Write-Host "2) Installez Firefox pour Android sur l'appareil si besoin."
Write-Host "3) Sur l'appareil : Firefox -> Parametres -> Outils de developpement"
Write-Host "   -> activer 'Deboggage a distance via USB'."
Write-Host "4) Relancez ce script une fois l'option activee."
Write-Host ""

$devices = & $adb devices | Select-String "device$" | ForEach-Object { ($_ -split "\s+")[0] } | Where-Object { $_ -ne "List" }
if (-not $devices) {
  throw "Aucun appareil Android detecte. Lancez un emulateur ou verifiez 'adb devices'."
}

$deviceId = $devices[0]
Write-Host "Appareil detecte : $deviceId"

$firefoxPackages = & $adb -s $deviceId shell pm list packages 2>$null | Select-String "org.mozilla"
if (-not $firefoxPackages) {
  throw "Firefox n'est pas installe sur $deviceId. Installez-le depuis le Play Store ou un APK Mozilla."
}

$firefoxApk = "org.mozilla.firefox"
if ($firefoxPackages -match "org.mozilla.firefox") {
  $firefoxApk = "org.mozilla.firefox"
} elseif ($firefoxPackages -match "org.mozilla.firefox_beta") {
  $firefoxApk = "org.mozilla.firefox_beta"
} elseif ($firefoxPackages -match "org.mozilla.fenix") {
  $firefoxApk = "org.mozilla.fenix"
}

Write-Host "APK Firefox utilise : $firefoxApk"
Write-Host "Source extension : $staging"
Write-Host ""

npx --yes web-ext run `
  -s $staging `
  -t firefox-android `
  --adb-bin $adb `
  --android-device $deviceId `
  --firefox-apk $firefoxApk
