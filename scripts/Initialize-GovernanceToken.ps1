[CmdletBinding()]
param(
  [switch]$Force,
  [string]$TokenFile
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'GovernanceToken.ps1')

$tokenPath = Get-GovernanceTokenPath -Path $TokenFile
if ((Test-Path -LiteralPath $tokenPath -PathType Leaf) -and -not $Force) {
  throw 'An encrypted governance key already exists. Re-run with -Force only when rotating the matching n8n Header Auth credential.'
}

$bytes = New-Object byte[] 32
$rng = [Security.Cryptography.RandomNumberGenerator]::Create()
try {
  $rng.GetBytes($bytes)
}
finally {
  $rng.Dispose()
}
$token = [Convert]::ToBase64String($bytes).Replace('+', '-').Replace('/', '_').TrimEnd('=')

$savedPath = Save-GovernanceToken -Token $token -Path $tokenPath
[Environment]::SetEnvironmentVariable('N8N_GOVERNANCE_TOKEN', $token, 'Process')
Set-Clipboard -Value $token

Write-Host 'A fresh governance key is stored with Windows user encryption and copied to the clipboard for one-time n8n credential binding.'
Write-Host "Encrypted key file: $savedPath"
Write-Host 'The plaintext key was not written to the repository or printed.'
Write-Host 'After saving the n8n credential, clear the clipboard because clipboard history or sync may retain copied values.'
