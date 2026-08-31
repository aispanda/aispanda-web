import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workflowUrl = new URL('../.github/workflows/ai-governance.yml', import.meta.url);

test('protected merge workflow uses exact PR head facts and executes no candidate code', async () => {
  const source = await readFile(workflowUrl, 'utf8');
  assert.match(source, /pull_request_target:/);
  assert.match(source, /branches: \[main\]/);
  assert.match(source, /if: github\.event\.pull_request\.head\.repo\.full_name == github\.repository/);
  assert.match(source, /runs-on: \[self-hosted, windows, x64, ai-governance\]/);
  assert.match(source, /permissions:\s*\{\}/);
  assert.match(source, /contents: read/);
  assert.match(source, /statuses: write/);
  assert.match(source, /AI95_PR_HEAD_REPOSITORY: \$\{\{ github\.event\.pull_request\.head\.repo\.full_name \}\}/);
  assert.match(source, /AI95_PR_HEAD_REF: \$\{\{ github\.event\.pull_request\.head\.ref \}\}/);
  assert.match(source, /AI95_PR_HEAD_SHA: \$\{\{ github\.event\.pull_request\.head\.sha \}\}/);
  assert.match(source, /AI95_N8N_KEY: \$\{\{ secrets\.N8N_GOVERNANCE_TOKEN \}\}/);
  assert.match(source, /shell: pwsh/);
  assert.match(source, /\[CmdletBinding\(\)\]/);
  assert.match(source, /param\([\s\S]*\$GovernanceUri[\s\S]*\$GitHubApiBaseUri[\s\S]*\$TimeoutSec[\s\S]*\$MaxAttempts[\s\S]*\)/);
  assert.doesNotMatch(source, /actions\/checkout|github\.head_ref|pull_request\.title|pull_request\.body|Invoke-Expression|iex\b/i);
});

test('generated workflow embeds the reviewed PowerShell source exactly', async () => {
  const workflow = (await readFile(workflowUrl, 'utf8')).replace(/\r\n?/g, '\n');
  const script = (await readFile(new URL('../scripts/Invoke-AI95PullRequestGovernance.ps1', import.meta.url), 'utf8'))
    .replace(/\r\n?/g, '\n')
    .trimEnd();
  const embedded = script
    .split('\n')
    .map((line) => (line === '' ? '' : `          ${line}`))
    .join('\n');
  assert.ok(workflow.includes(`        run: |\n${embedded}\n`));
});
