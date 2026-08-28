import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';

const sourceUrl = new URL('../workflows/authorize-build-start.local.json', import.meta.url);
const targetUrl = new URL('../workflows/authorize-build-start-ai95.integration-candidate.local.json', import.meta.url);
const workflow = JSON.parse(await readFile(sourceUrl, 'utf8'));

function workflowNode(name) {
  const result = workflow.nodes.find((candidate) => candidate.name === name);
  assert.ok(result, `Missing source node: ${name}`);
  return result;
}

function replaceOnce(value, before, after, label) {
  assert.equal(value.split(before).length, 2, `Expected one ${label} replacement`);
  return value.replace(before, after);
}

workflow.id = 'ai95buildcandidate1';
workflow.name = 'AI-95 authorize_build_start Integration Candidate (Inactive)';
workflow.active = false;
workflow.settings = { ...workflow.settings, availableInMCP: false };

const webhook = workflowNode('Authorized Build-Start Request');
webhook.webhookId = 'f3fdd5c1-cc2a-47e1-95d0-bf0bd6829a95';
webhook.parameters.path = 'authorize-build-start-ai95-candidate';

workflowNode('Normalize Authorization Request').parameters.jsCode = `const body = $json.body && typeof $json.body === 'object' ? $json.body : {};
const text = (value) => typeof value === 'string' ? value.trim() : '';
return {
  json: {
    request: {
      expected_task_id: text(body.task_id).toUpperCase(),
      expected_repository: 'github.com/aispanda/aispanda-web',
      expected_policy_version: text(body.governance_policy_version),
      expected_story_contract_version: text(body.story_contract_version),
      permitted_action: text(body.permitted_action),
    },
    runtime: {
      branch_name: text(body.branch_name),
      head_sha: text(body.head_sha),
      repository: text(body.repository),
      caller: text(body.caller),
      operation_id: text(body.operation_id),
    },
  },
};`;

const validator = workflowNode('Validate Contract and Branch');
validator.parameters.jsCode = replaceOnce(
  validator.parameters.jsCode,
  "const status=field(issue,'status');if(status&&status!=='Ready'&&status!=='In Progress')add('STATUS_NOT_BUILDABLE','status','Build start requires Ready or In Progress.');",
  "const status=field(issue,'status');const requestedAction=text(options.permitted_action);if(status&&status!=='Ready'&&status!=='In Progress')add('STATUS_NOT_BUILDABLE','status','Governed progress requires Ready or In Progress.');if(status&&requestedAction==='pr_merge_gate'&&status!=='In Progress')add('STATUS_NOT_ACTIONABLE','status','The pull-request merge gate requires In Progress.');",
  'action-specific status validation',
);
validator.parameters.jsCode = replaceOnce(
  validator.parameters.jsCode,
  "else if(text(options.permitted_action)!=='local_build_start')add('UNSUPPORTED_ACTION','permitted_action','Only local_build_start is permitted.');",
  "else if(!['local_build_start','pr_merge_gate'].includes(requestedAction))add('UNSUPPORTED_ACTION','permitted_action','Only local_build_start or pr_merge_gate is permitted.');",
  'permitted-action validation',
);
validator.parameters.jsCode = replaceOnce(
  validator.parameters.jsCode,
  "'MISSING_PERMITTED_ACTION','UNSUPPORTED_ACTION'",
  "'MISSING_PERMITTED_ACTION','UNSUPPORTED_ACTION','INVALID_OPERATION_ID','INVALID_BRANCH_FORMAT','LINEAR_BRANCH_MISSING','LINEAR_BRANCH_TASK_MISMATCH'",
  'runtime-code set',
);
validator.parameters.jsCode = replaceOnce(
  validator.parameters.jsCode,
  "['branch_name','head_sha','repository','caller'].forEach",
  "['branch_name','head_sha','repository','caller','operation_id'].forEach",
  'required-runtime field list',
);
validator.parameters.jsCode = replaceOnce(
  validator.parameters.jsCode,
  "const branch=text(runtime.branch_name);",
  "if(text(runtime.operation_id)&&!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(text(runtime.operation_id)))add('INVALID_OPERATION_ID','operation_id','Operation ID must be 8-128 safe identifier characters.');const branch=text(runtime.branch_name);if(requestedAction==='pr_merge_gate'){const match=branch.match(/^codex\\/([a-z][a-z0-9]*-[0-9]+)-[a-z0-9][a-z0-9._-]*$/i);if(!match)add('INVALID_BRANCH_FORMAT','branch_name','Pull-request branches must use codex/<team>-<number>-<description>.');else if(expectedTask&&match[1].toUpperCase()!==expectedTask)add('BRANCH_TASK_MISMATCH','branch_name','Pull-request branch identifies a different task.');const linearBranch=text(issue&&issue.branchName);const linearMatch=linearBranch.match(/(?:^|\\/)([a-z][a-z0-9]*-[0-9]+)(?:-|$)/i);if(!linearMatch)add('LINEAR_BRANCH_MISSING','linear_branch_name','Linear did not provide an issue-linked branch identity.');else if(expectedTask&&linearMatch[1].toUpperCase()!==expectedTask)add('LINEAR_BRANCH_TASK_MISMATCH','linear_branch_name','Linear branch identity belongs to a different task.');}",
  'operation-ID validation',
);
validator.parameters.jsCode = replaceOnce(
  validator.parameters.jsCode,
  "branch_name:text(runtime.branch_name)||null,repository:text(runtime.repository)||null,caller:text(runtime.caller)||null,permitted_action:text(options.permitted_action)||null,contract_hash_input",
  "branch_name:text(runtime.branch_name)||null,head_sha:text(runtime.head_sha).toLowerCase()||null,repository:text(runtime.repository)||null,caller:text(runtime.caller)||null,operation_id:text(runtime.operation_id)||null,permitted_action:text(options.permitted_action)||null,contract_hash_input",
  'governed-runtime output',
);

const classifier = workflowNode('Classify Authorization Outcome');
classifier.parameters.jsCode = replaceOnce(
  classifier.parameters.jsCode,
  "'MISSING_PERMITTED_ACTION','UNSUPPORTED_ACTION','CONTROLLER_INVALID_OUTPUT'",
  "'MISSING_PERMITTED_ACTION','UNSUPPORTED_ACTION','INVALID_OPERATION_ID','INVALID_BRANCH_FORMAT','LINEAR_BRANCH_MISSING','LINEAR_BRANCH_TASK_MISMATCH','CONTROLLER_INVALID_OUTPUT'",
  'classifier fail set',
);
classifier.parameters.jsCode = replaceOnce(
  classifier.parameters.jsCode,
  "const blocked=new Set(['DECISION_BLOCKER','STATUS_NOT_BUILDABLE']);",
  "const blocked=new Set(['DECISION_BLOCKER','STATUS_NOT_BUILDABLE','STATUS_NOT_ACTIONABLE']);",
  'action-specific blocked set',
);

const parentPassed = {
  id: 'parent-authorization-passed-ai95',
  name: 'Parent Authorization Passed',
  type: 'n8n-nodes-base.if',
  typeVersion: 2.3,
  onError: 'continueErrorOutput',
  position: [2160, 0],
  parameters: {
    conditions: {
      combinator: 'and',
      options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
      conditions: [
        {
          leftValue: '={{ $json.outcome }}',
          rightValue: 'PASS',
          operator: { type: 'string', operation: 'equals' },
        },
        {
          leftValue: '={{ $json.build_allowed }}',
          rightValue: true,
          operator: { type: 'boolean', operation: 'true', singleValue: true },
        },
      ],
    },
    options: {},
  },
};

const prepareBaseline = {
  id: 'prepare-governance-baseline-ai95',
  name: 'Prepare Governance Baseline',
  type: 'n8n-nodes-base.code',
  typeVersion: 2,
  onError: 'continueErrorOutput',
  position: [2400, -96],
  parameters: {
    mode: 'runOnceForEachItem',
    jsCode: `const decision = $json || {};
return {
  json: {
    task_id: decision.task_id || '',
    repository: decision.repository || '',
    branch_name: decision.branch_name || '',
    head_sha: decision.head_sha || '',
    caller_identity: decision.caller || '',
    permitted_action: decision.permitted_action || '',
    operation_id: decision.operation_id || '',
    governance_policy_version: decision.governance_policy_version || '',
    story_contract_version: decision.story_contract_version || '',
    linear_updated_at: decision.linear_updated_at || '',
    contract_hash: decision.contract_hash || '',
    build_allowed: decision.outcome === 'PASS' && decision.build_allowed === true,
  },
};`,
  },
};

const baselineInputs = [
  ['task_id', 'string'],
  ['repository', 'string'],
  ['branch_name', 'string'],
  ['head_sha', 'string'],
  ['caller_identity', 'string'],
  ['permitted_action', 'string'],
  ['operation_id', 'string'],
  ['governance_policy_version', 'string'],
  ['story_contract_version', 'string'],
  ['linear_updated_at', 'string'],
  ['contract_hash', 'string'],
  ['build_allowed', 'boolean'],
];

const storeBaseline = {
  id: 'store-governance-baseline-ai95',
  name: 'Store Governance Baseline',
  type: 'n8n-nodes-base.executeWorkflow',
  typeVersion: 1.3,
  onError: 'continueErrorOutput',
  position: [2640, -96],
  parameters: {
    mode: 'once',
    source: 'database',
    workflowId: {
      __rl: true,
      mode: 'id',
      value: '__AI95_BASELINE_WORKFLOW_ID__',
      cachedResultName: 'AI-95 Governance Baseline Store',
    },
    workflowInputs: {
      mappingMode: 'defineBelow',
      value: Object.fromEntries(baselineInputs.map(([name]) => [name, `={{ $json.${name} }}`])),
      schema: baselineInputs.map(([name, type]) => ({
        id: name,
        displayName: name,
        required: false,
        defaultMatch: false,
        display: true,
        type,
        canBeUsedToMatch: true,
      })),
    },
    options: { waitForSubWorkflow: true },
  },
};

const finalizeAuthorization = {
  id: 'finalize-persisted-authorization-ai95',
  name: 'Finalize Persisted Authorization',
  type: 'n8n-nodes-base.code',
  typeVersion: 2,
  onError: 'continueErrorOutput',
  position: [2880, -96],
  parameters: {
    mode: 'runOnceForEachItem',
    jsCode: `const child = $json && typeof $json === 'object' ? $json : {};
const parent = $('Classify Authorization Outcome').first().json || {};
const text = (value) => typeof value === 'string' ? value.trim() : '';
const normalizeRepository = (value) => text(value).replace(/\\\\/g, '/').replace(/^https?:\\/\\//i, '').replace(/^git@([^:]+):/i, '$1/').replace(/^\\/+|\\/+$/g, '').replace(/\\.git$/i, '').toLowerCase();
const baseline = child.baseline && typeof child.baseline === 'object' ? child.baseline : null;
const localExact = baseline &&
  text(baseline.status) === 'active' &&
  text(baseline.operation_id) === text(parent.operation_id) &&
  text(baseline.task_id).toUpperCase() === text(parent.task_id).toUpperCase() &&
  normalizeRepository(baseline.repository) === normalizeRepository(parent.repository) &&
  text(baseline.branch_name) === text(parent.branch_name) &&
  text(baseline.head_sha).toLowerCase() === text(parent.head_sha).toLowerCase() &&
  text(baseline.caller_identity) === text(parent.caller) &&
  text(baseline.permitted_action) === text(parent.permitted_action) &&
  text(baseline.governance_policy_version) === text(parent.governance_policy_version) &&
  text(baseline.story_contract_version) === text(parent.story_contract_version) &&
  text(baseline.linear_updated_at) === text(parent.linear_updated_at) &&
  text(baseline.contract_hash).toLowerCase() === text(parent.contract_hash).toLowerCase();
const mergeExact = baseline &&
  text(baseline.status) === 'active' &&
  text(baseline.task_id).toUpperCase() === text(parent.task_id).toUpperCase() &&
  normalizeRepository(baseline.repository) === normalizeRepository(parent.repository) &&
  text(baseline.branch_name) === text(parent.branch_name) &&
  text(baseline.permitted_action) === 'local_build_start' &&
  text(baseline.governance_policy_version) === text(parent.governance_policy_version) &&
  text(baseline.story_contract_version) === text(parent.story_contract_version) &&
  text(baseline.linear_updated_at) === text(parent.linear_updated_at) &&
  text(baseline.contract_hash).toLowerCase() === text(parent.contract_hash).toLowerCase();
const exact = parent.permitted_action === 'local_build_start' ? localExact : (parent.permitted_action === 'pr_merge_gate' ? mergeExact : false);
const childPassed = child.outcome === 'PASS' && child.allowed === true && child.storage_verified === true;
if (parent.outcome === 'PASS' && parent.build_allowed === true && childPassed && exact) {
  return { json: { ...parent, outcome: 'PASS', response_status: 200, validation_passed: true, build_allowed: true, storage_verified: true, baseline_code: text(child.code) || null, baseline_request_fingerprint: text(baseline.request_fingerprint) || null, authorization_mode: parent.permitted_action === 'pr_merge_gate' ? 'localhost_merge_verified' : 'localhost_persisted' } };
}
const childCodes = Array.isArray(child.violation_codes) ? child.violation_codes.filter((value) => typeof value === 'string' && value) : [];
const failureCode = childPassed ? 'BASELINE_RESPONSE_MISMATCH' : (text(child.code) || 'BASELINE_STORAGE_FAILED');
const violationCodes = Array.from(new Set([...(Array.isArray(parent.violation_codes) ? parent.violation_codes : []), ...childCodes, failureCode]));
const deniedOutcome = child.outcome === 'REPLAN' ? 'REPLAN' : 'FAIL';
return { json: { ...parent, outcome: deniedOutcome, response_status: deniedOutcome === 'REPLAN' ? 422 : 502, validation_passed: false, build_allowed: false, storage_verified: false, baseline_code: text(child.code) || null, violation_codes: violationCodes, authorization_mode: parent.permitted_action === 'pr_merge_gate' ? 'localhost_merge_denied' : 'localhost_persisted_denied' } };`,
  },
};

const baselineError = {
  id: 'respond-baseline-dependency-error-ai95',
  name: 'Respond Baseline Dependency Error',
  type: 'n8n-nodes-base.respondToWebhook',
  typeVersion: 1.5,
  position: [2880, 192],
  parameters: {
    respondWith: 'json',
    responseBody: "={{ { contract_version: '2.0', governance_policy_version: 'governance-policy-v1.1', story_contract_version: 'story-contract-v2', ok: false, contract_complete: false, governance_compliant: false, runtime_valid: false, candidate_build_allowed: false, validation_passed: false, build_allowed: false, storage_verified: false, authorization_capable: false, outcome: 'FAIL', violation_codes: ['BASELINE_DEPENDENCY_ERROR'] } }}",
    options: { responseCode: 502 },
  },
};

workflow.nodes.push(parentPassed, prepareBaseline, storeBaseline, finalizeAuthorization, baselineError);
workflowNode('Respond Authorization Outcome').position = [3120, 0];

workflow.connections['Classify Authorization Outcome'].main[0] = [{ node: 'Parent Authorization Passed', type: 'main', index: 0 }];
workflow.connections['Parent Authorization Passed'] = {
  main: [
    [{ node: 'Prepare Governance Baseline', type: 'main', index: 0 }],
    [{ node: 'Respond Authorization Outcome', type: 'main', index: 0 }],
    [{ node: 'Respond Controller Error', type: 'main', index: 0 }],
  ],
};
workflow.connections['Prepare Governance Baseline'] = {
  main: [
    [{ node: 'Store Governance Baseline', type: 'main', index: 0 }],
    [{ node: 'Respond Baseline Dependency Error', type: 'main', index: 0 }],
  ],
};
workflow.connections['Store Governance Baseline'] = {
  main: [
    [{ node: 'Finalize Persisted Authorization', type: 'main', index: 0 }],
    [{ node: 'Respond Baseline Dependency Error', type: 'main', index: 0 }],
  ],
};
workflow.connections['Finalize Persisted Authorization'] = {
  main: [
    [{ node: 'Respond Authorization Outcome', type: 'main', index: 0 }],
    [{ node: 'Respond Baseline Dependency Error', type: 'main', index: 0 }],
  ],
};

const serializedWorkflow = `${JSON.stringify(workflow, null, 2)}\n`;

if (process.argv.includes('--check')) {
  const committedWorkflow = await readFile(targetUrl, 'utf8');
  assert.equal(
    committedWorkflow,
    serializedWorkflow,
    'The committed AI-95 parent candidate has drifted from its deterministic builder. Run this script without --check to regenerate it.',
  );
} else {
  await writeFile(targetUrl, serializedWorkflow);
}
