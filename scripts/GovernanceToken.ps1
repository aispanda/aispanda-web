Set-StrictMode -Version Latest

function Get-GovernanceTokenPath {
  param([string]$Path)

  if (-not [string]::IsNullOrWhiteSpace($Path)) {
    return [IO.Path]::GetFullPath($Path)
  }
  if (-not [string]::IsNullOrWhiteSpace($env:N8N_GOVERNANCE_TOKEN_FILE)) {
    return [IO.Path]::GetFullPath($env:N8N_GOVERNANCE_TOKEN_FILE)
  }
  return Join-Path $env:LOCALAPPDATA 'AIspanda\governance\n8n-governance-token.dpapi'
}

function Save-GovernanceToken {
  param(
    [Parameter(Mandatory = $true)][string]$Token,
    [string]$Path
  )

  $tokenPath = Get-GovernanceTokenPath -Path $Path
  $tokenDirectory = Split-Path -Parent $tokenPath
  New-Item -ItemType Directory -Path $tokenDirectory -Force | Out-Null
  $secureToken = ConvertTo-SecureString -String $Token -AsPlainText -Force
  $protectedToken = ConvertFrom-SecureString -SecureString $secureToken
  Set-Content -LiteralPath $tokenPath -Value $protectedToken -Encoding utf8
  return $tokenPath
}

function Get-GovernanceToken {
  param([string]$Path)

  if (-not [string]::IsNullOrWhiteSpace($env:N8N_GOVERNANCE_TOKEN)) {
    return $env:N8N_GOVERNANCE_TOKEN
  }

  $tokenPath = Get-GovernanceTokenPath -Path $Path
  if (-not (Test-Path -LiteralPath $tokenPath -PathType Leaf)) {
    return $null
  }

  try {
    $protectedToken = (Get-Content -Raw -LiteralPath $tokenPath).Trim()
    if ([string]::IsNullOrWhiteSpace($protectedToken)) {
      return $null
    }
    $secureToken = ConvertTo-SecureString -String $protectedToken
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken)
    try {
      return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    }
    finally {
      [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
    }
  }
  catch {
    throw [IO.InvalidDataException]::new('The Windows-encrypted governance key is unreadable or cannot be decrypted by this user.')
  }
}
