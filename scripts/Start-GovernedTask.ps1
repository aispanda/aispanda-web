[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[A-Za-z][A-Za-z0-9]*-\d+$')]
  [string]$TaskId,

  [ValidateSet('local_build_start')]
  [string]$PermittedAction = 'local_build_start',

  [string]$RepositoryPath = (Get-Location).Path,

  [string]$N8nUri = $env:N8N_GOVERNANCE_URI,

  [string]$Caller = 'codex',

  [ValidateRange(1, 60)]
  [int]$TimeoutSec = 15
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'GovernanceToken.ps1')

$policyVersion = 'governance-policy-v1.1'
$contractVersion = 'story-contract-v2'
$defaultBranches = @('main', 'master', 'develop', 'development', 'trunk')

function Write-GateResult {
  param(
    [bool]$Approved,
    [string]$Code,
    [string]$Message,
    [hashtable]$Details = @{}
  )

  $result = [ordered]@{
    approved = $Approved
    code = $Code
    message = $Message
  }
  foreach ($entry in $Details.GetEnumerator()) {
    $result[$entry.Key] = $entry.Value
  }
  $result | ConvertTo-Json -Compress -Depth 8
}

function Stop-GovernedTask {
  param(
    [string]$Code,
    [string]$Message,
    [hashtable]$Details = @{}
  )

  Write-GateResult -Approved $false -Code $Code -Message $Message -Details $Details
  exit 1
}

function Get-GitValue {
  param([string[]]$Arguments)

  $value = & git -C $RepositoryPath @Arguments 2>$null
  if ($LASTEXITCODE -ne 0) {
    return $null
  }
  return ($value | Out-String).Trim()
}

function Normalize-Repository {
  param([string]$Value)

  $repository = $Value.Trim().Replace('\', '/')
  if ($repository -match '^git@([^:]+):(.+)$') {
    $repository = "$($Matches[1])/$($Matches[2])"
  } else {
    try {
      $uri = [Uri]$repository
      if ($uri.Host) {
        $repository = "$($uri.Host)$($uri.AbsolutePath)"
      }
    } catch {
      $repository = $repository -replace '^ssh://', ''
    }
  }
  return $repository.Trim('/').Replace('.git', '').ToLowerInvariant()
}

function Test-ExactString {
  param($Actual, [string]$Expected)
  return $Actual -is [string] -and $Actual -ceq $Expected
}

function Test-RevisionTimestamp {
  param($Value)

  if ($null -eq $Value -or [string]::IsNullOrWhiteSpace([string]$Value)) {
    return $false
  }
  try {
    [DateTimeOffset]::Parse([string]$Value) | Out-Null
    return $true
  } catch {
    return $false
  }
}

function Get-ResponseProperty {
  param($Response, [string]$Name)

  if ($null -eq $Response -or $null -eq $Response.PSObject) {
    return $null
  }
  $property = $Response.PSObject.Properties[$Name]
  if ($null -eq $property) {
    return $null
  }
  return $property.Value
}

$canonicalTaskId = $TaskId.Trim().ToUpperInvariant()
if ([string]::IsNullOrWhiteSpace($N8nUri)) {
  Stop-GovernedTask -Code 'MISSING_N8N_URI' -Message 'N8N_GOVERNANCE_URI must point to the localhost authorize_build_start endpoint.'
}

try {
  $uri = [Uri]$N8nUri
} catch {
  Stop-GovernedTask -Code 'INVALID_N8N_URI' -Message 'N8N_GOVERNANCE_URI must be an absolute localhost URI.'
}
if ($uri.Scheme -notin @('http', 'https') -or $uri.Host -notin @('127.0.0.1', 'localhost')) {
  Stop-GovernedTask -Code 'INVALID_N8N_URI' -Message 'The governed launcher only calls a localhost n8n endpoint.'
}

$headerName = if ($env:N8N_GOVERNANCE_HEADER_NAME) { $env:N8N_GOVERNANCE_HEADER_NAME } else { 'X-Governance-Key' }
try {
  $headerValue = Get-GovernanceToken
}
catch {
  Stop-GovernedTask -Code 'INVALID_N8N_AUTH' -Message 'The Windows-encrypted local governance key is unreadable; rotate and rebind it before governed work.'
}
if ([string]::IsNullOrWhiteSpace($headerValue)) {
  Stop-GovernedTask -Code 'MISSING_N8N_AUTH' -Message 'A process key or Windows-encrypted local governance key is required; plaintext must not be stored in the repository.'
}
if ($headerName -match '[\r\n:]') {
  Stop-GovernedTask -Code 'INVALID_N8N_AUTH' -Message 'N8N_GOVERNANCE_HEADER_NAME is invalid.'
}

$gitRoot = Get-GitValue -Arguments @('rev-parse', '--show-toplevel')
if ([string]::IsNullOrWhiteSpace($gitRoot)) {
  Stop-GovernedTask -Code 'NOT_A_GIT_REPOSITORY' -Message 'The launcher must run inside a Git repository.'
}

$origin = Get-GitValue -Arguments @('remote', 'get-url', 'origin')
if ([string]::IsNullOrWhiteSpace($origin)) {
  Stop-GovernedTask -Code 'MISSING_GIT_ORIGIN' -Message 'The repository must have an origin remote.' -Details @{ git_root = $gitRoot }
}
$repository = Normalize-Repository -Value $origin
if ($repository -notmatch '^[a-z0-9.-]+/[^\s/]+/[^\s/]+$') {
  Stop-GovernedTask -Code 'INVALID_GIT_ORIGIN' -Message 'The origin remote is not a supported host/owner/repository identity.' -Details @{ git_root = $gitRoot }
}

$branch = Get-GitValue -Arguments @('symbolic-ref', '--quiet', '--short', 'HEAD')
if ([string]::IsNullOrWhiteSpace($branch)) {
  Stop-GovernedTask -Code 'DETACHED_HEAD' -Message 'Governed work cannot start from a detached HEAD.' -Details @{ git_root = $gitRoot; repository = $repository }
}
if ($defaultBranches -contains $branch.ToLowerInvariant()) {
  Stop-GovernedTask -Code 'DEFAULT_BRANCH' -Message 'Governed work cannot start from a default branch.' -Details @{ git_root = $gitRoot; repository = $repository; branch_name = $branch }
}
$taskPattern = "(^|[/_.-])$([regex]::Escape($canonicalTaskId))($|[/_.-])"
if ($branch -notmatch $taskPattern) {
  Stop-GovernedTask -Code 'BRANCH_TASK_MISMATCH' -Message "The actual branch is not associated with $canonicalTaskId." -Details @{ git_root = $gitRoot; repository = $repository; branch_name = $branch; task_id = $canonicalTaskId }
}

$headSha = Get-GitValue -Arguments @('rev-parse', 'HEAD')
if ($headSha -notmatch '^[0-9a-f]{40}$|^[0-9a-f]{64}$') {
  Stop-GovernedTask -Code 'INVALID_HEAD_SHA' -Message 'The current Git HEAD is not a full object ID.' -Details @{ git_root = $gitRoot; repository = $repository; branch_name = $branch }
}

$request = [ordered]@{
  task_id = $canonicalTaskId
  branch_name = $branch
  head_sha = $headSha
  repository = $repository
  caller = $Caller
  permitted_action = $PermittedAction
  governance_policy_version = $policyVersion
  story_contract_version = $contractVersion
}

try {
  $response = Invoke-RestMethod -Method Post -Uri $uri.AbsoluteUri -ContentType 'application/json' -Headers @{ $headerName = $headerValue } -Body ($request | ConvertTo-Json -Compress) -TimeoutSec $TimeoutSec -MaximumRedirection 0
} catch {
  Stop-GovernedTask -Code 'N8N_UNAVAILABLE' -Message 'n8n did not return a usable authorization response.' -Details @{ task_id = $canonicalTaskId; branch_name = $branch; repository = $repository }
}

$responseViolationCodes = Get-ResponseProperty -Response $response -Name 'violation_codes'
$hasViolationCodes = $null -ne $response.PSObject.Properties['violation_codes']
$violations = @()
if ($null -ne $responseViolationCodes) {
  $violations = @($responseViolationCodes)
}
$responseOutcome = Get-ResponseProperty -Response $response -Name 'outcome'
$responseBuildAllowed = Get-ResponseProperty -Response $response -Name 'build_allowed'
$responseOk = Get-ResponseProperty -Response $response -Name 'ok'
$responseContractComplete = Get-ResponseProperty -Response $response -Name 'contract_complete'
$responseGovernanceCompliant = Get-ResponseProperty -Response $response -Name 'governance_compliant'
$responseRuntimeValid = Get-ResponseProperty -Response $response -Name 'runtime_valid'
$responseTaskId = Get-ResponseProperty -Response $response -Name 'task_id'
$responseBranchName = Get-ResponseProperty -Response $response -Name 'branch_name'
$responseRepository = Get-ResponseProperty -Response $response -Name 'repository'
$responsePermittedAction = Get-ResponseProperty -Response $response -Name 'permitted_action'
$responsePolicyVersion = Get-ResponseProperty -Response $response -Name 'governance_policy_version'
$responseContractVersion = Get-ResponseProperty -Response $response -Name 'story_contract_version'
$responseContractHash = Get-ResponseProperty -Response $response -Name 'contract_hash'
$responseHashAlgorithm = Get-ResponseProperty -Response $response -Name 'contract_hash_algorithm'
$responseLinearRevision = Get-ResponseProperty -Response $response -Name 'linear_updated_at'
$checks = [ordered]@{
  outcome = (Test-ExactString -Actual $responseOutcome -Expected 'PASS')
  build_allowed = ($responseBuildAllowed -is [bool] -and $responseBuildAllowed)
  ok = ($responseOk -is [bool] -and $responseOk)
  contract_complete = ($responseContractComplete -is [bool] -and $responseContractComplete)
  governance_compliant = ($responseGovernanceCompliant -is [bool] -and $responseGovernanceCompliant)
  runtime_valid = ($responseRuntimeValid -is [bool] -and $responseRuntimeValid)
  task_id = (Test-ExactString -Actual $responseTaskId -Expected $canonicalTaskId)
  branch_name = (Test-ExactString -Actual $responseBranchName -Expected $branch)
  repository = (Test-ExactString -Actual (Normalize-Repository -Value ([string]$responseRepository)) -Expected $repository)
  permitted_action = (Test-ExactString -Actual $responsePermittedAction -Expected $PermittedAction)
  governance_policy_version = (Test-ExactString -Actual $responsePolicyVersion -Expected $policyVersion)
  story_contract_version = (Test-ExactString -Actual $responseContractVersion -Expected $contractVersion)
  violation_codes = ($hasViolationCodes -and $violations.Count -eq 0)
  contract_hash = ($responseContractHash -is [string] -and $responseContractHash -match '^[0-9a-f]{64}$')
  contract_hash_algorithm = (Test-ExactString -Actual $responseHashAlgorithm -Expected 'sha256')
  linear_updated_at = (Test-RevisionTimestamp -Value $responseLinearRevision)
}
$responseValid = -not ($checks.Values -contains $false)

if (-not $responseValid) {
  $invalidFields = @($checks.GetEnumerator() | Where-Object { -not $_.Value } | ForEach-Object { $_.Key })
  Stop-GovernedTask -Code 'N8N_REJECTED' -Message 'n8n did not return an exact local PASS authorization decision.' -Details @{ task_id = $canonicalTaskId; branch_name = $branch; repository = $repository; violation_codes = $violations; invalid_response_fields = $invalidFields }
}

Write-GateResult -Approved $true -Code 'PASS' -Message 'The local governed build-start check passed.' -Details @{
  task_id = $canonicalTaskId
  branch_name = $branch
  head_sha = $headSha
  repository = $repository
  permitted_action = $PermittedAction
  contract_hash = $response.contract_hash
  linear_updated_at = $response.linear_updated_at
  governance_policy_version = $policyVersion
  story_contract_version = $contractVersion
}
