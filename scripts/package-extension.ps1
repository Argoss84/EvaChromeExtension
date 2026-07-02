$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "Zip-Helpers.ps1")

$root = Split-Path -Parent $PSScriptRoot
$distDir = Join-Path $root "dist"
$zipPath = Join-Path $distDir "evassistant.zip"
$stagingDir = Join-Path $distDir "staging"

if (Test-Path $stagingDir) {
  Remove-Item $stagingDir -Recurse -Force
}

New-Item -ItemType Directory -Force -Path $stagingDir | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $stagingDir "icons") | Out-Null

$files = @(
  "manifest.json",
  "popup.html",
  "content.js",
  "style.css",
  "page-bridge.js",
  "browser-polyfill.js"
)

foreach ($file in $files) {
  Copy-Item (Join-Path $root $file) (Join-Path $stagingDir $file)
}

$iconSizes = @(16, 32, 48, 128)
foreach ($size in $iconSizes) {
  $iconName = "icon$size.png"
  Copy-Item (Join-Path $root "icons\$iconName") (Join-Path $stagingDir "icons\$iconName")
}

New-ExtensionZip -SourceDir $stagingDir -ZipPath $zipPath
Remove-Item $stagingDir -Recurse -Force

Write-Host "Package cree : $zipPath"
