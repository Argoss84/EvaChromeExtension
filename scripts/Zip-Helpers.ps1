Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

# Compress-Archive écrit des antislashs (\) comme séparateurs de chemin pour les
# fichiers situés dans des sous-dossiers, ce qui produit des entrées ZIP invalides
# (le format ZIP impose "/"). C'est notamment rejeté par le validateur d'addons.mozilla.org
# avec l'erreur "Invalid file name in archive: icons\icon128.png".
# On construit donc l'archive manuellement avec des chemins toujours normalisés en "/".
function New-ExtensionZip {
  param(
    [Parameter(Mandatory = $true)][string]$SourceDir,
    [Parameter(Mandatory = $true)][string]$ZipPath
  )

  if (Test-Path $ZipPath) {
    Remove-Item $ZipPath -Force
  }

  $resolvedSourceDir = (Resolve-Path $SourceDir).Path
  $zip = [System.IO.Compression.ZipFile]::Open($ZipPath, [System.IO.Compression.ZipArchiveMode]::Create)

  try {
    Get-ChildItem -Path $resolvedSourceDir -Recurse -File | ForEach-Object {
      $relativePath = $_.FullName.Substring($resolvedSourceDir.Length + 1).Replace('\', '/')
      [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
        $zip,
        $_.FullName,
        $relativePath,
        [System.IO.Compression.CompressionLevel]::Optimal
      ) | Out-Null
    }
  } finally {
    $zip.Dispose()
  }
}
