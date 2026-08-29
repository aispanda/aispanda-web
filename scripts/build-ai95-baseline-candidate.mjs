import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';

const sourceUrl = new URL('../workflows/ai95-governance-baseline.local.json', import.meta.url);
const targetUrl = new URL('../workflows/ai95-governance-baseline-merge-candidate.local.json', import.meta.url);
const workflow = JSON.parse(await readFile(sourceUrl, 'utf8'));

function workflowNode(name) {
  const result = workflow.nodes.find((candidate) => candidate.name === name);
  assert.ok(result, `Missing source node: ${name}`);
  return result;
}

workflow.id = 'ai95baselinecandidate1';
workflow.name = 'AI-95 Governance Baseline — Build Start and Merge Candidate (Inactive)';
workflow.active = false;
workflow.settings = { ...workflow.settings, availableInMCP: false };

for (const node of workflow.nodes) {
  if (Array.isArray(node.position) && node.position[0] > 0) node.position[0] += 224;
}

const routeAction = {
  id: 'route-governance-action-ai95',
  name: 'Route Governance Action',
  type: 'n8n-nodes-base.if',
  typeVersion: 2.3,
  position: [224, 384],
  parameters: {
    conditions: {
      combinator: 'and',
      options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
      conditions: [
        {
          leftValue: '={{ $json.permitted_action }}',
          rightValue: 'pr_merge_gate',
          operator: { type: 'string', operation: 'equals' },
        },
      ],
    },
    options: {},
  },
};

const prepareMerge = {
  id: 'prepare-merge-baseline-check-ai95',
  name: 'Prepare Merge Baseline Check',
  type: 'n8n-nodes-base.code',
  typeVersion: 2,
  position: [448, 64],
  parameters: {
    mode: 'runOnceForAllItems',
    jsCode: String.raw`const source = $input.first().json || {};
const text = (value) => typeof value === 'string' ? value.trim() : '';
const normalizeRepository = (value) => text(value).replace(/\\/g, '/').replace(/^https?:\/\//i, '').replace(/^git@([^:]+):/i, '$1/').replace(/^\/+|\/+$/g, '').replace(/\.git$/i, '').toLowerCase();
const current = {
  task_id: text(source.task_id).toUpperCase(),
  repository: normalizeRepository(source.repository),
  branch_name: text(source.branch_name),
  head_sha: text(source.head_sha).toLowerCase(),
  caller: text(source.caller_identity),
  permitted_action: text(source.permitted_action),
  operation_id: text(source.operation_id),
  governance_policy_version: text(source.governance_policy_version),
  story_contract_version: text(source.story_contract_version),
  linear_updated_at: text(source.linear_updated_at),
  contract_hash: text(source.contract_hash).toLowerCase(),
};
const violations = [];
const branchMatch = current.branch_name.match(/^codex\/([a-z][a-z0-9]*-[0-9]+)-[a-z0-9][a-z0-9._-]*$/i);
if (source.build_allowed !== true) violations.push('UPSTREAM_MERGE_NOT_ALLOWED');
if (!/^[A-Z][A-Z0-9]*-\d+$/.test(current.task_id)) violations.push('INVALID_TASK_ID');
if (!/^[a-z0-9.-]+\/[^\s/]+\/[^\s/]+$/i.test(current.repository)) violations.push('INVALID_REPOSITORY');
if (!branchMatch) violations.push('INVALID_BRANCH_FORMAT');
else if (branchMatch[1].toUpperCase() !== current.task_id) violations.push('BRANCH_TASK_MISMATCH');
if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(current.head_sha)) violations.push('INVALID_HEAD_SHA');
if (!current.caller) violations.push('MISSING_CALLER');
if (current.permitted_action !== 'pr_merge_gate') violations.push('UNSUPPORTED_ACTION');
if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(current.operation_id)) violations.push('INVALID_OPERATION_ID');
if (current.governance_policy_version !== 'governance-policy-v1.1') violations.push('POLICY_VERSION_MISMATCH');
if (current.story_contract_version !== 'story-contract-v2') violations.push('SYNTAX_VERSION_MISMATCH');
if (Number.isNaN(Date.parse(current.linear_updated_at))) violations.push('INVALID_LINEAR_REVISION');
if (!/^[0-9a-f]{64}$/i.test(current.contract_hash)) violations.push('INVALID_CONTRACT_HASH');
return [{ json: { current, merge_input_valid: violations.length === 0, violation_codes: violations } }];`,
  },
};

const readMergeBaselines = {
  id: 'get-merge-baseline-records-ai95',
  name: 'Get Merge Baseline Records',
  type: 'n8n-nodes-base.dataTable',
  typeVersion: 1.1,
  position: [672, 64],
  parameters: {
    resource: 'row',
    operation: 'get',
    dataTableId: {
      __rl: true,
      mode: 'name',
      value: 'ai95_governance_baselines',
      cachedResultName: 'ai95_governance_baselines',
    },
    returnAll: true,
  },
};

const evaluateMerge = {
  id: 'evaluate-merge-baseline-ai95',
  name: 'Evaluate Merge Baseline',
  type: 'n8n-nodes-base.code',
  typeVersion: 2,
  position: [896, 64],
  parameters: {
    mode: 'runOnceForAllItems',
    jsCode: String.raw`const prepared = $('Prepare Merge Baseline Check').first().json || {};
const current = prepared.current || {};
const records = $input.all().map((item) => item.json || {}).filter((record) => record.id !== undefined && record.id !== null);
const text = (value) => typeof value === 'string' ? value.trim() : '';
const normalizeRepository = (value) => text(value).replace(/\\/g, '/').replace(/^https?:\/\//i, '').replace(/^git@([^:]+):/i, '$1/').replace(/^\/+|\/+$/g, '').replace(/\.git$/i, '').toLowerCase();
const fail = (code, outcome = 'FAIL', changed_fields = []) => [{ json: { outcome, allowed: false, code, storage_verified: false, violation_codes: [code], changed_fields } }];
if (prepared.merge_input_valid !== true) return fail((prepared.violation_codes || [])[0] || 'BASELINE_INPUT_INVALID');
const scoped = records.filter((record) => text(record.task_id).toUpperCase() === text(current.task_id).toUpperCase() && normalizeRepository(record.repository) === normalizeRepository(current.repository) && text(record.branch_name) === text(current.branch_name));
const active = scoped.filter((record) => text(record.status) === 'active');
if (active.length === 0) return fail('BASELINE_MISSING');
if (active.length > 1) return fail('BASELINE_AMBIGUOUS');
const baseline = active[0];
if (!Number.isFinite(Date.parse(baseline.expires_at)) || Date.parse(baseline.expires_at) <= Date.now()) return fail('BASELINE_EXPIRED');
if (text(current.permitted_action) !== 'pr_merge_gate' || text(baseline.permitted_action) !== 'local_build_start') return fail('BASELINE_ACTION_MISMATCH');
const changed = [];
if (text(current.linear_updated_at) !== text(baseline.linear_updated_at)) changed.push('linear_updated_at');
if (text(current.contract_hash).toLowerCase() !== text(baseline.contract_hash).toLowerCase()) changed.push('contract_hash');
if (text(current.governance_policy_version) !== text(baseline.governance_policy_version)) changed.push('governance_policy_version');
if (text(current.story_contract_version) !== text(baseline.story_contract_version)) changed.push('story_contract_version');
if (changed.length) return fail('BASELINE_STALE', 'REPLAN', changed);
return [{ json: { outcome: 'PASS', allowed: true, code: 'BASELINE_CURRENT', storage_verified: true, violation_codes: [], baseline } }];`,
  },
};

workflow.nodes.push(routeAction, prepareMerge, readMergeBaselines, evaluateMerge);
workflow.connections['Baseline Input'] = {
  main: [[{ node: 'Route Governance Action', type: 'main', index: 0 }]],
};
workflow.connections['Route Governance Action'] = {
  main: [
    [{ node: 'Prepare Merge Baseline Check', type: 'main', index: 0 }],
    [{ node: 'Prepare Baseline Candidate', type: 'main', index: 0 }],
  ],
};
workflow.connections['Prepare Merge Baseline Check'] = {
  main: [[{ node: 'Get Merge Baseline Records', type: 'main', index: 0 }]],
};
workflow.connections['Get Merge Baseline Records'] = {
  main: [[{ node: 'Evaluate Merge Baseline', type: 'main', index: 0 }]],
};

const serializedWorkflow = `${JSON.stringify(workflow, null, 2)}\n`;
if (process.argv.includes('--check')) {
  const committedWorkflow = await readFile(targetUrl, 'utf8');
  assert.equal(
    committedWorkflow.replace(/\r\n?/g, '\n'),
    serializedWorkflow.replace(/\r\n?/g, '\n'),
    'The committed AI-95 baseline candidate has drifted. Run this script without --check to regenerate it.',
  );
} else {
  await writeFile(targetUrl, serializedWorkflow);
}
