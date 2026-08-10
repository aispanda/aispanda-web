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

$sourceFiles = Get-ChildItem -LiteralPath $source -Recurse -File
if ($sourceFiles.Count -eq 0 -or $sourceFiles.Where({ $_.Extension -eq '.map' }).Count -gt 0) {
    throw 'Source build is empty or contains source maps.'
}

$sourceIndexText = Get-Content -LiteralPath $sourceIndex -Raw
if ($sourceIndexText -notmatch '(?:src|href)="\./assets/' -or $sourceIndexText -match '(?:src|href)="/assets/') {
    throw 'Source build must use relative asset paths for the nested lab route.'
}

$forbiddenPatterns = @(
    '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}',
    'correlation_id',
    'identity_subject',
    'outbox_events',
    'tenant_id',
    'C:\\Personal',
    'postgresql(?:\+psycopg)?://'
)

foreach ($file in $sourceFiles.Where({ $_.Extension -in @('.html', '.js', '.css', '.json', '.txt') })) {
    $content = Get-Content -LiteralPath $file.FullName -Raw
    foreach ($pattern in $forbiddenPatterns) {
        if ($content -match $pattern) {
            throw "Public boundary check failed for $($file.FullName): $pattern"
        }
    }
}

$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$publicRoot = (Resolve-Path -LiteralPath (Join-Path $projectRoot 'public')).Path
$labsRoot = Join-Path $publicRoot 'labs'
$destination = Join-Path $labsRoot 'supportzero-case-workspace'
$expectedPrefix = $labsRoot + [IO.Path]::DirectorySeparatorChar

if (-not $destination.StartsWith($expectedPrefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to write outside the project public/labs directory: $destination"
}

if (Test-Path -LiteralPath $destination) {
    Remove-Item -LiteralPath $destination -Recurse -Force
}

New-Item -ItemType Directory -Path $destination -Force | Out-Null
Copy-Item -Path (Join-Path $source '*') -Destination $destination -Recurse -Force

$copiedIndex = Join-Path $destination 'index.html'
if (-not (Test-Path -LiteralPath $copiedIndex -PathType Leaf)) {
    throw 'SupportZero workspace copy did not produce index.html.'
}

$fileCount = (Get-ChildItem -LiteralPath $destination -Recurse -File).Count
Write-Host "SupportZero Case Workspace synced: $fileCount files -> $destination"
