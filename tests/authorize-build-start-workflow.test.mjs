import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { hashContract } from '../server/governance-contract.mjs';

const workflowPath = new URL('../workflows/authorize-build-start.local.json', import.meta.url);
const fixturePath = new URL('./fixtures/governance-contract-v2.json', import.meta.url);

async function loadWorkflow() {
  return JSON.parse(await readFile(workflowPath, 'utf8'));
}

function node(workflow, name) {
  const result = workflow.nodes.find((candidate) => candidate.name === name);
  assert.ok(result, `missing workflow node: ${name}`);
  return result;
}

function connectedNode(workflow, from, output = 0) {
  const connection = workflow.connections[from]?.main?.[output];
  assert.equal(connection?.length, 1, from + ' output ' + output + ' must have exactly one destination');
  return connection[0].node;
}

async function canonicalInput() {
  const fixture = JSON.parse(await readFile(fixturePath, 'utf8'));
  return {
    issue: {
      ...fixture.base_issue,
      description: fixture.descriptions.canonical,
    },
    request: {
      request: {
        ...fixture.base_options,
        permitted_action: 'local_build_start',
      },
      runtime: fixture.base_runtime,
    },
  };
}

function runValidator(code, response, request) {
  const execute = new Function('$json', '$', code);
  return execute(response, (name) => {
    assert.equal(name, 'Normalize Authorization Request');
    return { first: () => ({ json: request }) };
  });
}

function applyNativeHash(item) {
  return {
    ...item,
    computed_contract_hash: createHash('sha256').update(item.contract_hash_input ?? '').digest('hex'),
  };
}

test('local build-start workflow is inactive, sanitized, and Community-compatible', async () => {
  const workflow = await loadWorkflow();
  const serialized = JSON.stringify(workflow);

  assert.equal(workflow.id, 'ai93buildstart01');
  assert.equal(workflow.active, false);
  assert.equal(workflow.settings.availableInMCP, false);
  assert.equal(workflow.nodes.length, 13);
  assert.equal(serialized.includes('aispanda.app.n8n.cloud'), false);
  assert.equal(serialized.includes('N8R13KIGDYhfyQdH'), false);
  assert.equal(workflow.nodes.some((candidate) => candidate.credentials), false);
  assert.equal(workflow.nodes.some((candidate) => candidate.type.includes('executeCommand')), false);
  assert.equal(workflow.nodes.some((candidate) => candidate.type.includes('langchain')), false);
  assert.equal(workflow.nodes.filter((candidate) => candidate.type === 'n8n-nodes-base.crypto').length, 1);
  assert.equal(workflow.nodes.filter((candidate) => candidate.type === 'n8n-nodes-base.code').some((candidate) => /\brequire\s*\(/.test(candidate.parameters.jsCode)), false);
  const webhookNode = node(workflow, 'Authorized Build-Start Request');
  assert.match(webhookNode.webhookId, /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/);
  const webhook = webhookNode.parameters;
  assert.equal(webhook.authentication, 'headerAuth');
  assert.equal(webhook.responseMode, 'responseNode');
  const response = node(workflow, 'Respond Authorization Outcome').parameters;
  assert.equal(response.respondWith, 'json');
  assert.equal(response.responseBody, '={{ $json }}');
  const crypto = node(workflow, 'Calculate Contract SHA-256');
  assert.equal(crypto.typeVersion, 2);
  assert.deepEqual(crypto.parameters, {
    action: 'hash',
    binaryData: false,
    type: 'SHA256',
    value: "={{ $json.contract_hash_input ?? '' }}",
    dataPropertyName: 'computed_contract_hash',
    encoding: 'hex',
  });
  const linearLookup = node(workflow, 'Fetch Current Linear Issue').parameters;
  assert.equal(linearLookup.authentication, 'genericCredentialType');
  assert.equal(linearLookup.genericAuthType, 'oAuth2Api');
  assert.match(linearLookup.jsonBody, /^=\{\"query\":\"query GetIssue/);
  assert.equal(linearLookup.jsonBody.includes('mutation'), false);
  assert.equal(connectedNode(workflow, 'Request Has Task ID', 0), 'Fetch Current Linear Issue');
  assert.equal(connectedNode(workflow, 'Request Has Task ID', 1), 'Create Request Failure');
  assert.equal(connectedNode(workflow, 'Validate Contract and Branch'), 'Calculate Contract SHA-256');
  assert.equal(connectedNode(workflow, 'Calculate Contract SHA-256'), 'Finalize Contract Hash');
  assert.equal(connectedNode(workflow, 'Finalize Contract Hash'), 'Enforce Branch Boundary');
  assert.equal(connectedNode(workflow, 'Enforce Branch Boundary'), 'Classify Authorization Outcome');
  assert.equal(connectedNode(workflow, 'Classify Authorization Outcome'), 'Respond Authorization Outcome');

  const controllerErrorNodes = [
    ['Normalize Authorization Request', 1],
    ['Request Has Task ID', 2],
    ['Create Request Failure', 1],
    ['Validate Contract and Branch', 1],
    ['Calculate Contract SHA-256', 1],
    ['Finalize Contract Hash', 1],
    ['Enforce Branch Boundary', 1],
    ['Classify Authorization Outcome', 1],
  ];
  for (const [name, output] of controllerErrorNodes) {
    assert.equal(node(workflow, name).onError, 'continueErrorOutput');
    assert.equal(connectedNode(workflow, name, output), 'Respond Controller Error');
  }
  assert.equal(node(workflow, 'Fetch Current Linear Issue').onError, 'continueErrorOutput');
  assert.equal(connectedNode(workflow, 'Fetch Current Linear Issue', 1), 'Respond Linear Dependency Error');

  const controllerResponse = node(workflow, 'Respond Controller Error').parameters;
  assert.equal(controllerResponse.options.responseCode, 500);
  assert.match(controllerResponse.responseBody, /CONTROLLER_RUNTIME_ERROR/);
  assert.doesNotMatch(controllerResponse.responseBody, /stack|headers|credential|message/i);
  const dependencyResponse = node(workflow, 'Respond Linear Dependency Error').parameters;
  assert.equal(dependencyResponse.options.responseCode, 502);
  assert.match(dependencyResponse.responseBody, /LINEAR_DEPENDENCY_ERROR/);
  assert.doesNotMatch(dependencyResponse.responseBody, /stack|headers|credential|message/i);
});

test('per-item Code nodes return one item object rather than an array', async () => {
  const workflow = await loadWorkflow();
  const normalize = node(workflow, 'Normalize Authorization Request').parameters.jsCode;
  const normalized = new Function('$json', normalize)({
    body: {
      task_id: 'AI-93',
      governance_policy_version: 'governance-policy-v1.1',
      story_contract_version: 'story-contract-v2',
      permitted_action: 'local_build_start',
      branch_name: 'codex/ai-93-governed-test',
      head_sha: 'a'.repeat(40),
      repository: 'https://github.com/aispanda/aispanda-web.git',
      caller: 'workflow-shape-test',
    },
  });
  assert.equal(Array.isArray(normalized), false);
  assert.equal(normalized.json.request.expected_task_id, 'AI-93');

  const requestFailure = node(workflow, 'Create Request Failure').parameters.jsCode;
  const failed = new Function('$json', requestFailure)(normalized.json);
  assert.equal(Array.isArray(failed), false);
  assert.equal(failed.json.request_failure, true);
});

test('local workflow validator requires the exact SHA-256 compliant task and branch', async () => {
  const workflow = await loadWorkflow();
  const input = await canonicalInput();
  const validator = node(workflow, 'Validate Contract and Branch').parameters.jsCode;
  const finalizer = node(workflow, 'Finalize Contract Hash').parameters.jsCode;
  const branchBoundary = node(workflow, 'Enforce Branch Boundary').parameters.jsCode;
  const classifier = node(workflow, 'Classify Authorization Outcome').parameters.jsCode;
  const response = { body: { data: { issue: input.issue } } };

  const validation = runValidator(validator, response, input.request).json;
  assert.equal(validation.candidate_build_allowed, true);
  assert.equal(validation.contract_hash_algorithm, 'sha256');
  assert.equal(validation.contract_hash, null);
  assert.equal(typeof validation.contract_hash_input, 'string');
  assert.deepEqual(validation.violation_codes, []);

  const finalized = new Function('$json', finalizer)(applyNativeHash(validation)).json;
  assert.equal(finalized.contract_hash_input, undefined);
  assert.equal(finalized.computed_contract_hash, undefined);
  assert.equal(finalized.contract_hash, '86e10b10b35fa90c94b8ed53091fa954a239af8d63a1c65fb4e29c4756c88d5c');
  assert.equal(finalized.contract_hash, hashContract(input.issue));

  const bounded = new Function('$json', branchBoundary)(finalized).json;
  assert.equal(bounded.branch_boundary_checked, true);
  assert.equal(bounded.branch_boundary_valid, true);
  const classified = new Function('$json', classifier)(bounded).json;
  assert.equal(classified.outcome, 'PASS');
  assert.equal(classified.build_allowed, true);
  assert.equal(classified.authorization_mode, 'localhost_live');

  const wrongBranch = structuredClone(input.request);
  wrongBranch.runtime.branch_name = 'codex/notai-93x';
  const rejected = runValidator(validator, response, wrongBranch).json;
  assert.equal(rejected.candidate_build_allowed, true);
  const finalizedRejected = new Function('$json', finalizer)(applyNativeHash(rejected)).json;
  const boundedRejected = new Function('$json', branchBoundary)(finalizedRejected).json;
  assert.equal(boundedRejected.branch_boundary_checked, true);
  assert.equal(boundedRejected.branch_boundary_valid, false);
  assert.equal(boundedRejected.candidate_build_allowed, false);
  assert.ok(boundedRejected.violation_codes.includes('BRANCH_TASK_MISMATCH'));
  const classifiedRejected = new Function('$json', classifier)(boundedRejected).json;
  assert.equal(classifiedRejected.build_allowed, false);
  assert.equal(classifiedRejected.response_status, 502);

  const bypassedBoundary = new Function('$json', classifier)({
    task_id: 'AI-93',
    branch_name: 'codex/notai-93x',
    candidate_build_allowed: true,
    violation_codes: [],
  }).json;
  assert.equal(bypassedBoundary.build_allowed, false);
  assert.equal(bypassedBoundary.response_status, 502);
  assert.ok(bypassedBoundary.violation_codes.includes('BRANCH_BOUNDARY_NOT_ATTESTED'));

  const missingIssue = runValidator(validator, { body: { data: { issue: null } } }, input.request).json;
  const finalizedMissingIssue = new Function('$json', finalizer)(applyNativeHash(missingIssue)).json;
  assert.equal(finalizedMissingIssue.contract_hash, null);
  assert.equal(finalizedMissingIssue.contract_hash_input, undefined);
  assert.equal(finalizedMissingIssue.computed_contract_hash, undefined);

  const invalidHash = new Function('$json', finalizer)({ ...validation, computed_contract_hash: 'not-a-hash' }).json;
  assert.equal(invalidHash.contract_hash, null);
  assert.equal(invalidHash.candidate_build_allowed, false);
  assert.ok(invalidHash.violation_codes.includes('CONTRACT_HASH_INVALID'));
});
