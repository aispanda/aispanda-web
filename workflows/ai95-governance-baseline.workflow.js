import { expr, node, switchCase, trigger, workflow } from '@n8n/workflow-sdk';

const baselineTable = {
  __rl: true,
  mode: 'name',
  value: 'ai95_governance_baselines',
  cachedResultName: 'ai95_governance_baselines',
};

const baselineSchema = [
  { id: 'operation_id', displayName: 'operation_id', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
  { id: 'request_fingerprint', displayName: 'request_fingerprint', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
  { id: 'task_id', displayName: 'task_id', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
  { id: 'repository', displayName: 'repository', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
  { id: 'branch_name', displayName: 'branch_name', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
  { id: 'head_sha', displayName: 'head_sha', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
  { id: 'caller_identity', displayName: 'caller_identity', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
  { id: 'permitted_action', displayName: 'permitted_action', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
  { id: 'governance_policy_version', displayName: 'governance_policy_version', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
  { id: 'story_contract_version', displayName: 'story_contract_version', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
  { id: 'linear_updated_at', displayName: 'linear_updated_at', required: false, defaultMatch: false, display: true, type: 'dateTime', canBeUsedToMatch: true },
  { id: 'contract_hash', displayName: 'contract_hash', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
  { id: 'outcome', displayName: 'outcome', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
  { id: 'status', displayName: 'status', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
  { id: 'created_at', displayName: 'created_at', required: false, defaultMatch: false, display: true, type: 'dateTime', canBeUsedToMatch: true },
  { id: 'expires_at', displayName: 'expires_at', required: false, defaultMatch: false, display: true, type: 'dateTime', canBeUsedToMatch: true },
];

const input = trigger({
  type: 'n8n-nodes-base.executeWorkflowTrigger',
  version: 1.2,
  config: {
    name: 'Baseline Input',
    parameters: {
      inputSource: 'workflowInputs',
      workflowInputs: {
        values: [
          { name: 'task_id', type: 'string' },
          { name: 'repository', type: 'string' },
          { name: 'branch_name', type: 'string' },
          { name: 'head_sha', type: 'string' },
          { name: 'caller_identity', type: 'string' },
          { name: 'permitted_action', type: 'string' },
          { name: 'operation_id', type: 'string' },
          { name: 'governance_policy_version', type: 'string' },
          { name: 'story_contract_version', type: 'string' },
          { name: 'linear_updated_at', type: 'string' },
          { name: 'contract_hash', type: 'string' },
          { name: 'build_allowed', type: 'boolean' },
        ],
      },
    },
  },
});

const prepareCandidate = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Prepare Baseline Candidate',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: `const source = $input.first().json || {};
const text = (value) => typeof value === 'string' ? value.trim() : '';
const normalizeRepository = (value) => {
  let repository = text(value).replace(/\\\\/g, '/');
  const ssh = repository.match(/^git@([^:]+):(.+)$/i);
  if (ssh) repository = ssh[1] + '/' + ssh[2];
  else repository = repository.replace(/^(?:https?|ssh):\\/\\//i, '');
  return repository.replace(/^\\/+|\\/+$/g, '').replace(/\\.git$/i, '').toLowerCase();
};
const taskId = text(source.task_id).toUpperCase();
const repository = normalizeRepository(source.repository);
const branchName = text(source.branch_name);
const branchMatch = branchName.match(/^codex\\/([a-z][a-z0-9]*-[0-9]+)-[a-z0-9][a-z0-9._-]*$/i);
const operationId = text(source.operation_id);
const violations = [];
if (source.build_allowed !== true) violations.push('UPSTREAM_BUILD_NOT_ALLOWED');
if (!/^[A-Z][A-Z0-9]*-\\d+$/.test(taskId)) violations.push('INVALID_TASK_ID');
if (!/^[a-z0-9.-]+\\/[^\\s/]+\\/[^\\s/]+$/i.test(repository)) violations.push('INVALID_REPOSITORY');
if (!branchMatch) violations.push('INVALID_BRANCH_FORMAT');
else if (branchMatch[1].toUpperCase() !== taskId) violations.push('BRANCH_TASK_MISMATCH');
if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(text(source.head_sha))) violations.push('INVALID_HEAD_SHA');
if (!text(source.caller_identity)) violations.push('MISSING_CALLER');
if (text(source.permitted_action) !== 'local_build_start') violations.push('UNSUPPORTED_ACTION');
if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(operationId)) violations.push('INVALID_OPERATION_ID');
if (text(source.governance_policy_version) !== 'governance-policy-v1.1') violations.push('POLICY_VERSION_MISMATCH');
if (text(source.story_contract_version) !== 'story-contract-v2') violations.push('SYNTAX_VERSION_MISMATCH');
if (Number.isNaN(Date.parse(text(source.linear_updated_at)))) violations.push('INVALID_LINEAR_REVISION');
if (!/^[0-9a-f]{64}$/i.test(text(source.contract_hash))) violations.push('INVALID_CONTRACT_HASH');
const normalized = {
  task_id: taskId,
  repository,
  branch_name: branchName,
  head_sha: text(source.head_sha).toLowerCase(),
  caller: text(source.caller_identity),
  permitted_action: text(source.permitted_action),
  operation_id: operationId,
  governance_policy_version: text(source.governance_policy_version),
  story_contract_version: text(source.story_contract_version),
  linear_updated_at: text(source.linear_updated_at),
  contract_hash: text(source.contract_hash).toLowerCase(),
};
const fingerprintInput = JSON.stringify({
  branch_name: normalized.branch_name,
  caller: normalized.caller,
  contract_hash: normalized.contract_hash,
  governance_policy_version: normalized.governance_policy_version,
  head_sha: normalized.head_sha,
  linear_updated_at: normalized.linear_updated_at,
  permitted_action: normalized.permitted_action,
  repository: normalized.repository,
  story_contract_version: normalized.story_contract_version,
  task_id: normalized.task_id,
});
return [{ json: { ...normalized, adapter_input_valid: violations.length === 0, violation_codes: violations, fingerprint_input: fingerprintInput } }];`,
    },
  },
});

const hashCandidate = node({
  type: 'n8n-nodes-base.crypto',
  version: 2,
  config: {
    name: 'Calculate Baseline Fingerprint',
    parameters: {
      action: 'hash',
      binaryData: false,
      type: 'SHA256',
      value: expr('{{ $json.fingerprint_input }}'),
      dataPropertyName: 'request_fingerprint',
      encoding: 'hex',
    },
  },
});

const createCandidate = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Create Pending Candidate',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: `const item = $input.first().json || {};
const violations = Array.isArray(item.violation_codes) ? [...item.violation_codes] : [];
if (!/^[0-9a-f]{64}$/.test(item.request_fingerprint || '')) violations.push('INVALID_REQUEST_FINGERPRINT');
const now = Date.now();
const candidate = {
  operation_id: item.operation_id || '',
  request_fingerprint: item.request_fingerprint || '',
  task_id: item.task_id || '',
  repository: item.repository || '',
  branch_name: item.branch_name || '',
  head_sha: item.head_sha || '',
  caller_identity: item.caller || '',
  permitted_action: 'local_build_start',
  governance_policy_version: item.governance_policy_version || '',
  story_contract_version: item.story_contract_version || '',
  linear_updated_at: item.linear_updated_at || '',
  contract_hash: item.contract_hash || '',
  outcome: 'PASS',
  status: 'pending',
  created_at: new Date(now).toISOString(),
  expires_at: new Date(now + 24 * 60 * 60 * 1000).toISOString(),
};
return [{ json: { adapter_input_valid: item.adapter_input_valid === true && violations.length === 0, violation_codes: violations, candidate } }];`,
    },
  },
});

const getBaselines = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Get Baseline Records',
    alwaysOutputData: true,
    parameters: {
      resource: 'row',
      operation: 'get',
      dataTableId: baselineTable,
      returnAll: true,
    },
  },
});

const planTransition = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Plan Baseline Transition',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: `const prepared = $('Create Pending Candidate').first().json || {};
const candidate = prepared.candidate || {};
const records = $input.all().map((item) => item.json || {}).filter((record) => record.id !== undefined && record.id !== null);
const text = (value) => typeof value === 'string' ? value.trim() : '';
const upper = (value) => text(value).toUpperCase();
const normalizeRepository = (value) => text(value).replace(/\\\\/g, '/').replace(/^https?:\\/\\//i, '').replace(/^git@([^:]+):/i, '$1/').replace(/^\\/+|\\/+$/g, '').replace(/\\.git$/i, '').toLowerCase();
const sameScope = (left, right) => upper(left.task_id) === upper(right.task_id) && normalizeRepository(left.repository) === normalizeRepository(right.repository) && text(left.branch_name) === text(right.branch_name);
const expired = (record) => { const value = Date.parse(record.expires_at); return !Number.isFinite(value) || value <= Date.now(); };
const fail = (code) => [{ json: { mode: 'fail', outcome: 'FAIL', allowed: false, code, candidate } }];
if (prepared.adapter_input_valid !== true) return fail((prepared.violation_codes || [])[0] || 'BASELINE_INPUT_INVALID');
const operationMatches = records.filter((record) => text(record.operation_id) === text(candidate.operation_id));
if (operationMatches.length > 1) return fail('BASELINE_OPERATION_AMBIGUOUS');
if (operationMatches.length === 1 && text(operationMatches[0].request_fingerprint) !== text(candidate.request_fingerprint)) return fail('OPERATION_ID_CONFLICT');
const scoped = records.filter((record) => sameScope(record, candidate));
const active = scoped.filter((record) => record.status === 'active');
if (active.length > 1) return fail('BASELINE_AMBIGUOUS');
if (operationMatches.length === 1) {
  const existing = operationMatches[0];
  if (existing.status === 'active') {
    if (expired(existing)) return fail('BASELINE_EXPIRED');
    return [{ json: { mode: 'reuse', outcome: 'PASS', allowed: true, code: 'BASELINE_DUPLICATE', candidate, target_operation_id: existing.operation_id, expected_fingerprint: existing.request_fingerprint } }];
  }
  if (existing.status === 'retired') return fail('BASELINE_OPERATION_RETIRED');
  if (existing.status !== 'pending') return fail('BASELINE_STATUS_INVALID');
  if (expired(existing)) return fail('BASELINE_PENDING_EXPIRED');
  return [{ json: { mode: active.length === 1 ? 'resume_rollover' : 'resume_activate', outcome: 'PASS', allowed: true, code: 'BASELINE_ROLLOVER_RESUME', candidate: existing, target_operation_id: existing.operation_id, expected_fingerprint: existing.request_fingerprint, retire_row_id: active.length === 1 ? active[0].id : null } }];
}
if (active.length === 1) {
  return [{ json: { mode: 'rollover', outcome: 'PASS', allowed: true, code: 'BASELINE_ROLLOVER', candidate, target_operation_id: candidate.operation_id, expected_fingerprint: candidate.request_fingerprint, retire_row_id: active[0].id } }];
}
return [{ json: { mode: 'initialize', outcome: 'PASS', allowed: true, code: 'BASELINE_INITIALIZE', candidate, target_operation_id: candidate.operation_id, expected_fingerprint: candidate.request_fingerprint, retire_row_id: null } }];`,
    },
  },
});

const routeTransition = switchCase({
  version: 3.4,
  config: {
    name: 'Route Baseline Transition',
    parameters: {
      mode: 'rules',
      rules: {
        values: [
          { renameOutput: true, outputKey: 'fail', conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' }, conditions: [{ leftValue: expr('{{ $json.mode }}'), operator: { type: 'string', operation: 'equals' }, rightValue: 'fail' }], combinator: 'and' } },
          { renameOutput: true, outputKey: 'reuse', conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' }, conditions: [{ leftValue: expr('{{ $json.mode }}'), operator: { type: 'string', operation: 'equals' }, rightValue: 'reuse' }], combinator: 'and' } },
          { renameOutput: true, outputKey: 'initialize', conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' }, conditions: [{ leftValue: expr('{{ $json.mode }}'), operator: { type: 'string', operation: 'equals' }, rightValue: 'initialize' }], combinator: 'and' } },
          { renameOutput: true, outputKey: 'rollover', conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' }, conditions: [{ leftValue: expr('{{ $json.mode }}'), operator: { type: 'string', operation: 'equals' }, rightValue: 'rollover' }], combinator: 'and' } },
          { renameOutput: true, outputKey: 'resume rollover', conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' }, conditions: [{ leftValue: expr('{{ $json.mode }}'), operator: { type: 'string', operation: 'equals' }, rightValue: 'resume_rollover' }], combinator: 'and' } },
          { renameOutput: true, outputKey: 'resume activate', conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' }, conditions: [{ leftValue: expr('{{ $json.mode }}'), operator: { type: 'string', operation: 'equals' }, rightValue: 'resume_activate' }], combinator: 'and' } },
        ],
      },
      options: { fallbackOutput: 'extra', renameFallbackOutput: 'unexpected', allMatchingOutputs: false },
    },
  },
});

const insertValues = {
  operation_id: expr("{{ $('Plan Baseline Transition').first().json.candidate.operation_id }}"),
  request_fingerprint: expr("{{ $('Plan Baseline Transition').first().json.candidate.request_fingerprint }}"),
  task_id: expr("{{ $('Plan Baseline Transition').first().json.candidate.task_id }}"),
  repository: expr("{{ $('Plan Baseline Transition').first().json.candidate.repository }}"),
  branch_name: expr("{{ $('Plan Baseline Transition').first().json.candidate.branch_name }}"),
  head_sha: expr("{{ $('Plan Baseline Transition').first().json.candidate.head_sha }}"),
  caller_identity: expr("{{ $('Plan Baseline Transition').first().json.candidate.caller_identity }}"),
  permitted_action: expr("{{ $('Plan Baseline Transition').first().json.candidate.permitted_action }}"),
  governance_policy_version: expr("{{ $('Plan Baseline Transition').first().json.candidate.governance_policy_version }}"),
  story_contract_version: expr("{{ $('Plan Baseline Transition').first().json.candidate.story_contract_version }}"),
  linear_updated_at: expr("{{ $('Plan Baseline Transition').first().json.candidate.linear_updated_at }}"),
  contract_hash: expr("{{ $('Plan Baseline Transition').first().json.candidate.contract_hash }}"),
  outcome: 'PASS',
  status: 'pending',
  created_at: expr("{{ $('Plan Baseline Transition').first().json.candidate.created_at }}"),
  expires_at: expr("{{ $('Plan Baseline Transition').first().json.candidate.expires_at }}"),
};

const insertInitial = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: { name: 'Insert Initial Baseline', parameters: { resource: 'row', operation: 'insert', dataTableId: baselineTable, columns: { mappingMode: 'defineBelow', value: insertValues, schema: baselineSchema } } },
});

const insertReplacement = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: { name: 'Insert Replacement Baseline', parameters: { resource: 'row', operation: 'insert', dataTableId: baselineTable, columns: { mappingMode: 'defineBelow', value: insertValues, schema: baselineSchema } } },
});

const retirePrevious = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Retire Previous Baseline',
    parameters: {
      resource: 'row', operation: 'update', dataTableId: baselineTable, matchType: 'allConditions',
      filters: { conditions: [{ keyName: 'id', condition: 'eq', keyValue: expr("{{ $('Plan Baseline Transition').first().json.retire_row_id }}") }] },
      columns: { mappingMode: 'defineBelow', value: { status: 'retired' }, schema: baselineSchema },
    },
  },
});

const retirePreviousForResume = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Retire Previous For Resume',
    parameters: {
      resource: 'row', operation: 'update', dataTableId: baselineTable, matchType: 'allConditions',
      filters: { conditions: [{ keyName: 'id', condition: 'eq', keyValue: expr("{{ $('Plan Baseline Transition').first().json.retire_row_id }}") }] },
      columns: { mappingMode: 'defineBelow', value: { status: 'retired' }, schema: baselineSchema },
    },
  },
});

const activateInitial = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Activate Initial Baseline',
    parameters: {
      resource: 'row', operation: 'update', dataTableId: baselineTable, matchType: 'allConditions',
      filters: { conditions: [{ keyName: 'operation_id', condition: 'eq', keyValue: expr("{{ $('Plan Baseline Transition').first().json.target_operation_id }}") }, { keyName: 'status', condition: 'eq', keyValue: 'pending' }] },
      columns: { mappingMode: 'defineBelow', value: { status: 'active' }, schema: baselineSchema },
    },
  },
});

const activateReplacement = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Activate Replacement Baseline',
    parameters: {
      resource: 'row', operation: 'update', dataTableId: baselineTable, matchType: 'allConditions',
      filters: { conditions: [{ keyName: 'operation_id', condition: 'eq', keyValue: expr("{{ $('Plan Baseline Transition').first().json.target_operation_id }}") }, { keyName: 'status', condition: 'eq', keyValue: 'pending' }] },
      columns: { mappingMode: 'defineBelow', value: { status: 'active' }, schema: baselineSchema },
    },
  },
});

const activatePendingForResume = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Activate Pending For Resume',
    parameters: {
      resource: 'row', operation: 'update', dataTableId: baselineTable, matchType: 'allConditions',
      filters: { conditions: [{ keyName: 'operation_id', condition: 'eq', keyValue: expr("{{ $('Plan Baseline Transition').first().json.target_operation_id }}") }, { keyName: 'status', condition: 'eq', keyValue: 'pending' }] },
      columns: { mappingMode: 'defineBelow', value: { status: 'active' }, schema: baselineSchema },
    },
  },
});

const activatePendingAlone = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Activate Pending Alone',
    parameters: {
      resource: 'row', operation: 'update', dataTableId: baselineTable, matchType: 'allConditions',
      filters: { conditions: [{ keyName: 'operation_id', condition: 'eq', keyValue: expr("{{ $('Plan Baseline Transition').first().json.target_operation_id }}") }, { keyName: 'status', condition: 'eq', keyValue: 'pending' }] },
      columns: { mappingMode: 'defineBelow', value: { status: 'active' }, schema: baselineSchema },
    },
  },
});

const readAfterTransition = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Read After Transition',
    alwaysOutputData: true,
    parameters: { resource: 'row', operation: 'get', dataTableId: baselineTable, returnAll: true },
  },
});

const verifyTransition = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Verify Stored Baseline',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: `const plan = $('Plan Baseline Transition').first().json || {};
const rows = $input.all().map((item) => item.json || {}).filter((row) => row.id !== undefined && row.id !== null);
const text = (value) => typeof value === 'string' ? value.trim() : '';
const normalizeRepository = (value) => text(value).replace(/\\\\/g, '/').replace(/^https?:\\/\\//i, '').replace(/^git@([^:]+):/i, '$1/').replace(/^\\/+|\\/+$/g, '').replace(/\\.git$/i, '').toLowerCase();
const candidate = plan.candidate || {};
const scoped = rows.filter((row) => text(row.task_id).toUpperCase() === text(candidate.task_id).toUpperCase() && normalizeRepository(row.repository) === normalizeRepository(candidate.repository) && text(row.branch_name) === text(candidate.branch_name));
const active = scoped.filter((row) => row.status === 'active');
let code = plan.code || 'BASELINE_VERIFY_FAILED';
const violations = [];
if (active.length !== 1) violations.push(active.length === 0 ? 'BASELINE_MISSING' : 'BASELINE_AMBIGUOUS');
const baseline = active.length === 1 ? active[0] : null;
if (baseline && text(baseline.operation_id) !== text(plan.target_operation_id)) violations.push('BASELINE_OPERATION_MISMATCH');
if (baseline && text(baseline.request_fingerprint) !== text(plan.expected_fingerprint)) violations.push('BASELINE_FINGERPRINT_MISMATCH');
if (baseline && (!Number.isFinite(Date.parse(baseline.expires_at)) || Date.parse(baseline.expires_at) <= Date.now())) violations.push('BASELINE_EXPIRED');
if (plan.retire_row_id !== undefined && plan.retire_row_id !== null) {
  const retired = rows.filter((row) => String(row.id) === String(plan.retire_row_id));
  if (retired.length !== 1 || retired[0].status !== 'retired') violations.push('BASELINE_RETIRE_NOT_VERIFIED');
}
if (violations.length) code = violations[0];
return [{ json: { outcome: violations.length === 0 ? 'PASS' : 'FAIL', allowed: violations.length === 0, code, storage_verified: violations.length === 0, violation_codes: violations, baseline: violations.length === 0 ? baseline : null } }];`,
    },
  },
});

const returnFailure = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Return Baseline Failure',
    parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: `const plan = $('Plan Baseline Transition').first().json || {};
return [{ json: { outcome: 'FAIL', allowed: false, code: plan.code || 'BASELINE_ROUTE_INVALID', storage_verified: false, violation_codes: [plan.code || 'BASELINE_ROUTE_INVALID'] } }];` },
  },
});

export default workflow('ai95-governance-baseline', 'AI-95 Governance Baseline Store')
  .add(input)
  .to(prepareCandidate)
  .to(hashCandidate)
  .to(createCandidate)
  .to(getBaselines)
  .to(planTransition)
  .to(routeTransition
    .onCase(0, returnFailure)
    .onCase(1, readAfterTransition)
    .onCase(2, insertInitial.to(activateInitial.to(readAfterTransition)))
    .onCase(3, insertReplacement.to(retirePrevious.to(activateReplacement.to(readAfterTransition))))
    .onCase(4, retirePreviousForResume.to(activatePendingForResume.to(readAfterTransition)))
    .onCase(5, activatePendingAlone.to(readAfterTransition))
    .onCase(6, returnFailure))
  .add(readAfterTransition)
  .to(verifyTransition);
