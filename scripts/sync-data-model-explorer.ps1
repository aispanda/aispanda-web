[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$SourceBuild
)

$ErrorActionPreference = 'Stop'

$source = (Resolve-Path -LiteralPath $SourceBuild).Path
$sourceIndex = Join-Path $source 'index.html'
if (-not (Test-Path -LiteralPath $sourceIndex -PathType Leaf)) {
    throw "Source build is missing index.html: $source"
}

$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$destination = Join-Path $projectRoot 'public\labs\data-model-explorer'
$expectedPrefix = (Join-Path $projectRoot 'public\labs') + [IO.Path]::DirectorySeparatorChar
$resolvedPublic = (Resolve-Path -LiteralPath (Join-Path $projectRoot 'public')).Path

if (-not $destination.StartsWith($expectedPrefix, [StringComparison]::OrdinalIgnoreCase) -or
    -not $destination.StartsWith($resolvedPublic, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to write outside the project public/labs directory: $destination"
}

if (Test-Path -LiteralPath $destination) {
    Remove-Item -LiteralPath $destination -Recurse -Force
}

New-Item -ItemType Directory -Path $destination -Force | Out-Null
Copy-Item -Path (Join-Path $source '*') -Destination $destination -Recurse -Force

$copiedIndex = Get-Content -LiteralPath (Join-Path $destination 'index.html') -Raw
if ($copiedIndex -notmatch '/labs/data-model-explorer/') {
    throw 'The explorer was not built for /labs/data-model-explorer/. Rebuild it with the correct Vite base path.'
}

$fileCount = (Get-ChildItem -LiteralPath $destination -Recurse -File).Count
Write-Host "Data Model Explorer synced: $fileCount files -> $destination"
