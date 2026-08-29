import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { resolveConsumerProfile } from '../server/governance-consumers.mjs';

const workflowPath = new URL('../workflows/authorize-build-start-ai95.integration-candidate.local.json', import.meta.url);
const contractFixturePath = new URL('./fixtures/governance-contract-v2.json', import.meta.url);

async function loadWorkflow() {
  return JSON.parse(await readFile(workflowPath, 'utf8'));
}

function workflowNode(workflow, name) {
  const result = workflow.nodes.find((candidate) => candidate.name === name);
  assert.ok(result, `missing workflow node: ${name}`);
  return result;
}

function destination(workflow, from, output = 0) {
  const connections = workflow.connections[from]?.main?.[output];
  assert.equal(connections?.length, 1, `${from} output ${output} must have one destination`);
  return connections[0].node;
}

function parentDecision(overrides = {}) {
  return {
    contract_version: '2.0',
    governance_policy_version: 'governance-policy-v1.1',
    story_contract_version: 'story-contract-v2',
    ok: true,
    contract_complete: true,
    governance_compliant: true,
    runtime_valid: true,
    candidate_build_allowed: true,
    task_id: 'AI-95',
    branch_name: 'codex/ai-95-governance-hardening',
    head_sha: 'a'.repeat(40),
    repository: 'github.com/aispanda/aispanda-web',
    caller: 'codex',
    operation_id: 'ai95:build:00000001',
    permitted_action: 'local_build_start',
    contract_hash: 'b'.repeat(64),
    contract_hash_algorithm: 'sha256',
    linear_updated_at: '2026-08-28T22:00:00.000Z',
    violation_codes: [],
    outcome: 'PASS',
    response_status: 200,
    validation_passed: true,
    build_allowed: true,
    ...overrides,
  };
}

function matchingBaseline(parent, overrides = {}) {
  return {
    status: 'active',
    operation_id: parent.operation_id,
    request_fingerprint: 'c'.repeat(64),
    task_id: parent.task_id,
    repository: parent.repository,
    branch_name: parent.branch_name,
    head_sha: parent.head_sha,
    caller_identity: parent.caller,
    permitted_action: parent.permitted_action,
    governance_policy_version: parent.governance_policy_version,
    story_contract_version: parent.story_contract_version,
    linear_updated_at: parent.linear_updated_at,
    contract_hash: parent.contract_hash,
    ...overrides,
  };
}

function runFinalizer(code, child, parent) {
  return new Function('$json', '$', code)(child, (name) => {
    assert.equal(name, 'Classify Authorization Outcome');
    return { first: () => ({ json: parent }) };
  }).json;
}

test('inactive candidate calls storage only after an exact parent PASS', async () => {
  const workflow = await loadWorkflow();
  assert.equal(workflow.active, false);
  assert.equal(workflow.settings.availableInMCP, false);
  assert.equal(workflowNode(workflow, 'Authorized Build-Start Request').parameters.path, 'authorize-build-start-ai95-candidate');
  assert.equal(workflowNode(workflow, 'Authorized Build-Start Request').parameters.authentication, 'headerAuth');
  assert.equal(workflowNode(workflow, 'Governance Consumer Build-Start Request').parameters.path, 'authorize-build-start-ai99-governance-candidate');
  assert.equal(workflowNode(workflow, 'Governance Consumer Build-Start Request').parameters.authentication, 'headerAuth');
  assert.equal(workflowNode(workflow, 'Governance Consumer Build-Start Request').credentials, undefined);
  assert.equal(destination(workflow, 'Governance Consumer Build-Start Request'), 'Normalize Governance Consumer Request');
  assert.equal(destination(workflow, 'Normalize Governance Consumer Request'), 'Authorization Request Context');
  assert.equal(destination(workflow, 'Normalize Authorization Request'), 'Authorization Request Context');
  assert.equal(destination(workflow, 'Authorization Request Context'), 'Request Has Task ID');
  assert.equal(destination(workflow, 'Classify Authorization Outcome'), 'Parent Authorization Passed');
  assert.equal(destination(workflow, 'Parent Authorization Passed', 0), 'Prepare Governance Baseline');
  assert.equal(destination(workflow, 'Parent Authorization Passed', 1), 'Respond Authorization Outcome');
  assert.equal(destination(workflow, 'Prepare Governance Baseline'), 'Store Governance Baseline');
  assert.equal(destination(workflow, 'Store Governance Baseline'), 'Finalize Persisted Authorization');
  assert.equal(destination(workflow, 'Finalize Persisted Authorization'), 'Respond Authorization Outcome');

  const nodeNames = new Set(workflow.nodes.map((candidate) => candidate.name));
  for (const [source, connection] of Object.entries(workflow.connections)) {
    assert.ok(nodeNames.has(source), `connection source must exist: ${source}`);
    for (const outputs of connection.main ?? []) {
      for (const target of outputs ?? []) assert.ok(nodeNames.has(target.node), `${source} targets missing node ${target.node}`);
    }
  }

  const store = workflowNode(workflow, 'Store Governance Baseline');
  assert.equal(store.parameters.workflowId.value, '__AI95_BASELINE_WORKFLOW_ID__');
  assert.deepEqual(
    store.parameters.workflowInputs.schema.map((entry) => entry.id),
    ['task_id', 'repository', 'branch_name', 'head_sha', 'caller_identity', 'permitted_action', 'operation_id', 'governance_policy_version', 'story_contract_version', 'linear_updated_at', 'contract_hash', 'build_allowed'],
  );
  assert.equal(store.onError, 'continueErrorOutput');
  assert.equal(destination(workflow, 'Store Governance Baseline', 1), 'Respond Baseline Dependency Error');
});

test('operation ID and all governed facts propagate unchanged to the child', async () => {
  const workflow = await loadWorkflow();
  const normalize = workflowNode(workflow, 'Normalize Authorization Request').parameters.jsCode;
  const normalized = new Function('$json', normalize)({ body: {
    task_id: 'ai-95',
    governance_policy_version: 'governance-policy-v1.1',
    story_contract_version: 'story-contract-v2',
    permitted_action: 'local_build_start',
    branch_name: 'codex/ai-95-governance-hardening',
    head_sha: 'A'.repeat(40),
    repository: 'https://github.com/aispanda/aispanda-web.git',
    caller: 'codex',
    operation_id: 'ai95:build:00000001',
  } }).json;
  assert.equal(normalized.runtime.operation_id, 'ai95:build:00000001');

  const parent = parentDecision();
  const prepare = workflowNode(workflow, 'Prepare Governance Baseline').parameters.jsCode;
  const prepared = new Function('$json', prepare)(parent).json;
  assert.deepEqual(prepared, {
    task_id: parent.task_id,
    repository: parent.repository,
    branch_name: parent.branch_name,
    head_sha: parent.head_sha,
    caller_identity: parent.caller,
    permitted_action: parent.permitted_action,
    operation_id: parent.operation_id,
    governance_policy_version: parent.governance_policy_version,
    story_contract_version: parent.story_contract_version,
    linear_updated_at: parent.linear_updated_at,
    contract_hash: parent.contract_hash,
    build_allowed: true,
  });

  const serializedValidator = workflowNode(workflow, 'Validate Contract and Branch').parameters.jsCode;
  assert.match(serializedValidator, /'operation_id'\]\.forEach/);
  assert.match(serializedValidator, /INVALID_OPERATION_ID/);
  assert.match(serializedValidator, /pr_merge_gate/);
  assert.match(serializedValidator, /STATUS_NOT_ACTIONABLE/);
  assert.match(serializedValidator, /INVALID_BRANCH_FORMAT/);
  assert.match(serializedValidator, /LINEAR_BRANCH_TASK_MISMATCH/);
});

test('the inactive n8n candidate derives repository authority from exact embedded consumer profiles', async () => {
  const workflow = await loadWorkflow();
  const normalize = workflowNode(workflow, 'Normalize Governance Consumer Request').parameters.jsCode;
  const execute = (body) => new Function('$json', normalize)({ body }).json;
  const base = {
    task_id: 'AI-99',
    governance_policy_version: 'governance-policy-v1.1',
    story_contract_version: 'story-contract-v2',
    permitted_action: 'local_build_start',
    branch_name: 'codex/ai-99-consumer-onboarding',
    head_sha: 'a'.repeat(40),
    repository: 'https://github.com/aispanda/aispanda-governance.git',
    caller: 'codex',
    operation_id: 'ai99:build:00000001',
  };

  const approved = execute(base);
  assert.equal(approved.request.consumer_id, 'aispanda-governance');
  assert.equal(approved.request.expected_repository, 'github.com/aispanda/aispanda-governance');
  assert.deepEqual(approved.request.consumer_violation_codes, []);

  const wrongAction = execute({ ...base, permitted_action: 'pr_merge_gate' });
  assert.deepEqual(wrongAction.request.consumer_violation_codes, ['ACTION_NOT_APPROVED']);

  const lookalike = execute({
    ...base,
    repository: 'github.com/aispanda/aispanda-governance-evil',
    consumer_profiles: [{ repository: 'github.com/aispanda/aispanda-governance-evil' }],
  });
  assert.equal(lookalike.request.consumer_id, 'aispanda-governance');
  assert.equal(lookalike.request.expected_repository, 'github.com/aispanda/aispanda-governance');
  assert.deepEqual(lookalike.request.consumer_violation_codes, ['CONSUMER_REPOSITORY_MISMATCH']);

  const validator = workflowNode(workflow, 'Validate Contract and Branch').parameters.jsCode;
  const classifier = workflowNode(workflow, 'Classify Authorization Outcome').parameters.jsCode;
  for (const code of ['INVALID_REPOSITORY_IDENTITY', 'CONSUMER_NOT_APPROVED', 'CONSUMER_REPOSITORY_MISMATCH', 'ACTION_NOT_APPROVED', 'CALLER_NOT_APPROVED']) {
    assert.match(validator, new RegExp(code));
    assert.match(classifier, new RegExp(code));
  }
});

test('server and generated n8n route enforcement have spoof-corpus parity', async () => {
  const workflow = await loadWorkflow();
  const routes = {
    'aispanda-web': workflowNode(workflow, 'Normalize Authorization Request').parameters.jsCode,
    'aispanda-governance': workflowNode(workflow, 'Normalize Governance Consumer Request').parameters.jsCode,
  };
  const base = {
    task_id: 'AI-99',
    governance_policy_version: 'governance-policy-v1.1',
    story_contract_version: 'story-contract-v2',
    permitted_action: 'local_build_start',
    branch_name: 'codex/ai-99-consumer-onboarding',
    head_sha: 'a'.repeat(40),
    repository: 'github.com/aispanda/aispanda-governance',
    caller: 'codex',
    operation_id: 'ai99:build:00000001',
  };
  const corpus = [
    ['aispanda-governance', {}],
    ['aispanda-governance', { repository: 'https://github.com/aispanda/aispanda-governance.git' }],
    ['aispanda-governance', { repository: 'git@github.com:aispanda/aispanda-governance.git' }],
    ['aispanda-governance', { caller: 'github-actions' }],
    ['aispanda-governance', { permitted_action: 'pr_merge_gate' }],
    ['aispanda-governance', { repository: 'github.com/other/aispanda-governance' }],
    ['aispanda-governance', { repository: 'github.com/aispanda/aispanda-governance-evil' }],
    ['aispanda-governance', { repository: 'github.com/aispanda/AISPANDA-governance' }],
    ['aispanda-governance', { repository: 'github.com/aispanda/aispanda-governance%2fevil' }],
    ['aispanda-governance', { repository: 'https://github.com:8443/aispanda/aispanda-governance' }],
    ['aispanda-governance', { repository: 'https://github.example/aispanda/aispanda-governance' }],
    ['aispanda-governance', { repository: 'github.com/aispanda/*' }],
    ['aispanda-governance', { governance_policy_version: 'governance-policy-v2' }],
    ['aispanda-governance', { story_contract_version: 'story-contract-v3' }],
    ['aispanda-web', { repository: 'github.com/aispanda/aispanda-web', permitted_action: 'pr_merge_gate', caller: 'github-actions' }],
    ['aispanda-web', { repository: 'github.com/aispanda/aispanda-governance' }],
  ];

  for (const [consumerId, overrides] of corpus) {
    const body = { ...base, ...overrides };
    const pure = resolveConsumerProfile({
      consumerId,
      repository: body.repository,
      action: body.permitted_action,
      caller: body.caller,
      governancePolicyVersion: body.governance_policy_version,
      storyContractVersion: body.story_contract_version,
    });
    const generated = new Function('$json', routes[consumerId])({ body }).json;
    assert.deepEqual(generated.request.consumer_violation_codes, pure.violation_codes, `${consumerId}: ${JSON.stringify(overrides)}`);
    assert.equal(generated.request.expected_repository, pure.profile.repository);
    if (consumerId === 'aispanda-governance') assert.equal(generated.runtime.caller, 'codex');
  }
});

test('cross-profile impersonation cannot select repository or caller authority', async () => {
  const workflow = await loadWorkflow();
  const governanceRoute = workflowNode(workflow, 'Normalize Governance Consumer Request').parameters.jsCode;
  const webRoute = workflowNode(workflow, 'Normalize Authorization Request').parameters.jsCode;
  const body = {
    task_id: 'AI-99',
    governance_policy_version: 'governance-policy-v1.1',
    story_contract_version: 'story-contract-v2',
    permitted_action: 'pr_merge_gate',
    branch_name: 'codex/ai-99-consumer-onboarding',
    head_sha: 'a'.repeat(40),
    repository: 'github.com/aispanda/aispanda-web',
    caller: 'github-actions',
    operation_id: 'ai99:build:00000001',
    consumer_id: 'aispanda-web',
    consumer_profiles: [{ id: 'aispanda-web', repository: 'github.com/aispanda/aispanda-web' }],
  };
  const governanceResult = new Function('$json', governanceRoute)({ body }).json;
  assert.equal(governanceResult.request.consumer_id, 'aispanda-governance');
  assert.equal(governanceResult.runtime.caller, 'codex');
  assert.deepEqual(
    governanceResult.request.consumer_violation_codes,
    ['CONSUMER_REPOSITORY_MISMATCH', 'ACTION_NOT_APPROVED', 'CALLER_NOT_APPROVED'],
  );

  const webResult = new Function('$json', webRoute)({ body: { ...body, repository: 'github.com/aispanda/aispanda-governance' } }).json;
  assert.equal(webResult.request.consumer_id, 'aispanda-web');
  assert.deepEqual(webResult.request.consumer_violation_codes, ['CONSUMER_REPOSITORY_MISMATCH']);
});

test('both authenticated routes execute through the shared context and classify a complete valid decision', async () => {
  const workflow = await loadWorkflow();
  const fixture = JSON.parse(await readFile(contractFixturePath, 'utf8'));
  const issue = {
    ...fixture.base_issue,
    identifier: 'AI-99',
    description: fixture.descriptions.canonical,
    state: { name: 'In Progress' },
    branchName: 'rajeevkasat/ai-99-onboard-aispanda-governance',
  };
  const executeCode = (name, item) => new Function('$json', workflowNode(workflow, name).parameters.jsCode)(item).json;
  const run = (normalizerName, repository, caller) => {
    const normalized = executeCode(normalizerName, { body: {
      task_id: 'AI-99',
      governance_policy_version: 'governance-policy-v1.1',
      story_contract_version: 'story-contract-v2',
      permitted_action: 'local_build_start',
      branch_name: 'codex/ai-99-consumer-onboarding',
      head_sha: 'a'.repeat(40),
      repository,
      caller,
      operation_id: 'ai99:build:00000001',
    } });
    const context = executeCode('Authorization Request Context', normalized);
    const validator = workflowNode(workflow, 'Validate Contract and Branch').parameters.jsCode;
    const validated = new Function('$json', '$', validator)({ data: { issue } }, (name) => {
      assert.equal(name, 'Authorization Request Context');
      return { first: () => ({ json: context }) };
    }).json;
    const hashed = {
      ...validated,
      computed_contract_hash: createHash('sha256').update(validated.contract_hash_input).digest('hex'),
    };
    const finalized = executeCode('Finalize Contract Hash', hashed);
    const bounded = executeCode('Enforce Branch Boundary', finalized);
    return executeCode('Classify Authorization Outcome', bounded);
  };

  const governance = run('Normalize Governance Consumer Request', 'github.com/aispanda/aispanda-governance', 'codex');
  assert.equal(governance.outcome, 'PASS');
  assert.equal(governance.build_allowed, true);
  assert.deepEqual(governance.violation_codes, []);

  const web = run('Normalize Authorization Request', 'github.com/aispanda/aispanda-web', 'codex');
  assert.equal(web.outcome, 'PASS');
  assert.equal(web.build_allowed, true);
  assert.deepEqual(web.violation_codes, []);
});

test('merge PASS is bound to current PR facts and one matching build-start baseline', async () => {
  const workflow = await loadWorkflow();
  const parent = parentDecision({
    permitted_action: 'pr_merge_gate',
    operation_id: 'github:pr:95:00000001',
    head_sha: 'f'.repeat(40),
    caller: 'github-actions',
  });
  const baseline = matchingBaseline(parent, {
    operation_id: 'ai95:build:00000001',
    head_sha: 'a'.repeat(40),
    caller_identity: 'codex',
    permitted_action: 'local_build_start',
  });
  const result = runFinalizer(
    workflowNode(workflow, 'Finalize Persisted Authorization').parameters.jsCode,
    {
      outcome: 'PASS',
      allowed: true,
      code: 'BASELINE_CURRENT',
      storage_verified: true,
      violation_codes: [],
      baseline,
    },
    parent,
  );
  assert.equal(result.outcome, 'PASS');
  assert.equal(result.response_status, 200);
  assert.equal(result.build_allowed, true);
  assert.equal(result.storage_verified, true);
  assert.equal(result.head_sha, parent.head_sha);
  assert.equal(result.operation_id, parent.operation_id);
  assert.equal(result.authorization_mode, 'localhost_merge_verified');
});

test('stale merge baseline preserves REPLAN and mismatched scope fails closed', async () => {
  const workflow = await loadWorkflow();
  const finalizer = workflowNode(workflow, 'Finalize Persisted Authorization').parameters.jsCode;
  const parent = parentDecision({
    permitted_action: 'pr_merge_gate',
    operation_id: 'github:pr:95:00000002',
    head_sha: 'f'.repeat(40),
    caller: 'github-actions',
  });
  const stale = runFinalizer(finalizer, {
    outcome: 'REPLAN',
    allowed: false,
    code: 'BASELINE_STALE',
    storage_verified: false,
    violation_codes: ['BASELINE_STALE'],
  }, parent);
  assert.equal(stale.outcome, 'REPLAN');
  assert.equal(stale.response_status, 422);
  assert.equal(stale.build_allowed, false);
  assert.equal(stale.authorization_mode, 'localhost_merge_denied');

  const mismatched = runFinalizer(finalizer, {
    outcome: 'PASS',
    allowed: true,
    code: 'BASELINE_CURRENT',
    storage_verified: true,
    violation_codes: [],
    baseline: matchingBaseline(parent, {
      branch_name: 'codex/ai-95-different-branch',
      permitted_action: 'local_build_start',
    }),
  }, parent);
  assert.equal(mismatched.outcome, 'FAIL');
  assert.equal(mismatched.response_status, 502);
  assert.equal(mismatched.build_allowed, false);
  assert.ok(mismatched.violation_codes.includes('BASELINE_RESPONSE_MISMATCH'));
});

test('exact stored baseline permits PASS and preserves the operation identity', async () => {
  const workflow = await loadWorkflow();
  const parent = parentDecision();
  const child = {
    outcome: 'PASS',
    allowed: true,
    code: 'BASELINE_DUPLICATE',
    storage_verified: true,
    violation_codes: [],
    baseline: matchingBaseline(parent),
  };
  const result = runFinalizer(workflowNode(workflow, 'Finalize Persisted Authorization').parameters.jsCode, child, parent);
  assert.equal(result.outcome, 'PASS');
  assert.equal(result.response_status, 200);
  assert.equal(result.build_allowed, true);
  assert.equal(result.storage_verified, true);
  assert.equal(result.operation_id, parent.operation_id);
  assert.equal(result.baseline_code, 'BASELINE_DUPLICATE');
  assert.equal(result.authorization_mode, 'localhost_persisted');
});

test('operation conflict and spoofed child facts both fail closed', async () => {
  const workflow = await loadWorkflow();
  const finalizer = workflowNode(workflow, 'Finalize Persisted Authorization').parameters.jsCode;
  const parent = parentDecision();
  const conflict = runFinalizer(finalizer, {
    outcome: 'FAIL',
    allowed: false,
    code: 'OPERATION_ID_CONFLICT',
    storage_verified: false,
    violation_codes: ['OPERATION_ID_CONFLICT'],
  }, parent);
  assert.equal(conflict.response_status, 502);
  assert.equal(conflict.outcome, 'FAIL');
  assert.equal(conflict.build_allowed, false);
  assert.equal(conflict.storage_verified, false);
  assert.ok(conflict.violation_codes.includes('OPERATION_ID_CONFLICT'));

  const spoofed = runFinalizer(finalizer, {
    outcome: 'PASS',
    allowed: true,
    code: 'BASELINE_DUPLICATE',
    storage_verified: true,
    violation_codes: [],
    baseline: matchingBaseline(parent, { head_sha: 'd'.repeat(40) }),
  }, parent);
  assert.equal(spoofed.response_status, 502);
  assert.equal(spoofed.outcome, 'FAIL');
  assert.equal(spoofed.build_allowed, false);
  assert.ok(spoofed.violation_codes.includes('BASELINE_RESPONSE_MISMATCH'));
});

test('baseline dependency failures expose only a sanitized fail-closed response', async () => {
  const workflow = await loadWorkflow();
  const response = workflowNode(workflow, 'Respond Baseline Dependency Error').parameters;
  assert.equal(response.options.responseCode, 502);
  assert.match(response.responseBody, /BASELINE_DEPENDENCY_ERROR/);
  assert.match(response.responseBody, /build_allowed: false/);
  assert.doesNotMatch(response.responseBody, /stack|credential|row_id|internal|message/i);
});
