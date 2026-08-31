import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const workflowUrl = new URL('../.github/workflows/ai-governance.yml', import.meta.url);
const scriptUrl = new URL('../scripts/Invoke-AI95PullRequestGovernance.ps1', import.meta.url);

function extractRunBody(workflow) {
  const marker = '        run: |\n';
  const start = workflow.indexOf(marker);
  assert.notEqual(start, -1, 'The generated workflow must contain one inline run block.');
  const block = workflow.slice(start + marker.length).replace(/\n$/, '');
  return block
    .split('\n')
    .map((line) => {
      if (line === '') return '';
      assert.match(line, /^ {10}/, 'Every non-empty run-block line must retain its YAML indentation.');
      return line.slice(10);
    })
    .join('\n');
}

async function runInsideGitHubPowerShellWrapper(body, envOverrides = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'ai-governance-wrapper-'));
  const path = join(directory, 'runner-wrapper.ps1');
  const wrapped = `$ErrorActionPreference = 'stop'\n${body}\nif ((Test-Path -LiteralPath variable:\\LASTEXITCODE)) { exit $LASTEXITCODE }\n`;
  const env = { ...process.env };
  for (const name of Object.keys(env)) {
    if (name.startsWith('AI95_')) delete env[name];
  }
  delete env.GITHUB_STEP_SUMMARY;
  Object.assign(env, envOverrides);

  try {
    await writeFile(path, wrapped, 'utf8');
    return await new Promise((resolve, reject) => {
      const child = spawn('pwsh', ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', path], {
        env,
        windowsHide: true,
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk) => { stdout += chunk; });
      child.stderr.on('data', (chunk) => { stderr += chunk; });
      child.once('error', reject);
      child.once('close', (code) => resolve({ code, stdout, stderr }));
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

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
  assert.match(source, /run: \|\r?\n\s+& \{\r?\n\s+\[CmdletBinding\(\)\]/);
  assert.match(source, /\[CmdletBinding\(\)\]/);
  assert.match(source, /param\([\s\S]*\$GovernanceUri[\s\S]*\$GitHubApiBaseUri[\s\S]*\$TimeoutSec[\s\S]*\$MaxAttempts[\s\S]*\)/);
  assert.doesNotMatch(source, /actions\/checkout|github\.head_ref|pull_request\.title|pull_request\.body|Invoke-Expression|iex\b/i);
});

test('generated workflow embeds the reviewed PowerShell source exactly inside a runner-safe block', async () => {
  const workflow = (await readFile(workflowUrl, 'utf8')).replace(/\r\n?/g, '\n');
  const script = (await readFile(scriptUrl, 'utf8'))
    .replace(/\r\n?/g, '\n')
    .trimEnd();
  const embedded = script
    .split('\n')
    .map((line) => (line === '' ? '' : `          ${line}`))
    .join('\n');
  assert.ok(workflow.includes(`        run: |\n          & {\n${embedded}\n          }\n`));
});

test('generated run block survives the GitHub PowerShell prelude that rejects the AI-99 form', async () => {
  const workflow = (await readFile(workflowUrl, 'utf8')).replace(/\r\n?/g, '\n');
  const script = (await readFile(scriptUrl, 'utf8')).replace(/\r\n?/g, '\n').trimEnd();

  const knownBad = await runInsideGitHubPowerShellWrapper(script);
  assert.notEqual(knownBad.code, 0);
  assert.match(`${knownBad.stdout}\n${knownBad.stderr}`, /Unexpected attribute ['\u2018\u2019]?CmdletBinding['\u2018\u2019]?|Unexpected attribute 'CmdletBinding'/i);

  const repaired = await runInsideGitHubPowerShellWrapper(extractRunBody(workflow));
  const output = `${repaired.stdout}\n${repaired.stderr}`;
  assert.equal(repaired.code, 1);
  assert.match(output, /MISSING_AI95_BASE_REPOSITORY/);
  assert.doesNotMatch(output, /ParserError|Unexpected attribute|param is not recognized/i);
});

test('generated run block reports a draft denial without losing shared governance context', async () => {
  const workflow = (await readFile(workflowUrl, 'utf8')).replace(/\r\n?/g, '\n');
  const directory = await mkdtemp(join(tmpdir(), 'ai-governance-summary-'));
  const summaryPath = join(directory, 'summary.md');

  try {
    const denied = await runInsideGitHubPowerShellWrapper(extractRunBody(workflow), {
      AI95_BASE_REPOSITORY: 'aispanda/aispanda-web',
      AI95_PR_HEAD_REPOSITORY: 'aispanda/aispanda-web',
      AI95_PR_HEAD_REF: 'codex/ai-62-central-ai-spanda-credential-foundation',
      AI95_PR_HEAD_SHA: '522bc9c411bc3f49341fdc436f763b9ebf036d31',
      AI95_PR_DRAFT: 'true',
      AI95_OPERATION_ID: 'github:pr:13:test:1',
      AI95_GITHUB_TOKEN: 'synthetic-github-token',
      AI95_N8N_KEY: 'synthetic-n8n-token',
      AI95_RUN_URL: 'https://example.invalid/actions/runs/test',
      GITHUB_STEP_SUMMARY: summaryPath,
    });
    const output = `${denied.stdout}\n${denied.stderr}`;
    const summary = await readFile(summaryPath, 'utf8');

    assert.equal(denied.code, 1);
    assert.match(output, /AI governance denied: DRAFT_PULL_REQUEST_REJECTED/);
    assert.doesNotMatch(output, /cannot be retrieved|ParserError|Unexpected attribute/i);
    assert.match(summary, /Task: `AI-62`/);
    assert.match(summary, /Action: `pr_merge_gate`/);
    assert.match(summary, /Caller: `github-actions`/);
    assert.match(summary, /Violation codes: `DRAFT_PULL_REQUEST_REJECTED`/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
