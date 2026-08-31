import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workflowPath = new URL('../workflows/ai95-governance-baseline-merge-candidate.local.json', import.meta.url);

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

function mergeInput(overrides = {}) {
  return {
    task_id: 'AI-95',
    repository: 'github.com/aispanda/aispanda-web',
    branch_name: 'codex/ai-95-governance-hardening',
    head_sha: 'f'.repeat(40),
    caller_identity: 'github-actions',
    permitted_action: 'pr_merge_gate',
    operation_id: 'github:pr:95:00000001',
    governance_policy_version: 'governance-policy-v1.1',
    story_contract_version: 'story-contract-v2',
    linear_updated_at: '2026-08-28T22:00:00.000Z',
    contract_hash: 'b'.repeat(64),
    build_allowed: true,
    ...overrides,
  };
}

function activeBaseline(overrides = {}) {
  return {
    id: 1,
    status: 'active',
    task_id: 'AI-95',
    repository: 'github.com/aispanda/aispanda-web',
    branch_name: 'codex/ai-95-governance-hardening',
    head_sha: 'f'.repeat(40),
    caller_identity: 'codex',
    permitted_action: 'local_build_start',
    operation_id: 'ai95:build:00000001',
    governance_policy_version: 'governance-policy-v1.1',
    story_contract_version: 'story-contract-v2',
    linear_updated_at: '2026-08-28T22:00:00.000Z',
    contract_hash: 'b'.repeat(64),
    expires_at: '2099-08-29T22:00:00.000Z',
    ...overrides,
  };
}

function runPrepare(code, input) {
  return new Function('$input', code)({ first: () => ({ json: input }) })[0].json;
}

function runEvaluate(code, records, prepared) {
  return new Function('$input', '$', code)(
    { all: () => records.map((json) => ({ json })) },
    (name) => {
      assert.equal(name, 'Prepare Merge Baseline Check');
      return { first: () => ({ json: prepared }) };
    },
  )[0].json;
}

test('merge candidate is inactive and routes merge checks through a read-only path', async () => {
  const workflow = await loadWorkflow();
  assert.equal(workflow.active, false);
  assert.equal(workflow.settings.availableInMCP, false);
  assert.equal(destination(workflow, 'Baseline Input'), 'Route Governance Action');
  assert.equal(destination(workflow, 'Route Governance Action', 0), 'Prepare Merge Baseline Check');
  assert.equal(destination(workflow, 'Route Governance Action', 1), 'Prepare Baseline Candidate');
  assert.equal(destination(workflow, 'Prepare Merge Baseline Check'), 'Get Merge Baseline Records');
  assert.equal(destination(workflow, 'Get Merge Baseline Records'), 'Evaluate Merge Baseline');

  const reader = workflowNode(workflow, 'Get Merge Baseline Records');
  assert.equal(reader.type, 'n8n-nodes-base.dataTable');
  assert.equal(reader.parameters.operation, 'get');
  assert.equal(reader.parameters.dataTableId.value, 'ai95_governance_baselines');
  assert.equal(workflow.connections['Evaluate Merge Baseline'], undefined);
});

test('merge input requires exact PR action, branch grammar, commit, versions, and current contract facts', async () => {
  const workflow = await loadWorkflow();
  const code = workflowNode(workflow, 'Prepare Merge Baseline Check').parameters.jsCode;
  const prepared = runPrepare(code, mergeInput());
  assert.equal(prepared.merge_input_valid, true);
  assert.deepEqual(prepared.violation_codes, []);
  assert.equal(prepared.current.repository, 'github.com/aispanda/aispanda-web');

  const invalid = runPrepare(code, mergeInput({
    permitted_action: 'local_build_start',
    branch_name: 'codex/not-ai-95',
    head_sha: 'short',
  }));
  assert.equal(invalid.merge_input_valid, false);
  assert.ok(invalid.violation_codes.includes('UNSUPPORTED_ACTION'));
  assert.ok(invalid.violation_codes.includes('INVALID_BRANCH_FORMAT'));
  assert.ok(invalid.violation_codes.includes('INVALID_HEAD_SHA'));
});

test('current merge facts pass against one matching unexpired build-start baseline', async () => {
  const workflow = await loadWorkflow();
  const prepareCode = workflowNode(workflow, 'Prepare Merge Baseline Check').parameters.jsCode;
  const evaluateCode = workflowNode(workflow, 'Evaluate Merge Baseline').parameters.jsCode;
  const prepared = runPrepare(prepareCode, mergeInput());
  const result = runEvaluate(evaluateCode, [activeBaseline()], prepared);
  assert.equal(result.outcome, 'PASS');
  assert.equal(result.allowed, true);
  assert.equal(result.storage_verified, true);
  assert.equal(result.code, 'BASELINE_CURRENT');
  assert.equal(result.baseline.head_sha, 'f'.repeat(40));
});

test('changed Linear or contract facts require REPLAN and never authorize merge', async () => {
  const workflow = await loadWorkflow();
  const prepared = runPrepare(workflowNode(workflow, 'Prepare Merge Baseline Check').parameters.jsCode, mergeInput());
  const result = runEvaluate(
    workflowNode(workflow, 'Evaluate Merge Baseline').parameters.jsCode,
    [activeBaseline({ head_sha: 'a'.repeat(40), linear_updated_at: '2026-08-28T21:00:00.000Z', contract_hash: 'c'.repeat(64) })],
    prepared,
  );
  assert.equal(result.outcome, 'REPLAN');
  assert.equal(result.allowed, false);
  assert.equal(result.storage_verified, false);
  assert.equal(result.code, 'BASELINE_STALE');
  assert.deepEqual(result.changed_fields, ['head_sha', 'linear_updated_at', 'contract_hash']);
});

test('missing, ambiguous, expired, and wrong-action baselines fail closed', async () => {
  const workflow = await loadWorkflow();
  const prepared = runPrepare(workflowNode(workflow, 'Prepare Merge Baseline Check').parameters.jsCode, mergeInput());
  const code = workflowNode(workflow, 'Evaluate Merge Baseline').parameters.jsCode;
  const cases = [
    [[], 'BASELINE_MISSING'],
    [[activeBaseline(), activeBaseline({ id: 2, operation_id: 'ai95:build:00000002' })], 'BASELINE_AMBIGUOUS'],
    [[activeBaseline({ expires_at: '2020-01-01T00:00:00.000Z' })], 'BASELINE_EXPIRED'],
    [[activeBaseline({ permitted_action: 'pr_merge_gate' })], 'BASELINE_ACTION_MISMATCH'],
  ];
  for (const [records, expectedCode] of cases) {
    const result = runEvaluate(code, records, prepared);
    assert.equal(result.outcome, 'FAIL');
    assert.equal(result.allowed, false);
    assert.equal(result.storage_verified, false);
    assert.equal(result.code, expectedCode);
  }
});
