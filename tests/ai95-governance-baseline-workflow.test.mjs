import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workflowPath = new URL('../workflows/ai95-governance-baseline.local.json', import.meta.url);

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
  assert.equal(connection?.length, 1, `${from} output ${output} must have exactly one destination`);
  return connection[0].node;
}

test('AI-95 baseline-store import is inactive, portable, and contains no credential or story data', async () => {
  const workflow = await loadWorkflow();
  const serialized = JSON.stringify(workflow);

  assert.equal(workflow.active, false);
  assert.equal(workflow.settings.availableInMCP, false);
  assert.equal(workflow.nodes.length, 18);
  assert.equal(workflow.nodes.some((candidate) => candidate.credentials), false);
  assert.equal(serialized.includes('aispanda.app.n8n.cloud'), false);
  assert.equal(serialized.includes('PM5EfcZeqeHtUB8Y'), false);
  assert.equal(serialized.includes('description'), true);
  assert.equal(serialized.includes('issue.description'), false);
  assert.equal(workflow.nodes.some((candidate) => candidate.type.includes('executeCommand')), false);
  assert.equal(workflow.nodes.some((candidate) => candidate.type.includes('langchain')), false);
  assert.equal(workflow.nodes.filter((candidate) => candidate.type === 'n8n-nodes-base.crypto').length, 1);
});

test('AI-95 baseline-store uses the named redacted Data Table schema', async () => {
  const workflow = await loadWorkflow();
  const serialized = JSON.stringify(workflow);
  const requiredColumns = [
    'operation_id', 'request_fingerprint', 'task_id', 'repository', 'branch_name',
    'head_sha', 'caller_identity', 'permitted_action', 'governance_policy_version',
    'story_contract_version', 'linear_updated_at', 'contract_hash', 'outcome',
    'status', 'created_at', 'expires_at',
  ];

  for (const candidate of workflow.nodes.filter((item) => item.type === 'n8n-nodes-base.dataTable')) {
    assert.equal(candidate.parameters.dataTableId?.value, 'ai95_governance_baselines');
  }
  for (const column of requiredColumns) assert.match(serialized, new RegExp(`\\b${column}\\b`));
  assert.equal(/candidate\.caller(?!_)/.test(serialized), false);
  assert.deepEqual(
    node(workflow, 'Baseline Input').parameters.workflowInputs.values.map((input) => input.name),
    [
      'task_id', 'repository', 'branch_name', 'head_sha', 'caller_identity',
      'permitted_action', 'operation_id', 'governance_policy_version',
      'story_contract_version', 'linear_updated_at', 'contract_hash', 'build_allowed',
    ],
  );
  assert.match(node(workflow, 'Prepare Baseline Candidate').parameters.jsCode, /caller: text\(source\.caller_identity\)/);
  assert.match(JSON.stringify(node(workflow, 'Insert Initial Baseline').parameters.columns.value), /caller_identity/);
});

test('AI-95 baseline-store routes safe lifecycle outcomes through the expected storage paths', async () => {
  const workflow = await loadWorkflow();

  assert.equal(connectedNode(workflow, 'Route Baseline Transition', 0), 'Return Baseline Failure');
  assert.equal(connectedNode(workflow, 'Route Baseline Transition', 1), 'Read After Transition');
  assert.equal(connectedNode(workflow, 'Route Baseline Transition', 2), 'Insert Initial Baseline');
  assert.equal(connectedNode(workflow, 'Route Baseline Transition', 3), 'Insert Replacement Baseline');
  assert.equal(connectedNode(workflow, 'Route Baseline Transition', 4), 'Retire Previous For Resume');
  assert.equal(connectedNode(workflow, 'Route Baseline Transition', 5), 'Activate Pending Alone');
  assert.equal(connectedNode(workflow, 'Insert Replacement Baseline'), 'Retire Previous Baseline');
  assert.equal(connectedNode(workflow, 'Retire Previous Baseline'), 'Activate Replacement Baseline');
  assert.equal(connectedNode(workflow, 'Retire Previous For Resume'), 'Activate Pending For Resume');
  assert.equal(connectedNode(workflow, 'Read After Transition'), 'Verify Stored Baseline');
  assert.equal(connectedNode(workflow, 'Route Baseline Transition', 6), 'Return Baseline Failure');
});
