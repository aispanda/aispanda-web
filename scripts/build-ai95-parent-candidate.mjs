import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

import { GOVERNANCE_CONSUMER_PROFILES, validateConsumerProfiles } from '../server/governance-consumers.mjs';

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

assert.deepEqual(validateConsumerProfiles(), [], 'Governance consumer profiles must be valid before workflow generation');

function deterministicWebhookId(profileId) {
  const hex = createHash('sha256').update(`governance-consumer:${profileId}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function consumerNormalizerCode(profile) {
  return `const body = $json.body && typeof $json.body === 'object' ? $json.body : {};
const text = (value) => typeof value === 'string' ? value.trim() : '';
const profile = ${JSON.stringify(profile)};
const normalizeRepository = (value) => {
  const supplied = text(value);
  if (!supplied || supplied.split('').some((character) => character.trim() === '' || ['\\\\', '*', '?', '[', ']', '{', '}'].includes(character)) || /%[0-9a-f]{2}/i.test(supplied)) return null;
  let host = '';
  let path = '';
  const scp = supplied.match(/^git@([^:]+):(.+)$/);
  if (scp) {
    host = scp[1];
    path = scp[2];
  } else if (supplied.includes('://')) {
    const uri = supplied.match(/^([a-z][a-z0-9+.-]*):\\/\\/([^/?#]+)(\\/[^?#]*)?$/i);
    if (!uri) return null;
    const protocol = uri[1].toLowerCase();
    if (!['https', 'ssh'].includes(protocol)) return null;
    let authority = uri[2];
    const atIndex = authority.lastIndexOf('@');
    if (atIndex >= 0) {
      if (authority.indexOf('@') !== atIndex) return null;
      const username = authority.slice(0, atIndex);
      authority = authority.slice(atIndex + 1);
      if (username.includes(':') || protocol !== 'ssh' || username !== 'git') return null;
    }
    if (!authority || authority.includes(':')) return null;
    host = authority;
    path = uri[3] || '';
  } else {
    const parts = supplied.split('/');
    host = parts.shift() || '';
    path = parts.join('/');
  }
  host = host.toLowerCase();
  while (path.startsWith('/')) path = path.slice(1);
  while (path.endsWith('/')) path = path.slice(0, -1);
  if (path.endsWith('.git')) path = path.slice(0, -4);
  const parts = path.split('/');
  const segment = /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/;
  if (host !== 'github.com' || parts.length !== 2 || parts.some((part) => !segment.test(part))) return null;
  return host + '/' + parts.join('/');
};
const repository = normalizeRepository(body.repository);
const consumerViolationCodes = [];
if (!repository) consumerViolationCodes.push('INVALID_REPOSITORY_IDENTITY');
else if (repository !== profile.repository) consumerViolationCodes.push('CONSUMER_REPOSITORY_MISMATCH');
if (!profile.actions.includes(text(body.permitted_action))) consumerViolationCodes.push('ACTION_NOT_APPROVED');
if (profile.callers !== null && text(body.caller) !== profile.callers[0]) consumerViolationCodes.push('CALLER_NOT_APPROVED');
if (text(body.governance_policy_version) !== profile.governance_policy_version) consumerViolationCodes.push('POLICY_VERSION_MISMATCH');
if (text(body.story_contract_version) !== profile.story_contract_version) consumerViolationCodes.push('SYNTAX_VERSION_MISMATCH');
return {
  json: {
    request: {
      expected_task_id: text(body.task_id).toUpperCase(),
      expected_repository: profile.repository,
      expected_policy_version: profile.governance_policy_version,
      expected_story_contract_version: profile.story_contract_version,
      permitted_action: text(body.permitted_action),
      consumer_id: profile.id,
      consumer_violation_codes: consumerViolationCodes,
    },
    runtime: {
      branch_name: text(body.branch_name),
      head_sha: text(body.head_sha),
      repository: text(body.repository),
      caller: profile.callers === null ? text(body.caller) : profile.callers[0],
      operation_id: text(body.operation_id),
    },
  },
};`;
}

workflow.id = 'ai95buildcandidate1';
workflow.name = 'AI-95 authorize_build_start Integration Candidate (Inactive)';
workflow.active = false;
workflow.settings = { ...workflow.settings, availableInMCP: false };

const webhook = workflowNode('Authorized Build-Start Request');
const webProfile = GOVERNANCE_CONSUMER_PROFILES.find((profile) => profile.id === 'aispanda-web');
const governanceProfile = GOVERNANCE_CONSUMER_PROFILES.find((profile) => profile.id === 'aispanda-governance');
assert.ok(webProfile && governanceProfile, 'Both approved consumer profiles are required');
webhook.webhookId = 'f3fdd5c1-cc2a-47e1-95d0-bf0bd6829a95';
webhook.parameters.path = webProfile.webhook_path;

const webNormalizer = workflowNode('Normalize Authorization Request');
webNormalizer.parameters.jsCode = consumerNormalizerCode(webProfile);

const governanceWebhook = structuredClone(webhook);
governanceWebhook.id = `webhook-${governanceProfile.id}`;
governanceWebhook.name = 'Governance Consumer Build-Start Request';
governanceWebhook.webhookId = deterministicWebhookId(governanceProfile.id);
governanceWebhook.parameters.path = governanceProfile.webhook_path;
governanceWebhook.position = [webhook.position[0], webhook.position[1] + 320];
delete governanceWebhook.credentials;

const governanceNormalizer = structuredClone(webNormalizer);
governanceNormalizer.id = `normalize-${governanceProfile.id}`;
governanceNormalizer.name = 'Normalize Governance Consumer Request';
governanceNormalizer.parameters.jsCode = consumerNormalizerCode(governanceProfile);
governanceNormalizer.position = [webNormalizer.position[0], webNormalizer.position[1] + 320];
delete governanceNormalizer.credentials;

const requestContext = structuredClone(webNormalizer);
requestContext.id = 'authorization-request-context-ai99';
requestContext.name = 'Authorization Request Context';
requestContext.parameters.jsCode = 'return { json: $json };';
requestContext.position = [webNormalizer.position[0] + 240, webNormalizer.position[1] + 160];
delete requestContext.credentials;
workflow.nodes.push(governanceWebhook, governanceNormalizer, requestContext);
workflow.connections[webNormalizer.name].main[0] = [{ node: requestContext.name, type: 'main', index: 0 }];
workflow.connections[governanceWebhook.name] = {
  main: [[{ node: governanceNormalizer.name, type: 'main', index: 0 }]],
};
workflow.connections[governanceNormalizer.name] = {
  main: [
    [{ node: requestContext.name, type: 'main', index: 0 }],
    [{ node: 'Respond Controller Error', type: 'main', index: 0 }],
  ],
};
workflow.connections[requestContext.name] = {
  main: [
    [{ node: 'Request Has Task ID', type: 'main', index: 0 }],
    [{ node: 'Respond Controller Error', type: 'main', index: 0 }],
  ],
};

const validator = workflowNode('Validate Contract and Branch');
validator.parameters.jsCode = replaceOnce(
  validator.parameters.jsCode,
  "$('Normalize Authorization Request')",
  "$('Authorization Request Context')",
  'shared authorization request context',
);
validator.parameters.jsCode = replaceOnce(
  validator.parameters.jsCode,
  "const normalizeRepo=(value)=>{let repo=text(value).replace(/\\\\/g,'/');const ssh=repo.match(/^git@([^:]+):(.+)$/i);if(ssh)repo=ssh[1]+'/'+ssh[2];else{try{const url=new URL(repo);repo=url.hostname+url.pathname;}catch{repo=repo.replace(/^ssh:\\/\\//i,'');}}return repo.replace(/^\\/+|\\/+$/g,'').replace(/\\.git$/i,'').toLowerCase();};",
  "const normalizeRepo=(value)=>{let repo=text(value).replace(/\\\\/g,'/');const scp=repo.match(/^git@([^:]+):(.+)$/i);if(scp)repo=scp[1]+'/'+scp[2];else{const uri=repo.match(/^(?:https|ssh):\\/\\/(?:git@)?([^/?#:]+)(\\/[^?#]*)$/i);if(uri)repo=uri[1]+uri[2];else repo=repo.replace(/^ssh:\\/\\//i,'');}return repo.replace(/^\\/+|\\/+$/g,'').replace(/\\.git$/i,'').toLowerCase();};",
  'n8n-compatible repository normalization',
);
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
  "'MISSING_PERMITTED_ACTION','UNSUPPORTED_ACTION','INVALID_OPERATION_ID','INVALID_BRANCH_FORMAT','LINEAR_BRANCH_MISSING','LINEAR_BRANCH_TASK_MISMATCH','INVALID_REPOSITORY_IDENTITY','CONSUMER_NOT_APPROVED','CONSUMER_REPOSITORY_MISMATCH','ACTION_NOT_APPROVED','CALLER_NOT_APPROVED'",
  'runtime-code set',
);
validator.parameters.jsCode = replaceOnce(
  validator.parameters.jsCode,
  "const options=payload.request||{};const runtime=payload.runtime||{};",
  "const options=payload.request||{};const runtime=payload.runtime||{};const consumerCodes=Array.isArray(options.consumer_violation_codes)?options.consumer_violation_codes:[];consumerCodes.forEach((code)=>add(text(code),'consumer','Governed consumer profile rejected the request.'));",
  'consumer-profile violations',
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
  "'MISSING_PERMITTED_ACTION','UNSUPPORTED_ACTION','INVALID_OPERATION_ID','INVALID_BRANCH_FORMAT','LINEAR_BRANCH_MISSING','LINEAR_BRANCH_TASK_MISMATCH','INVALID_REPOSITORY_IDENTITY','CONSUMER_NOT_APPROVED','CONSUMER_REPOSITORY_MISMATCH','ACTION_NOT_APPROVED','CALLER_NOT_APPROVED','CONTROLLER_INVALID_OUTPUT'",
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

// Webhook authentication headers contain secrets. Keep the authorization
// decision and baseline as the audit evidence, not the raw execution payload.
workflow.settings = {
  ...workflow.settings,
  saveDataSuccessExecution: 'none',
  saveDataErrorExecution: 'none',
  saveManualExecutions: false,
  saveExecutionProgress: false,
};

const serializedWorkflow = `${JSON.stringify(workflow, null, 2)}\n`;

if (process.argv.includes('--check')) {
  const committedWorkflow = await readFile(targetUrl, 'utf8');
  assert.equal(
    committedWorkflow.replace(/\r\n?/g, '\n'),
    serializedWorkflow.replace(/\r\n?/g, '\n'),
    'The committed AI-95 parent candidate has drifted from its deterministic builder. Run this script without --check to regenerate it.',
  );
} else {
  await writeFile(targetUrl, serializedWorkflow);
}
