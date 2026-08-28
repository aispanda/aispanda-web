import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const scriptPath = fileURLToPath(new URL('../scripts/Invoke-AI95PullRequestGovernance.ps1', import.meta.url));
const headSha = 'f'.repeat(40);
const operationId = 'github:pr:95:00000001';

function listen(handler) {
  const server = createServer(handler);
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({
        server,
        url: `http://127.0.0.1:${address.port}`,
      });
    });
  });
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('error', reject);
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
}

function runPowerShell(args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn('pwsh', ['-NoProfile', '-File', scriptPath, ...args], {
      cwd: repoRoot,
      env: { ...process.env, ...env },
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (code) => resolve({ code, stdout, stderr }));
  });
}

function validDecision(overrides = {}) {
  return {
    ok: true,
    contract_complete: true,
    governance_compliant: true,
    runtime_valid: true,
    validation_passed: true,
    outcome: 'PASS',
    build_allowed: true,
    storage_verified: true,
    task_id: 'AI-95',
    repository: 'github.com/aispanda/aispanda-web',
    branch_name: 'codex/ai-95-governance-hardening',
    head_sha: headSha,
    permitted_action: 'pr_merge_gate',
    operation_id: operationId,
    caller: 'github-actions',
    governance_policy_version: 'governance-policy-v1.1',
    story_contract_version: 'story-contract-v2',
    contract_hash: 'b'.repeat(64),
    contract_hash_algorithm: 'sha256',
    linear_updated_at: '2026-08-28T22:00:00.000Z',
    baseline_code: 'BASELINE_CURRENT',
    authorization_mode: 'localhost_merge_verified',
    violation_codes: [],
    ...overrides,
  };
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

async function runScenario({
  decisions = [{ status: 200, body: validDecision() }],
  env: envOverrides = {},
  maxAttempts = 1,
} = {}) {
  const n8nRequests = [];
  const statuses = [];
  let decisionIndex = 0;
  const n8n = await listen(async (request, response) => {
    n8nRequests.push({ headers: request.headers, body: JSON.parse(await readBody(request)) });
    const selected = decisions[Math.min(decisionIndex, decisions.length - 1)];
    decisionIndex += 1;
    response.writeHead(selected.status, { 'content-type': 'application/json' });
    response.end(JSON.stringify(selected.body));
  });
  const github = await listen(async (request, response) => {
    statuses.push({ path: request.url, headers: request.headers, body: JSON.parse(await readBody(request)) });
    response.writeHead(201, { 'content-type': 'application/json' });
    response.end('{}');
  });
  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'ai95-merge-gate-'));
  const summaryPath = join(temporaryDirectory, 'summary.md');
  try {
    const result = await runPowerShell([
      '-GovernanceUri', `${n8n.url}/governance`,
      '-GitHubApiBaseUri', github.url,
      '-TimeoutSec', '3',
      '-MaxAttempts', String(maxAttempts),
    ], {
      AI95_BASE_REPOSITORY: 'aispanda/aispanda-web',
      AI95_PR_HEAD_REPOSITORY: 'aispanda/aispanda-web',
      AI95_PR_HEAD_REF: 'codex/ai-95-governance-hardening',
      AI95_PR_HEAD_SHA: headSha,
      AI95_PR_DRAFT: 'false',
      AI95_OPERATION_ID: operationId,
      AI95_GITHUB_TOKEN: 'test-github-token',
      AI95_N8N_KEY: 'test-n8n-key',
      AI95_RUN_URL: 'https://github.com/aispanda/aispanda-web/actions/runs/123',
      GITHUB_STEP_SUMMARY: summaryPath,
      ...envOverrides,
    });
    let summary = '';
    try {
      summary = await readFile(summaryPath, 'utf8');
    } catch {
      // Early input rejection intentionally creates no summary.
    }
    return { result, n8nRequests, statuses, summary };
  } finally {
    await Promise.all([closeServer(n8n.server), closeServer(github.server)]);
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

test('valid protected PR facts call n8n and post pending then success to the exact head SHA', async () => {
  const { result, n8nRequests, statuses, summary } = await runScenario();
  assert.equal(result.code, 0, result.stderr);
  assert.equal(n8nRequests.length, 1);
  assert.deepEqual(n8nRequests[0].body, {
    task_id: 'AI-95',
    governance_policy_version: 'governance-policy-v1.1',
    story_contract_version: 'story-contract-v2',
    permitted_action: 'pr_merge_gate',
    branch_name: 'codex/ai-95-governance-hardening',
    head_sha: headSha,
    repository: 'github.com/aispanda/aispanda-web',
    caller: 'github-actions',
    operation_id: operationId,
  });
  assert.equal(n8nRequests[0].headers['x-governance-key'], 'test-n8n-key');
  assert.deepEqual(statuses.map((entry) => entry.body.state), ['pending', 'success']);
  assert.ok(statuses.every((entry) => entry.path === `/repos/aispanda/aispanda-web/statuses/${headSha}`));
  assert.ok(statuses.every((entry) => entry.body.context === 'AI governance'));
  assert.match(summary, /Decision ID: `github:pr:95:00000001`/);
  assert.match(summary, /Outcome: `PASS`/);
  assert.doesNotMatch(summary, /Acceptance criteria|User story|test-github-token|test-n8n-key/i);
});

test('stale baseline preserves REPLAN and posts only a failure status after pending', async () => {
  const { result, statuses, summary } = await runScenario({
    decisions: [{
      status: 422,
      body: validDecision({ outcome: 'REPLAN', build_allowed: false, storage_verified: false, violation_codes: ['BASELINE_STALE'] }),
    }],
  });
  assert.equal(result.code, 1);
  assert.deepEqual(statuses.map((entry) => entry.body.state), ['pending', 'failure']);
  assert.match(statuses[1].body.description, /BASELINE_STALE/);
  assert.match(result.stderr, /BASELINE_STALE/);
  assert.doesNotMatch(result.stderr, /contract_hash|linear_updated_at|test-n8n-key/i);
  assert.match(summary, /Outcome: `REPLAN`/);
});

test('forks and hostile branch text are rejected before n8n or status writes', async () => {
  for (const env of [
    { AI95_PR_HEAD_REPOSITORY: 'attacker/fork' },
    { AI95_PR_HEAD_REF: 'codex/ai-95-safe;whoami' },
  ]) {
    const { result, n8nRequests, statuses } = await runScenario({ env });
    assert.equal(result.code, 1);
    assert.equal(n8nRequests.length, 0);
    assert.equal(statuses.length, 0);
    assert.doesNotMatch(result.stdout + result.stderr, /test-github-token|test-n8n-key/);
  }
});

test('mismatched n8n echo fails and posts failure on the exact candidate SHA', async () => {
  const { result, statuses, summary } = await runScenario({
    decisions: [{ status: 200, body: validDecision({ head_sha: 'a'.repeat(40) }) }],
  });
  assert.equal(result.code, 1);
  assert.deepEqual(statuses.map((entry) => entry.body.state), ['pending', 'failure']);
  assert.match(result.stderr, /N8N_RESPONSE_MISMATCH/);
  assert.match(summary, /N8N_RESPONSE_MISMATCH/);
  assert.ok(statuses.every((entry) => entry.path.endsWith(headSha)));
});

test('every security-critical PASS field is required and exact', async () => {
  const invalidResponses = [
    { ok: false },
    { contract_complete: false },
    { governance_compliant: false },
    { runtime_valid: false },
    { validation_passed: false },
    { caller: 'unexpected-caller' },
    { baseline_code: 'BASELINE_DUPLICATE' },
    { violation_codes: ['UNEXPECTED_VIOLATION'] },
    { contract_hash: 'not-a-sha256-hash' },
    { contract_hash_algorithm: 'sha512' },
    { linear_updated_at: 'not-a-revision-timestamp' },
  ];
  for (const overrides of invalidResponses) {
    const { result, statuses } = await runScenario({
      decisions: [{ status: 200, body: validDecision(overrides) }],
    });
    assert.equal(result.code, 1, JSON.stringify(overrides));
    assert.deepEqual(statuses.map((entry) => entry.body.state), ['pending', 'failure']);
    assert.match(result.stderr, /N8N_RESPONSE_MISMATCH/);
  }
});

test('one retry rereads n8n and cannot pass until a fresh exact response is returned', async () => {
  const { result, n8nRequests, statuses } = await runScenario({
    maxAttempts: 2,
    decisions: [
      { status: 502, body: { outcome: 'FAIL', violation_codes: ['LINEAR_QUERY_FAILED'] } },
      { status: 200, body: validDecision() },
    ],
  });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(n8nRequests.length, 2);
  assert.deepEqual(n8nRequests[0].body, n8nRequests[1].body);
  assert.deepEqual(statuses.map((entry) => entry.body.state), ['pending', 'success']);
});
