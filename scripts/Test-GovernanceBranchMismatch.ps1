[CmdletBinding()]
param(
  [string]$N8nUri = 'http://127.0.0.1:5678/webhook/authorize-build-start'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'GovernanceToken.ps1')

$token = Get-GovernanceToken
if ([string]::IsNullOrWhiteSpace($token)) {
  throw 'The local governance key is unavailable or unreadable. Run Initialize-GovernanceToken.ps1 and bind the matching n8n Header Auth credential.'
}

$headers = @{ 'X-Governance-Key' = $token }
$body = [ordered]@{
  task_id = 'AI-93'
  governance_policy_version = 'governance-policy-v1.1'
  story_contract_version = 'story-contract-v2'
  permitted_action = 'local_build_start'
  branch_name = 'codex/notai-93x'
  head_sha = 'd1bd88182eabea9378bb75452ecd6e5d814a1e1d'
  repository = 'github.com/aispanda/aispanda-web'
  caller = 'ai93-safe-test'
} | ConvertTo-Json -Compress

$statusCode = 200
try {
  $result = Invoke-RestMethod -Method Post -Uri $N8nUri -Headers $headers -ContentType 'application/json' -Body $body
}
catch {
  $response = $_.Exception.Response
  if ($null -eq $response) {
    throw
  }
  $statusCode = [int]$response.StatusCode
  $rawBody = $_.ErrorDetails.Message
  if ([string]::IsNullOrWhiteSpace($rawBody) -and $null -ne $response.PSObject.Methods['GetResponseStream']) {
    $reader = New-Object System.IO.StreamReader($response.GetResponseStream())
    try {
      $rawBody = $reader.ReadToEnd()
    }
    finally {
      $reader.Dispose()
    }
  }
  elseif ([string]::IsNullOrWhiteSpace($rawBody) -and $response -is [Net.Http.HttpResponseMessage]) {
    try {
      $rawBody = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
    }
    catch {
      $rawBody = $null
    }
  }
  if ([string]::IsNullOrWhiteSpace($rawBody)) {
    throw "n8n returned HTTP $statusCode with an empty response body."
  }
  $result = $rawBody | ConvertFrom-Json
}

if ($statusCode -ne 502) {
  throw "Expected HTTP 502 for the deliberately mismatched branch, but received HTTP $statusCode."
}
if ($result.outcome -ne 'FAIL') {
  throw "Expected outcome FAIL, but received '$($result.outcome)'."
}
if (-not (@($result.violation_codes) -contains 'BRANCH_TASK_MISMATCH')) {
  throw 'Expected BRANCH_TASK_MISMATCH in violation_codes.'
}
if ($result.candidate_build_allowed -ne $false -or $result.build_allowed -ne $false) {
  throw 'The deliberately mismatched branch was not denied safely.'
}

$result
