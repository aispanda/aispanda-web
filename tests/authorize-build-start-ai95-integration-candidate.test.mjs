import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { evaluateMergeBaseline } from '../server/governance-baseline.mjs';

import {
  addConsumerProfileRoutes,
  AUTHORIZATION_REQUEST_CONTEXT_NODE,
  consumerRepositoryRootPlaceholder,
  GIT_ATTESTATION_VIOLATION_CODES,
} from '../server/governance-consumer-workflow.mjs';
import { GOVERNANCE_CONSUMER_PROFILES, resolveConsumerProfile } from '../server/governance-consumers.mjs';

const workflowPath = new URL('../workflows/authorize-build-start-ai95.integration-candidate.local.json', import.meta.url);
const sourceWorkflowPath = new URL('../workflows/authorize-build-start.local.json', import.meta.url);
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

function consumerRoute(workflow, consumerId, profiles = GOVERNANCE_CONSUMER_PROFILES) {
  const profile = profiles.find((candidate) => candidate.id === consumerId);
  assert.ok(profile, `missing consumer profile: ${consumerId}`);
  const webhook = workflow.nodes.find((candidate) => candidate.parameters?.path === profile.webhook_path);
  assert.ok(webhook, `missing consumer webhook: ${consumerId}`);
  const normalizer = workflowNode(workflow, destination(workflow, webhook.name));
  const next = workflowNode(workflow, destination(workflow, normalizer.name));
  const mergeRouter = next.type === 'n8n-nodes-base.if' ? next : null;
  const pathGuard = mergeRouter ? workflowNode(workflow, destination(workflow, mergeRouter.name, 1)) : next;
  const gitStatus = workflowNode(workflow, destination(workflow, pathGuard.name));
  const gitHead = workflowNode(workflow, destination(workflow, gitStatus.name));
  const gitOrigin = workflowNode(workflow, destination(workflow, gitHead.name));
  const attestor = workflowNode(workflow, destination(workflow, gitOrigin.name));
  return { profile, webhook, normalizer, mergeRouter, pathGuard, gitStatus, gitHead, gitOrigin, attestor };
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

function classifyConsumerRequest(workflow, issue, consumerId, body, observed = {}) {
  const route = consumerRoute(workflow, consumerId);
  const normalizer = route.normalizer.parameters.jsCode;
  const normalized = new Function('$json', normalizer)({ body }).json;
  const runtimeRoot = `C:/Governed/${consumerId}`;
  let attested = normalized;
  if (!(route.mergeRouter && normalized.request.permitted_action === 'pr_merge_gate')) {
  const guardCode = route.pathGuard.parameters.jsCode.replaceAll(consumerRepositoryRootPlaceholder(consumerId), runtimeRoot);
  const guarded = new Function('$json', guardCode)(normalized).json;
  const observedRepository = observed.repository ?? route.profile.repository;
  const observedBranch = observed.branch ?? body.branch_name;
  const observedHead = observed.head ?? body.head_sha;
  const configItems = (observed.configItems ?? [{ 'remote.origin.url': `https://${observedRepository}.git` }]).map((json) => ({ json }));
  attested = new Function('$input', '$', route.attestor.parameters.jsCode)(
    { all: () => configItems },
    (name) => {
      if (name === route.pathGuard.name) return { first: () => ({ json: guarded }) };
      if (name === route.gitStatus.name) return { first: () => ({ json: { current: observedBranch } }) };
      if (name === route.gitHead.name) return { first: () => ({ json: { hash: observedHead } }) };
      assert.fail(`unexpected attestor input: ${name}`);
    },
  )[0].json;
  }
  const context = new Function('$json', workflowNode(workflow, AUTHORIZATION_REQUEST_CONTEXT_NODE).parameters.jsCode)(attested).json;
  const validator = workflowNode(workflow, 'Validate Contract and Branch').parameters.jsCode;
  const validated = new Function('$json', '$', validator)({ data: { issue } }, (name) => {
    assert.equal(name, AUTHORIZATION_REQUEST_CONTEXT_NODE);
    return { first: () => ({ json: context }) };
  }).json;
  const hashed = {
    ...validated,
    computed_contract_hash: createHash('sha256').update(validated.contract_hash_input).digest('hex'),
  };
  const finalized = new Function('$json', workflowNode(workflow, 'Finalize Contract Hash').parameters.jsCode)(hashed).json;
  const bounded = new Function('$json', workflowNode(workflow, 'Enforce Branch Boundary').parameters.jsCode)(finalized).json;
  return new Function('$json', workflowNode(workflow, 'Classify Authorization Outcome').parameters.jsCode)(bounded).json;
}

test('inactive candidate calls storage only after an exact parent PASS', async () => {
  const workflow = await loadWorkflow();
  assert.equal(workflow.active, false);
  assert.equal(workflow.settings.availableInMCP, false);
  assert.equal(workflow.settings.saveDataSuccessExecution, 'none');
  assert.equal(workflow.settings.saveDataErrorExecution, 'none');
  assert.equal(workflow.settings.saveManualExecutions, false);
  assert.equal(workflow.settings.saveExecutionProgress, false);
  assert.match(workflow.meta.governanceConsumerProfilesSha256, /^[0-9a-f]{64}$/);
  assert.equal(workflow.meta.governanceConsumerProfileSchemaVersion, 'governance-consumer-profiles-v1');
  for (const [index, profile] of GOVERNANCE_CONSUMER_PROFILES.entries()) {
    const { webhook, normalizer, mergeRouter, pathGuard, gitStatus, gitHead, gitOrigin, attestor } = consumerRoute(workflow, profile.id);
    assert.equal(webhook.parameters.path, profile.webhook_path);
    assert.equal(webhook.parameters.authentication, 'headerAuth');
    if (index > 0) assert.equal(webhook.credentials, undefined);
    assert.equal(destination(workflow, webhook.name), normalizer.name);
    assert.equal(destination(workflow, normalizer.name), mergeRouter?.name ?? pathGuard.name);
    if (mergeRouter) {
      assert.equal(destination(workflow, mergeRouter.name, 0), AUTHORIZATION_REQUEST_CONTEXT_NODE);
      assert.equal(destination(workflow, mergeRouter.name, 1), pathGuard.name);
      assert.deepEqual(mergeRouter.parameters.conditions.conditions[0], {
        id: `merge-action-${profile.id}`,
        leftValue: '={{ $json.request.permitted_action }}',
        rightValue: 'pr_merge_gate',
        operator: { type: 'string', operation: 'equals' },
      });
    }
    assert.equal(destination(workflow, pathGuard.name), gitStatus.name);
    assert.equal(destination(workflow, gitStatus.name), gitHead.name);
    assert.equal(destination(workflow, gitHead.name), gitOrigin.name);
    assert.equal(destination(workflow, gitOrigin.name), attestor.name);
    assert.equal(destination(workflow, attestor.name), AUTHORIZATION_REQUEST_CONTEXT_NODE);
    assert.equal(gitStatus.parameters.operation, 'status');
    assert.equal(gitHead.parameters.operation, 'log');
    assert.equal(gitOrigin.parameters.operation, 'listConfig');
    assert.equal(gitStatus.parameters.repositoryPath, `={{ $('${pathGuard.name}').first().json.runtime.repository_path }}`);
    assert.match(pathGuard.parameters.jsCode, new RegExp(consumerRepositoryRootPlaceholder(profile.id)));
    assert.doesNotMatch(pathGuard.parameters.jsCode, /C:\\\\/);
  }
  assert.equal(destination(workflow, AUTHORIZATION_REQUEST_CONTEXT_NODE), 'Request Has Task ID');
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
  const normalize = consumerRoute(workflow, 'aispanda-governance').normalizer.parameters.jsCode;
  const execute = (body) => new Function('$json', 'URL', normalize)({ body }, undefined).json;
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
  assert.doesNotMatch(normalize, /new URL\(/);
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
  for (const code of ['INVALID_REPOSITORY_IDENTITY', 'CONSUMER_NOT_APPROVED', 'CONSUMER_REPOSITORY_MISMATCH', 'ACTION_NOT_APPROVED', 'CALLER_NOT_APPROVED', ...GIT_ATTESTATION_VIOLATION_CODES]) {
    assert.match(validator, new RegExp(code));
    assert.match(classifier, new RegExp(code));
  }
});

test('server and generated n8n route enforcement have spoof-corpus parity', async () => {
  const workflow = await loadWorkflow();
  const routes = Object.fromEntries(GOVERNANCE_CONSUMER_PROFILES.map((profile) => [
    profile.id,
    consumerRoute(workflow, profile.id).normalizer.parameters.jsCode,
  ]));
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
    ['reusable-ai-assets-private', { repository: 'github.com/aispanda/reusable-ai-assets-private' }],
    ['reusable-ai-assets-private', { repository: 'github.com/aispanda/reusable-ai-assets-private-evil' }],
    ['reusable-ai-assets-private', { repository: 'github.com/aispanda/*' }],
    ['reusable-ai-assets-private', { repository: 'github.com/aispanda/reusable-ai-assets-private', caller: 'github-actions' }],
    ['reusable-ai-assets-private', { repository: 'github.com/aispanda/reusable-ai-assets-private', permitted_action: 'pr_merge_gate' }],
    ['reusable-ai-assets-private', { repository: 'github.com/aispanda/reusable-ai-assets-private', governance_policy_version: 'governance-policy-v2' }],
    ['reusable-ai-assets-private', { repository: 'github.com/aispanda/reusable-ai-assets-private', story_contract_version: 'story-contract-v3' }],
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
    const generated = new Function('$json', 'URL', routes[consumerId])({ body }, undefined).json;
    assert.deepEqual(generated.request.consumer_violation_codes, pure.violation_codes, `${consumerId}: ${JSON.stringify(overrides)}`);
    assert.equal(generated.request.expected_repository, pure.profile.repository);
    if (pure.profile.callers !== null) assert.equal(generated.runtime.caller, pure.profile.callers[0]);
  }
});

test('a new exact-profile fixture generates an isolated route without repository-specific generator code', async () => {
  const sourceWorkflow = JSON.parse(await readFile(sourceWorkflowPath, 'utf8'));
  const fictional = Object.freeze({
    id: 'example-synthetic',
    webhook_path: 'authorize-build-start-example-synthetic',
    repository: 'github.com/example/governance-synthetic',
    actions: Object.freeze(['local_build_start']),
    callers: Object.freeze(['fixture-runner']),
    governance_policy_version: 'governance-policy-v1.1',
    story_contract_version: 'story-contract-v2',
  });
  const profiles = [...GOVERNANCE_CONSUMER_PROFILES, fictional];
  const generated = addConsumerProfileRoutes(sourceWorkflow, profiles);
  const route = consumerRoute(generated, fictional.id, profiles);
  const result = new Function('$json', route.normalizer.parameters.jsCode)({ body: {
    task_id: 'EX-1',
    governance_policy_version: fictional.governance_policy_version,
    story_contract_version: fictional.story_contract_version,
    permitted_action: fictional.actions[0],
    branch_name: 'codex/ex-1-synthetic',
    head_sha: 'a'.repeat(40),
    repository: fictional.repository,
    caller: fictional.callers[0],
    operation_id: 'fixture:build:00000001',
  } }).json;

  assert.equal(generated.nodes.filter((node) => node.type === 'n8n-nodes-base.webhook').length, profiles.length);
  assert.equal(route.webhook.parameters.path, fictional.webhook_path);
  assert.equal(route.webhook.credentials, undefined);
  assert.equal(result.request.consumer_id, fictional.id);
  assert.deepEqual(result.request.consumer_violation_codes, []);
});

test('cross-profile impersonation cannot select repository or caller authority', async () => {
  const workflow = await loadWorkflow();
  const governanceRoute = consumerRoute(workflow, 'aispanda-governance').normalizer.parameters.jsCode;
  const webRoute = consumerRoute(workflow, 'aispanda-web').normalizer.parameters.jsCode;
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

  const privateRoute = consumerRoute(workflow, 'reusable-ai-assets-private').normalizer.parameters.jsCode;
  const privateResult = new Function('$json', privateRoute)({ body: {
    ...body,
    repository: 'github.com/aispanda/aispanda-web',
    permitted_action: 'local_build_start',
    caller: 'codex',
    consumer_id: 'aispanda-web',
    consumer_profiles: [{ id: 'aispanda-web', repository: 'github.com/aispanda/aispanda-web' }],
  } }).json;
  assert.equal(privateResult.request.consumer_id, 'reusable-ai-assets-private');
  assert.deepEqual(privateResult.request.consumer_violation_codes, ['CONSUMER_REPOSITORY_MISMATCH']);
});

test('private-consumer identity and authority denials cannot reach baseline storage', async () => {
  const workflow = await loadWorkflow();
  const fixture = JSON.parse(await readFile(contractFixturePath, 'utf8'));
  const issue = {
    ...fixture.base_issue,
    identifier: 'AI-108',
    description: fixture.descriptions.canonical,
    state: { name: 'In Progress' },
    branchName: 'rajeevkasat/ai-108-data-driven-consumers',
  };
  const base = {
    task_id: 'AI-108',
    governance_policy_version: 'governance-policy-v1.1',
    story_contract_version: 'story-contract-v2',
    permitted_action: 'local_build_start',
    branch_name: 'codex/ai-108-data-driven-consumers',
    head_sha: 'a'.repeat(40),
    repository: 'github.com/aispanda/reusable-ai-assets-private',
    caller: 'codex',
    operation_id: 'ai108:build:00000001',
    repository_path: 'C:/Governed/reusable-ai-assets-private/worktree',
  };
  const cases = [
    [{ repository: 'github.com/other/reusable-ai-assets-private' }, 'CONSUMER_REPOSITORY_MISMATCH'],
    [{ repository: 'github.com/aispanda/reusable-ai-assets-private-evil' }, 'CONSUMER_REPOSITORY_MISMATCH'],
    [{ repository: 'github.com/aispanda/*' }, 'INVALID_REPOSITORY_IDENTITY'],
    [{ repository: 'github.com/example/self-registered', consumer_profiles: [{ id: 'reusable-ai-assets-private', repository: 'github.com/example/self-registered' }] }, 'CONSUMER_REPOSITORY_MISMATCH'],
    [{ repository: 'github.com/aispanda/aispanda-web', consumer_id: 'aispanda-web' }, 'CONSUMER_REPOSITORY_MISMATCH'],
    [{ permitted_action: 'pr_merge_gate' }, 'ACTION_NOT_APPROVED'],
    [{ caller: 'github-actions' }, 'CALLER_NOT_APPROVED'],
    [{ governance_policy_version: 'governance-policy-v2' }, 'POLICY_VERSION_MISMATCH'],
    [{ story_contract_version: 'story-contract-v3' }, 'SYNTAX_VERSION_MISMATCH'],
  ];

  for (const [overrides, expectedCode] of cases) {
    const result = classifyConsumerRequest(workflow, issue, 'reusable-ai-assets-private', { ...base, ...overrides });
    assert.equal(result.outcome, 'FAIL', JSON.stringify(overrides));
    assert.equal(result.build_allowed, false, JSON.stringify(overrides));
    assert.ok(result.violation_codes.includes(expectedCode), `${JSON.stringify(overrides)}: ${result.violation_codes.join(',')}`);
  }
  assert.equal(destination(workflow, 'Parent Authorization Passed', 1), 'Respond Authorization Outcome');
});

test('independently observed Git facts deny well-formed caller lies before baseline storage', async () => {
  const workflow = await loadWorkflow();
  const fixture = JSON.parse(await readFile(contractFixturePath, 'utf8'));
  const issue = {
    ...fixture.base_issue,
    identifier: 'AI-108',
    description: fixture.descriptions.canonical,
    state: { name: 'In Progress' },
    branchName: 'rajeevkasat/ai-108-data-driven-consumers',
  };
  const actual = {
    repository: 'github.com/aispanda/reusable-ai-assets-private',
    branch: 'codex/ai-108-data-driven-consumers',
    head: 'a'.repeat(40),
  };
  const base = {
    task_id: 'AI-108',
    governance_policy_version: 'governance-policy-v1.1',
    story_contract_version: 'story-contract-v2',
    permitted_action: 'local_build_start',
    branch_name: actual.branch,
    head_sha: actual.head,
    repository: actual.repository,
    caller: 'codex',
    operation_id: 'ai108:attestation:00000001',
    repository_path: 'C:/Governed/reusable-ai-assets-private/worktree',
  };

  for (const suppliedHead of ['0'.repeat(40), '1'.repeat(40), 'b'.repeat(64)]) {
    const result = classifyConsumerRequest(workflow, issue, 'reusable-ai-assets-private', { ...base, head_sha: suppliedHead }, actual);
    assert.equal(result.outcome, 'FAIL');
    assert.equal(result.build_allowed, false);
    assert.equal(result.head_sha, actual.head);
    assert.ok(result.violation_codes.includes('GIT_HEAD_ATTESTATION_MISMATCH'));
  }

  const wrongBranch = classifyConsumerRequest(workflow, issue, 'reusable-ai-assets-private', { ...base, branch_name: 'codex/ai-108-false' }, actual);
  assert.equal(wrongBranch.outcome, 'FAIL');
  assert.ok(wrongBranch.violation_codes.includes('GIT_BRANCH_ATTESTATION_MISMATCH'));

  const wrongOrigin = classifyConsumerRequest(workflow, issue, 'reusable-ai-assets-private', base, {
    ...actual,
    repository: 'github.com/aispanda/aispanda-web',
  });
  assert.equal(wrongOrigin.outcome, 'FAIL');
  assert.ok(wrongOrigin.violation_codes.includes('GIT_REPOSITORY_ATTESTATION_MISMATCH'));

  const unavailableHead = classifyConsumerRequest(workflow, issue, 'reusable-ai-assets-private', base, { ...actual, head: '' });
  assert.equal(unavailableHead.outcome, 'FAIL');
  assert.ok(unavailableHead.violation_codes.includes('GIT_HEAD_ATTESTATION_UNAVAILABLE'));
  assert.equal(destination(workflow, 'Parent Authorization Passed', 1), 'Respond Authorization Outcome');
});

test('repository-path locator is constrained by a runtime-only consumer root', async () => {
  const workflow = await loadWorkflow();
  const route = consumerRoute(workflow, 'reusable-ai-assets-private');
  const body = {
    task_id: 'AI-108',
    governance_policy_version: 'governance-policy-v1.1',
    story_contract_version: 'story-contract-v2',
    permitted_action: 'local_build_start',
    branch_name: 'codex/ai-108-data-driven-consumers',
    head_sha: 'a'.repeat(40),
    repository: route.profile.repository,
    repository_path: 'C:/Outside/attacker-selected-repository',
    caller: 'codex',
    operation_id: 'ai108:path-guard:00000001',
  };
  const normalized = new Function('$json', route.normalizer.parameters.jsCode)({ body }).json;
  const guardCode = route.pathGuard.parameters.jsCode.replaceAll(
    consumerRepositoryRootPlaceholder(route.profile.id),
    'C:/Governed/reusable-ai-assets-private',
  );
  assert.throws(
    () => new Function('$json', guardCode)(normalized),
    /outside the runtime-bound consumer root/,
  );
  assert.equal(workflow.nodes.some((node) => node.type === 'n8n-nodes-base.executeCommand'), false);
});

test('all authenticated routes execute through the shared context and classify a complete valid decision', async () => {
  const workflow = await loadWorkflow();
  const fixture = JSON.parse(await readFile(contractFixturePath, 'utf8'));
  const issue = {
    ...fixture.base_issue,
    identifier: 'AI-99',
    description: fixture.descriptions.canonical,
    state: { name: 'In Progress' },
    branchName: 'rajeevkasat/ai-99-onboard-aispanda-governance',
  };
  const run = (consumerId, repository, caller) => {
    return classifyConsumerRequest(workflow, issue, consumerId, {
      task_id: 'AI-99',
      governance_policy_version: 'governance-policy-v1.1',
      story_contract_version: 'story-contract-v2',
      permitted_action: 'local_build_start',
      branch_name: 'codex/ai-99-consumer-onboarding',
      head_sha: 'a'.repeat(40),
      repository,
      caller,
      operation_id: 'ai99:build:00000001',
      repository_path: `C:/Governed/${consumerId}/worktree`,
    });
  };

  const governance = run('aispanda-governance', 'github.com/aispanda/aispanda-governance', 'codex');
  assert.equal(governance.outcome, 'PASS');
  assert.equal(governance.build_allowed, true);
  assert.deepEqual(governance.violation_codes, []);

  const web = run('aispanda-web', 'github.com/aispanda/aispanda-web', 'codex');
  assert.equal(web.outcome, 'PASS');
  assert.equal(web.build_allowed, true);
  assert.deepEqual(web.violation_codes, []);

  const privateRepository = run('reusable-ai-assets-private', 'github.com/aispanda/reusable-ai-assets-private', 'codex');
  assert.equal(privateRepository.outcome, 'PASS');
  assert.equal(privateRepository.build_allowed, true);
  assert.deepEqual(privateRepository.violation_codes, []);
});

test('pathless GitHub request retains exact facts and still requires a current matching baseline', async () => {
  const workflow = await loadWorkflow();
  const fixture = JSON.parse(await readFile(contractFixturePath, 'utf8'));
  const issue = { ...fixture.base_issue, identifier: 'AI-99', description: fixture.descriptions.canonical,
    state: { name: 'In Progress' }, branchName: 'codex/ai-99-consumer-onboarding' };
  const body = {
    task_id: 'AI-99', governance_policy_version: 'governance-policy-v1.1',
    story_contract_version: 'story-contract-v2', permitted_action: 'pr_merge_gate',
    branch_name: 'codex/ai-99-consumer-onboarding', head_sha: 'f'.repeat(40),
    repository: 'github.com/aispanda/aispanda-web', caller: 'github-actions',
    operation_id: 'github:pr:99:00000003',
  };
  const parent = classifyConsumerRequest(workflow, issue, 'aispanda-web', body,
    new Proxy({}, { get() { assert.fail('GitHub merge must not read local Git observations'); } }));
  assert.equal(parent.outcome, 'PASS');
  assert.equal(parent.head_sha, body.head_sha);
  assert.equal(parent.caller, 'github-actions');
  assert.equal(Object.hasOwn(body, 'repository_path'), false);
  const baseline = matchingBaseline(parent, {
    permitted_action: 'local_build_start', caller_identity: 'codex',
    operation_id: 'local:99:approved-head', expires_at: new Date(Date.now() + 60_000).toISOString(),
  });
  const records = [baseline];
  const before = JSON.stringify(records);
  assert.equal(evaluateMergeBaseline(records, parent).outcome, 'PASS');
  assert.equal(evaluateMergeBaseline([], parent).code, 'BASELINE_MISSING');
  assert.equal(evaluateMergeBaseline([baseline, { ...baseline }], parent).code, 'BASELINE_AMBIGUOUS');
  for (const changed of [{ head_sha: '0'.repeat(40) }, { contract_hash: '0'.repeat(64) }, { linear_updated_at: '2020-01-01T00:00:00Z' }]) {
    assert.equal(evaluateMergeBaseline(records, { ...parent, ...changed }).code, 'BASELINE_STALE');
  }
  assert.equal(JSON.stringify(records), before, 'merge validation must not alter the build-start baseline');
  for (const changed of [{ caller: 'codex' }, { repository: 'github.com/other/aispanda-web' }]) {
    const denied = classifyConsumerRequest(workflow, issue, 'aispanda-web', { ...body, ...changed });
    assert.equal(denied.outcome, 'FAIL');
    assert.equal(denied.build_allowed, false);
  }
  const local = { ...body, permitted_action: 'local_build_start', caller: 'codex' };
  for (const repository_path of [undefined, 'C:/Outside/worktree']) {
    assert.throws(() => classifyConsumerRequest(workflow, issue, 'aispanda-web', { ...local, repository_path }),
      /outside the runtime-bound consumer root/);
  }
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

test('merge finalizer rejects a build-start baseline for a different commit', async () => {
  const workflow = await loadWorkflow();
  const parent = parentDecision({
    permitted_action: 'pr_merge_gate',
    operation_id: 'github:pr:95:00000009',
    head_sha: 'f'.repeat(40),
    caller: 'github-actions',
  });
  const result = runFinalizer(
    workflowNode(workflow, 'Finalize Persisted Authorization').parameters.jsCode,
    {
      outcome: 'PASS',
      allowed: true,
      code: 'BASELINE_CURRENT',
      storage_verified: true,
      violation_codes: [],
      baseline: matchingBaseline(parent, {
        operation_id: 'ai95:build:00000009',
        head_sha: 'a'.repeat(40),
        caller_identity: 'codex',
        permitted_action: 'local_build_start',
      }),
    },
    parent,
  );
  assert.equal(result.outcome, 'FAIL');
  assert.equal(result.response_status, 502);
  assert.equal(result.build_allowed, false);
  assert.ok(result.violation_codes.includes('BASELINE_RESPONSE_MISMATCH'));
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
