import assert from 'node:assert/strict';
import { execFile as execFileCallback, spawn } from 'node:child_process';
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';

const execFile = promisify(execFileCallback);
const launcher = fileURLToPath(new URL('../scripts/Start-GovernedTask.ps1', import.meta.url));
const tokenHelper = fileURLToPath(new URL('../scripts/GovernanceToken.ps1', import.meta.url));

async function git(directory, ...args) {
  const { stdout } = await execFile('git', ['-C', directory, ...args]);
  return stdout.trim();
}

async function makeRepository(branch = 'codex/ai-93-launcher-test') {
  const directory = await mkdtemp(join(tmpdir(), 'governed-task-'));
  await git(directory, 'init');
  await git(directory, 'config', 'user.email', 'governance-test@example.test');
  await git(directory, 'config', 'user.name', 'Governance Test');
  await writeFile(join(directory, 'README.md'), 'governance launcher fixture\n');
  await git(directory, 'add', 'README.md');
  await git(directory, 'commit', '-m', 'fixture');
  await git(directory, 'branch', '-M', branch);
  await git(directory, 'remote', 'add', 'origin', 'https://github.com/aispanda/aispanda-web.git');
  return directory;
}

async function startServer(responseFactory) {
  const requests = [];
  const server = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    requests.push({ headers: request.headers, body: JSON.parse(body) });
    const result = await responseFactory(requests.at(-1));
    response.writeHead(result.status ?? 200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(result.body));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  return {
    requests,
    uri: `http://127.0.0.1:${address.port}/webhook/authorize-build-start`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

function localPass(request) {
  return {
    body: {
      outcome: 'PASS',
      ok: true,
      contract_complete: true,
      governance_compliant: true,
      runtime_valid: true,
      build_allowed: true,
      task_id: request.body.task_id,
      branch_name: request.body.branch_name,
      repository: request.body.repository,
      permitted_action: request.body.permitted_action,
      governance_policy_version: request.body.governance_policy_version,
      story_contract_version: request.body.story_contract_version,
      violation_codes: [],
      contract_hash: 'a'.repeat(64),
      contract_hash_algorithm: 'sha256',
      linear_updated_at: '2026-08-27T22:00:00.000Z',
    },
  };
}

async function protectTestToken(path, token) {
  await execFile('pwsh', [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-Command',
    ". $env:AI93_TOKEN_HELPER; Save-GovernanceToken -Token $env:AI93_TEST_TOKEN -Path $env:AI93_TEST_TOKEN_FILE | Out-Null",
  ], {
    env: {
      ...process.env,
      AI93_TOKEN_HELPER: tokenHelper,
      AI93_TEST_TOKEN: token,
      AI93_TEST_TOKEN_FILE: path,
    },
  });
}

async function invokeLauncher({ directory, uri, taskId = 'AI-93', token = 'test-secret', tokenFile, timeoutSec = 15 }) {
  const environment = { ...process.env };
  environment.N8N_GOVERNANCE_TOKEN_FILE = tokenFile ?? join(directory, '.missing-governance-token.dpapi');
  if (token === null) delete environment.N8N_GOVERNANCE_TOKEN;
  else environment.N8N_GOVERNANCE_TOKEN = token;
  const output = await new Promise((resolve, reject) => {
    const child = spawn('pwsh', [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-File', launcher,
      '-TaskId', taskId,
      '-RepositoryPath', directory,
      '-N8nUri', uri,
      '-Caller', 'launcher-test',
      '-TimeoutSec', String(timeoutSec),
    ], {
      env: environment,
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() }));
  });
  let result;
  try {
    result = JSON.parse(output.stdout);
  } catch {
    result = { code: 'LAUNCHER_OUTPUT_INVALID', stdout: output.stdout, stderr: output.stderr };
  }
  return { ...output, result };
}

async function fileExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function invokeCallerChain(options) {
  const marker = join(options.directory, 'governed-action.marker');
  const result = await invokeLauncher(options);
  if (result.code === 0) await writeFile(marker, 'governed action started\n');
  return { ...result, actionStarted: await fileExists(marker) };
}

test('launcher sends independently observed Git state and accepts only an exact local PASS', async (t) => {
  const directory = await makeRepository();
  const server = await startServer(localPass);
  t.after(async () => { await server.close(); await rm(directory, { recursive: true, force: true }); });

  const result = await invokeCallerChain({ directory, uri: server.uri });
  assert.equal(result.code, 0, JSON.stringify(result));
  assert.equal(result.result.approved, true);
  assert.equal(result.result.code, 'PASS');
  assert.equal(result.actionStarted, true);
  assert.equal(server.requests.length, 1);
  assert.equal(server.requests[0].headers['x-governance-key'], 'test-secret');
  assert.deepEqual(server.requests[0].body, {
    task_id: 'AI-93',
    branch_name: 'codex/ai-93-launcher-test',
    head_sha: await git(directory, 'rev-parse', 'HEAD'),
    repository: 'github.com/aispanda/aispanda-web',
    caller: 'launcher-test',
    permitted_action: 'local_build_start',
    governance_policy_version: 'governance-policy-v1.1',
    story_contract_version: 'story-contract-v2',
  });
  assert.doesNotMatch(result.stdout, /test-secret/);
});

test('launcher retrieves a DPAPI-protected key across processes without printing it', async (t) => {
  const directory = await makeRepository();
  const tokenFile = join(directory, 'governance-token.dpapi');
  const server = await startServer(localPass);
  t.after(async () => { await server.close(); await rm(directory, { recursive: true, force: true }); });

  await protectTestToken(tokenFile, 'dpapi-test-secret');
  const result = await invokeCallerChain({ directory, uri: server.uri, token: null, tokenFile });
  assert.equal(result.code, 0, JSON.stringify(result));
  assert.equal(result.result.code, 'PASS');
  assert.equal(server.requests[0].headers['x-governance-key'], 'dpapi-test-secret');
  assert.doesNotMatch(result.stdout, /dpapi-test-secret/);
  assert.doesNotMatch(result.stderr, /dpapi-test-secret/);
});

test('launcher fails closed when the DPAPI key is malformed', async (t) => {
  const directory = await makeRepository();
  const tokenFile = join(directory, 'governance-token.dpapi');
  const server = await startServer(localPass);
  t.after(async () => { await server.close(); await rm(directory, { recursive: true, force: true }); });

  await writeFile(tokenFile, 'not-a-dpapi-ciphertext\n');
  const result = await invokeCallerChain({ directory, uri: server.uri, token: null, tokenFile });
  assert.equal(result.code, 1);
  assert.equal(result.result.code, 'INVALID_N8N_AUTH');
  assert.equal(result.actionStarted, false);
  assert.equal(server.requests.length, 0);
});

test('launcher rejects an n8n response that is not an exact authorization decision', async (t) => {
  const directory = await makeRepository();
  const server = await startServer((request) => ({
    body: { ...localPass(request).body, build_allowed: false, outcome: 'REPLAN', violation_codes: ['INVALID_DEPLOYMENT'] },
  }));
  t.after(async () => { await server.close(); await rm(directory, { recursive: true, force: true }); });

  const result = await invokeCallerChain({ directory, uri: server.uri });
  assert.equal(result.code, 1);
  assert.equal(result.actionStarted, false);
  assert.deepEqual(result.result, {
    approved: false,
    code: 'N8N_REJECTED',
    message: 'n8n did not return an exact local PASS authorization decision.',
    task_id: 'AI-93',
    branch_name: 'codex/ai-93-launcher-test',
    repository: 'github.com/aispanda/aispanda-web',
    violation_codes: ['INVALID_DEPLOYMENT'],
    invalid_response_fields: ['outcome', 'build_allowed', 'violation_codes'],
  });
});

test('launcher refuses a wrong task branch before it calls n8n', async (t) => {
  const directory = await makeRepository('codex/ai-999-wrong-branch');
  const server = await startServer(localPass);
  t.after(async () => { await server.close(); await rm(directory, { recursive: true, force: true }); });

  const result = await invokeCallerChain({ directory, uri: server.uri });
  assert.equal(result.code, 1);
  assert.equal(result.actionStarted, false);
  assert.equal(result.result.code, 'BRANCH_TASK_MISMATCH');
  assert.equal(server.requests.length, 0);
});

test('launcher refuses a default branch before it calls n8n', async (t) => {
  const directory = await makeRepository('main');
  const server = await startServer(localPass);
  t.after(async () => { await server.close(); await rm(directory, { recursive: true, force: true }); });

  const result = await invokeCallerChain({ directory, uri: server.uri });
  assert.equal(result.code, 1);
  assert.equal(result.actionStarted, false);
  assert.equal(result.result.code, 'DEFAULT_BRANCH');
  assert.equal(server.requests.length, 0);
});

test('launcher fails closed when n8n is unavailable', async (t) => {
  const directory = await makeRepository();
  t.after(async () => { await rm(directory, { recursive: true, force: true }); });

  const result = await invokeCallerChain({ directory, uri: 'http://127.0.0.1:9/webhook/authorize-build-start' });
  assert.equal(result.code, 1);
  assert.equal(result.result.code, 'N8N_UNAVAILABLE');
  assert.equal(result.actionStarted, false);
});

test('launcher refuses a detached HEAD before it calls n8n', async (t) => {
  const directory = await makeRepository();
  await git(directory, 'checkout', '--detach');
  const server = await startServer(localPass);
  t.after(async () => { await server.close(); await rm(directory, { recursive: true, force: true }); });

  const result = await invokeCallerChain({ directory, uri: server.uri });
  assert.equal(result.code, 1);
  assert.equal(result.result.code, 'DETACHED_HEAD');
  assert.equal(result.actionStarted, false);
  assert.equal(server.requests.length, 0);
});

test('launcher refuses missing authentication before it calls n8n', async (t) => {
  const directory = await makeRepository();
  const server = await startServer(localPass);
  t.after(async () => { await server.close(); await rm(directory, { recursive: true, force: true }); });

  const result = await invokeCallerChain({ directory, uri: server.uri, token: null });
  assert.equal(result.code, 1);
  assert.equal(result.result.code, 'MISSING_N8N_AUTH');
  assert.equal(result.actionStarted, false);
  assert.equal(server.requests.length, 0);
});

test('launcher fails closed on wrong authentication without leaking the token', async (t) => {
  const directory = await makeRepository();
  const server = await startServer(() => ({ status: 401, body: { error: 'unauthorized' } }));
  t.after(async () => { await server.close(); await rm(directory, { recursive: true, force: true }); });

  const result = await invokeCallerChain({ directory, uri: server.uri, token: 'wrong-test-secret' });
  assert.equal(result.code, 1);
  assert.equal(result.result.code, 'N8N_UNAVAILABLE');
  assert.equal(result.actionStarted, false);
  assert.equal(server.requests[0].headers['x-governance-key'], 'wrong-test-secret');
  assert.doesNotMatch(result.stdout, /wrong-test-secret/);
});

test('launcher fails closed on malformed and Linear-failure responses', async (t) => {
  const directory = await makeRepository();
  t.after(async () => { await rm(directory, { recursive: true, force: true }); });

  for (const responseFactory of [
    () => ({ body: { unexpected: true } }),
    (request) => ({ body: { ...localPass(request).body, outcome: 'FAIL', build_allowed: false, violation_codes: ['LINEAR_QUERY_FAILED'] } }),
  ]) {
    const server = await startServer(responseFactory);
    const result = await invokeCallerChain({ directory, uri: server.uri });
    await server.close();
    assert.equal(result.code, 1, JSON.stringify(result));
    assert.equal(result.result.code, 'N8N_REJECTED', JSON.stringify(result));
    assert.equal(result.actionStarted, false);
  }
});

test('launcher rejects each identity, action, and version mismatch', async (t) => {
  const directory = await makeRepository();
  t.after(async () => { await rm(directory, { recursive: true, force: true }); });
  const cases = [
    ['task_id', 'AI-91'],
    ['repository', 'github.com/aispanda/another-repository'],
    ['branch_name', 'codex/ai-91-another-task'],
    ['permitted_action', 'another_action'],
    ['governance_policy_version', 'governance-policy-v9'],
    ['story_contract_version', 'story-contract-v9'],
  ];

  for (const [field, value] of cases) {
    const server = await startServer((request) => ({ body: { ...localPass(request).body, [field]: value } }));
    const result = await invokeCallerChain({ directory, uri: server.uri });
    await server.close();
    assert.equal(result.code, 1, field);
    assert.equal(result.result.code, 'N8N_REJECTED', field);
    assert.equal(result.actionStarted, false, field);
    assert.ok(result.result.invalid_response_fields.includes(field), field);
  }
});

test('launcher rejects timeout and loopback redirect without starting the caller action', async (t) => {
  const directory = await makeRepository();
  const delayed = await startServer(async (request) => {
    await new Promise((resolve) => setTimeout(resolve, 1_200));
    return localPass(request);
  });
  t.after(async () => { await delayed.close(); await rm(directory, { recursive: true, force: true }); });

  const timeout = await invokeCallerChain({ directory, uri: delayed.uri, timeoutSec: 1 });
  assert.equal(timeout.code, 1);
  assert.equal(timeout.result.code, 'N8N_UNAVAILABLE');
  assert.equal(timeout.actionStarted, false);

  const forwardedRequests = [];
  const target = createServer((request, response) => {
    forwardedRequests.push({ headers: request.headers });
    response.end('{}');
  });
  await new Promise((resolve) => target.listen(0, '127.0.0.1', resolve));
  const targetAddress = target.address();
  const redirect = createServer((request, response) => {
    response.writeHead(302, { location: `http://127.0.0.1:${targetAddress.port}/captured` });
    response.end();
  });
  await new Promise((resolve) => redirect.listen(0, '127.0.0.1', resolve));
  const redirectAddress = redirect.address();
  t.after(async () => {
    await new Promise((resolve) => redirect.close(resolve));
    await new Promise((resolve) => target.close(resolve));
  });

  const redirected = await invokeCallerChain({ directory, uri: `http://127.0.0.1:${redirectAddress.port}/webhook/authorize-build-start` });
  assert.equal(redirected.code, 1);
  assert.equal(redirected.result.code, 'N8N_UNAVAILABLE');
  assert.equal(redirected.actionStarted, false);
  assert.equal(forwardedRequests.length, 0);
});
