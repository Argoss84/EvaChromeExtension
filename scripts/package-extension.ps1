$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$root = Split-Path -Parent $PSScriptRoot
$manifest = Get-Content -LiteralPath (Join-Path $root "manifest.json") -Raw | ConvertFrom-Json
$version = [string]$manifest.version
if ($version -notmatch '^\d+\.\d+\.\d+(\.\d+)?$') {
  throw "Version de manifeste invalide : $version"
}

$distDir = Join-Path $root "dist"
$zipPath = Join-Path $distDir "evassistant.zip"
$releaseDir = Join-Path $distDir "store-$version"
$releaseZipPath = Join-Path $releaseDir "evassistant-$version.zip"

# Chrome Web Store exige des slashs dans les noms d'entrees du zip.
$entries = @(
  "manifest.json",
  "popup.html",
  "content.js",
  "style.css",
  "page-bridge.js",
  "icons/icon16.png",
  "icons/icon32.png",
  "icons/icon48.png",
  "icons/icon128.png"
)

foreach ($entryName in $entries) {
  $source = Join-Path $root ($entryName -replace "/", "\")
  if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
    throw "Fichier requis manquant : $entryName"
  }
}

$publicationFiles = @(
  @{ Source = "store-listing.txt"; Destination = "store-listing.txt" },
  @{ Source = "privacy-policy.html"; Destination = "privacy-policy.html" },
  @{ Source = "icons/icon128.png"; Destination = "icon128.png" },
  @{ Source = "STORE.md"; Destination = "guide-publication.md" },
  @{ Source = "RELEASE_NOTES.md"; Destination = "notes-version.md" }
)

foreach ($file in $publicationFiles) {
  if (-not (Test-Path -LiteralPath (Join-Path $root $file.Source) -PathType Leaf)) {
    throw "Document de publication manquant : $($file.Source)"
  }
}

New-Item -ItemType Directory -Force -Path $distDir | Out-Null
if (Test-Path -LiteralPath $zipPath) {
  Remove-Item -LiteralPath $zipPath -Force
}

$zip = [System.IO.Compression.ZipFile]::Open($zipPath, [System.IO.Compression.ZipArchiveMode]::Create)
try {
  foreach ($entryName in $entries) {
    $source = Join-Path $root ($entryName -replace "/", "\")
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
      $zip,
      $source,
      $entryName,
      [System.IO.Compression.CompressionLevel]::Optimal
    ) | Out-Null
  }
} finally {
  $zip.Dispose()
}

New-Item -ItemType Directory -Force -Path $releaseDir | Out-Null
Copy-Item -LiteralPath $zipPath -Destination $releaseZipPath -Force
foreach ($file in $publicationFiles) {
  Copy-Item -LiteralPath (Join-Path $root $file.Source) -Destination (Join-Path $releaseDir $file.Destination) -Force
}

$hash = (Get-FileHash -LiteralPath $releaseZipPath -Algorithm SHA256).Hash.ToLowerInvariant()
Set-Content -LiteralPath (Join-Path $releaseDir "SHA256SUMS.txt") -Value "$hash  evassistant-$version.zip" -Encoding ASCII

Write-Host "Package cree : $zipPath"
Write-Host "Dossier de publication : $releaseDir"
