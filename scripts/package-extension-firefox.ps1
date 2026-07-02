$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "Zip-Helpers.ps1")

$root = Split-Path -Parent $PSScriptRoot
$distDir = Join-Path $root "dist"
$zipPath = Join-Path $distDir "evassistant-firefox.zip"
$stagingDir = Join-Path $distDir "staging-firefox"

if (Test-Path $stagingDir) {
  Remove-Item $stagingDir -Recurse -Force
}

New-Item -ItemType Directory -Force -Path $stagingDir | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $stagingDir "icons") | Out-Null

$files = @(
  "popup.html",
  "content.js",
  "style.css",
  "page-bridge.js",
  "browser-polyfill.js"
)

foreach ($file in $files) {
  Copy-Item (Join-Path $root $file) (Join-Path $stagingDir $file)
}

# Le manifest Firefox est distinct (browser_specific_settings requis pour la signature AMO).
Copy-Item (Join-Path $root "manifest.firefox.json") (Join-Path $stagingDir "manifest.json")

$iconSizes = @(16, 32, 48, 128)
foreach ($size in $iconSizes) {
  $iconName = "icon$size.png"
  Copy-Item (Join-Path $root "icons\$iconName") (Join-Path $stagingDir "icons\$iconName")
}

New-ExtensionZip -SourceDir $stagingDir -ZipPath $zipPath
Remove-Item $stagingDir -Recurse -Force

Write-Host "Package Firefox cree : $zipPath"
Write-Host "A soumettre sur https://addons.mozilla.org/developers/"
