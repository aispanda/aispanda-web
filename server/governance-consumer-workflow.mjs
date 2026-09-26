import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import {
  GOVERNANCE_CONSUMER_PROFILES,
  GOVERNANCE_CONSUMER_PROFILE_SCHEMA_VERSION,
  serializedConsumerProfiles,
  validateConsumerProfiles,
} from './governance-consumers.mjs';

export const AUTHORIZATION_REQUEST_CONTEXT_NODE = 'Authorization Request Context';

const gitAttestationViolationCodes = Object.freeze([
  'GIT_ORIGIN_ATTESTATION_UNAVAILABLE',
  'GIT_REPOSITORY_ATTESTATION_MISMATCH',
  'GIT_BRANCH_ATTESTATION_UNAVAILABLE',
  'GIT_BRANCH_ATTESTATION_MISMATCH',
  'GIT_HEAD_ATTESTATION_UNAVAILABLE',
  'GIT_HEAD_ATTESTATION_MISMATCH',
]);

export { gitAttestationViolationCodes as GIT_ATTESTATION_VIOLATION_CODES };

function workflowNode(workflow, name) {
  const result = workflow.nodes.find((candidate) => candidate.name === name);
  assert.ok(result, `Missing source node: ${name}`);
  return result;
}

function deterministicWebhookId(profileId) {
  const hex = createHash('sha256').update(`governance-consumer:${profileId}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export function consumerRepositoryRootPlaceholder(profileId) {
  assert.match(profileId, /^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Consumer profile ID must be canonical');
  return `__GOVERNANCE_REPOSITORY_ROOT_${profileId.replaceAll('-', '_').toUpperCase()}__`;
}

export function consumerNormalizerCode(profile) {
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
if (profile.actions.includes('pr_merge_gate') && text(body.permitted_action) === 'pr_merge_gate' && text(body.caller) !== 'github-actions' && !consumerViolationCodes.includes('CALLER_NOT_APPROVED')) consumerViolationCodes.push('CALLER_NOT_APPROVED');
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
      repository_path: text(body.repository_path),
      caller: profile.callers === null ? text(body.caller) : profile.callers[0],
      operation_id: text(body.operation_id),
    },
  },
};`;
}

export function consumerRepositoryPathGuardCode(profile) {
  const root = consumerRepositoryRootPlaceholder(profile.id);
  return `const input = $json || {};
const supplied = typeof input.runtime?.repository_path === 'string' ? input.runtime.repository_path.trim() : '';
const allowedRoot = ${JSON.stringify(root)};
const normalizePath = (value) => {
  let result = value.replace(/\\\\/g, '/');
  while (result.endsWith('/')) result = result.slice(0, -1);
  return result;
};
const candidate = normalizePath(supplied);
const root = normalizePath(allowedRoot);
const segments = candidate.split('/');
const absoluteWindowsPath = /^[A-Za-z]:[/]/.test(candidate);
const safeSegments = !segments.some((segment) => !segment || segment === '.' || segment === '..');
const withinRoot = candidate.toLowerCase() === root.toLowerCase() || candidate.toLowerCase().startsWith(root.toLowerCase() + '/');
if (!absoluteWindowsPath || !safeSegments || !withinRoot) throw new Error('Repository path is outside the runtime-bound consumer root.');
return { json: { ...input, runtime: { ...input.runtime, repository_path: candidate } } };`;
}

export function consumerGitAttestorCode(profile, names = routeNames(profile, 0)) {
  return `const requestContext = $('${names.pathGuard}').first().json || {};
const status = $('${names.gitStatus}').first().json || {};
const head = $('${names.gitHead}').first().json || {};
const profile = ${JSON.stringify(profile)};
const text = (value) => typeof value === 'string' ? value.trim() : '';
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
const configuredOrigins = $input.all().flatMap((item) => {
  const value = item.json?.['remote.origin.url'];
  return Array.isArray(value) ? value : [value];
}).map(normalizeRepository).filter(Boolean);
const origins = [...new Set(configuredOrigins)];
const observedRepository = origins.length === 1 ? origins[0] : null;
const observedBranch = text(status.current);
const observedHead = text(head.hash).toLowerCase();
const suppliedRepository = normalizeRepository(requestContext.runtime?.repository);
const suppliedBranch = text(requestContext.runtime?.branch_name);
const suppliedHead = text(requestContext.runtime?.head_sha).toLowerCase();
const violationCodes = [...(Array.isArray(requestContext.request?.consumer_violation_codes) ? requestContext.request.consumer_violation_codes : [])];
if (!observedRepository) violationCodes.push('GIT_ORIGIN_ATTESTATION_UNAVAILABLE');
else if (observedRepository !== profile.repository || (suppliedRepository && suppliedRepository !== observedRepository)) violationCodes.push('GIT_REPOSITORY_ATTESTATION_MISMATCH');
if (!observedBranch) violationCodes.push('GIT_BRANCH_ATTESTATION_UNAVAILABLE');
else if (suppliedBranch !== observedBranch) violationCodes.push('GIT_BRANCH_ATTESTATION_MISMATCH');
if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(observedHead)) violationCodes.push('GIT_HEAD_ATTESTATION_UNAVAILABLE');
else if (suppliedHead !== observedHead) violationCodes.push('GIT_HEAD_ATTESTATION_MISMATCH');
return [{
  json: {
    request: { ...requestContext.request, consumer_violation_codes: [...new Set(violationCodes)] },
    runtime: {
      ...requestContext.runtime,
      repository: observedRepository || '',
      branch_name: observedBranch,
      head_sha: observedHead,
    },
  },
}];`;
}

function routeNames(profile, index) {
  if (index === 0) {
    return {
      webhook: 'Authorized Build-Start Request',
      normalizer: 'Normalize Authorization Request',
      pathGuard: 'Validate Governed Repository Path',
      gitStatus: 'Observe Governed Git Status',
      gitHead: 'Observe Governed Git HEAD',
      gitOrigin: 'Observe Governed Git Origin',
      attestor: 'Attest Governed Git State',
    };
  }
  return {
    webhook: `Consumer Build-Start Request [${profile.id}]`,
    normalizer: `Normalize Consumer Request [${profile.id}]`,
    pathGuard: `Validate Repository Path [${profile.id}]`,
    gitStatus: `Observe Git Status [${profile.id}]`,
    gitHead: `Observe Git HEAD [${profile.id}]`,
    gitOrigin: `Observe Git Origin [${profile.id}]`,
    attestor: `Attest Git State [${profile.id}]`,
  };
}

function codeNode({ id, name, position, jsCode, mode = 'runOnceForAllItems' }) {
  return {
    id,
    name,
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    onError: 'continueErrorOutput',
    position,
    parameters: { mode, jsCode },
  };
}

function gitNode({ id, name, position, operation, repositoryPath, extraParameters = {} }) {
  return {
    id,
    name,
    type: 'n8n-nodes-base.git',
    typeVersion: 1.1,
    onError: 'continueErrorOutput',
    position,
    parameters: {
      operation,
      repositoryPath,
      ...extraParameters,
      options: {},
    },
  };
}

export function addConsumerProfileRoutes(sourceWorkflow, profiles = GOVERNANCE_CONSUMER_PROFILES) {
  assert.deepEqual(validateConsumerProfiles(profiles), [], 'Governance consumer profiles must be valid before workflow generation');

  const workflow = structuredClone(sourceWorkflow);
  const webhookTemplate = workflowNode(workflow, 'Authorized Build-Start Request');
  const normalizerTemplate = workflowNode(workflow, 'Normalize Authorization Request');
  const contextNode = structuredClone(normalizerTemplate);
  contextNode.id = 'authorization-request-context-ai99';
  contextNode.name = AUTHORIZATION_REQUEST_CONTEXT_NODE;
  contextNode.parameters.jsCode = 'return { json: $json };';
  contextNode.position = [normalizerTemplate.position[0] + 240, normalizerTemplate.position[1] + ((profiles.length - 1) * 160)];
  delete contextNode.credentials;

  profiles.forEach((profile, index) => {
    const names = routeNames(profile, index);
    const webhook = index === 0 ? webhookTemplate : structuredClone(webhookTemplate);
    const normalizer = index === 0 ? normalizerTemplate : structuredClone(normalizerTemplate);
    const row = webhookTemplate.position[1] + (index * 480);

    webhook.id = index === 0 ? webhookTemplate.id : `webhook-${profile.id}`;
    webhook.name = names.webhook;
    webhook.webhookId = index === 0 ? 'f3fdd5c1-cc2a-47e1-95d0-bf0bd6829a95' : deterministicWebhookId(profile.id);
    webhook.parameters.path = profile.webhook_path;
    webhook.position = [webhookTemplate.position[0], row];

    normalizer.id = index === 0 ? normalizerTemplate.id : `normalize-${profile.id}`;
    normalizer.name = names.normalizer;
    normalizer.parameters.jsCode = consumerNormalizerCode(profile);
    normalizer.position = [normalizerTemplate.position[0], row];

    const pathGuard = codeNode({
      id: `validate-repository-path-${profile.id}`,
      name: names.pathGuard,
      position: [normalizer.position[0] + 220, row],
      jsCode: consumerRepositoryPathGuardCode(profile),
      mode: 'runOnceForEachItem',
    });
    const repositoryPath = `={{ $('${names.pathGuard}').first().json.runtime.repository_path }}`;
    const gitStatus = gitNode({ id: `observe-git-status-${profile.id}`, name: names.gitStatus, position: [normalizer.position[0] + 440, row], operation: 'status', repositoryPath });
    const gitHead = gitNode({ id: `observe-git-head-${profile.id}`, name: names.gitHead, position: [normalizer.position[0] + 660, row], operation: 'log', repositoryPath, extraParameters: { returnAll: false, limit: 1 } });
    const gitOrigin = gitNode({ id: `observe-git-origin-${profile.id}`, name: names.gitOrigin, position: [normalizer.position[0] + 880, row], operation: 'listConfig', repositoryPath });
    const attestor = codeNode({ id: `attest-git-state-${profile.id}`, name: names.attestor, position: [normalizer.position[0] + 1100, row], jsCode: consumerGitAttestorCode(profile, names) });

    if (index > 0) {
      delete webhook.credentials;
      delete normalizer.credentials;
      workflow.nodes.push(webhook, normalizer);
    }
    workflow.nodes.push(pathGuard, gitStatus, gitHead, gitOrigin, attestor);

    workflow.connections[webhook.name] = {
      main: [[{ node: normalizer.name, type: 'main', index: 0 }]],
    };
    workflow.connections[normalizer.name] = {
      main: [
        [{ node: pathGuard.name, type: 'main', index: 0 }],
        [{ node: 'Respond Controller Error', type: 'main', index: 0 }],
      ],
    };
    // Header authentication remains on the consumer webhook. GitHub owns PR
    // identity; local builds must still independently attest their Git state.
    // Both paths continue through fresh Linear validation and the baseline gate.
    if (profile.actions.includes('pr_merge_gate')) {
      const mergeRouter = {
        id: `select-merge-evidence-${profile.id}`,
        name: `GitHub Merge Request [${profile.id}]`,
        type: 'n8n-nodes-base.if',
        typeVersion: 2.2,
        position: [normalizer.position[0] + 100, row - 180],
        parameters: {
          conditions: {
            options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
            conditions: [{
              id: `merge-action-${profile.id}`,
              leftValue: '={{ $json.request.permitted_action }}',
              rightValue: 'pr_merge_gate',
              operator: { type: 'string', operation: 'equals' },
            }],
            combinator: 'and',
          },
          options: {},
        },
      };
      workflow.nodes.push(mergeRouter);
      workflow.connections[normalizer.name].main[0] = [{ node: mergeRouter.name, type: 'main', index: 0 }];
      workflow.connections[mergeRouter.name] = {
        main: [
          [{ node: contextNode.name, type: 'main', index: 0 }],
          [{ node: pathGuard.name, type: 'main', index: 0 }],
        ],
      };
    }
    for (const [source, target] of [[pathGuard, gitStatus], [gitStatus, gitHead], [gitHead, gitOrigin], [gitOrigin, attestor]]) {
      workflow.connections[source.name] = {
        main: [
          [{ node: target.name, type: 'main', index: 0 }],
          [{ node: 'Respond Controller Error', type: 'main', index: 0 }],
        ],
      };
    }
    workflow.connections[attestor.name] = {
      main: [
        [{ node: contextNode.name, type: 'main', index: 0 }],
        [{ node: 'Respond Controller Error', type: 'main', index: 0 }],
      ],
    };
  });

  workflow.nodes.push(contextNode);
  workflow.connections[contextNode.name] = {
    main: [
      [{ node: 'Request Has Task ID', type: 'main', index: 0 }],
      [{ node: 'Respond Controller Error', type: 'main', index: 0 }],
    ],
  };

  workflow.meta = {
    ...workflow.meta,
    governanceConsumerProfileSchemaVersion: GOVERNANCE_CONSUMER_PROFILE_SCHEMA_VERSION,
    governanceConsumerProfilesSha256: createHash('sha256').update(serializedConsumerProfiles(profiles)).digest('hex'),
  };

  return workflow;
}
