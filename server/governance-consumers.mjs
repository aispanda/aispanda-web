import { GOVERNANCE_POLICY_VERSION, STORY_CONTRACT_VERSION } from './governance-contract.mjs';

const PROFILE_KEYS = Object.freeze([
  'id',
  'webhook_path',
  'repository',
  'actions',
  'callers',
  'governance_policy_version',
  'story_contract_version',
]);

const REPOSITORY_SEGMENT = /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/;

export const GOVERNANCE_CONSUMER_PROFILES = Object.freeze([
  Object.freeze({
    id: 'aispanda-web',
    webhook_path: 'authorize-build-start-ai95-candidate',
    repository: 'github.com/aispanda/aispanda-web',
    actions: Object.freeze(['local_build_start', 'pr_merge_gate']),
    callers: null,
    governance_policy_version: GOVERNANCE_POLICY_VERSION,
    story_contract_version: STORY_CONTRACT_VERSION,
  }),
  Object.freeze({
    id: 'aispanda-governance',
    webhook_path: 'authorize-build-start-ai99-governance-candidate',
    repository: 'github.com/aispanda/aispanda-governance',
    actions: Object.freeze(['local_build_start']),
    callers: Object.freeze(['codex']),
    governance_policy_version: GOVERNANCE_POLICY_VERSION,
    story_contract_version: STORY_CONTRACT_VERSION,
  }),
]);

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function normalizeConsumerRepository(value) {
  const supplied = text(value);
  if (!supplied || /[\\\s*?\[\]{}]/u.test(supplied) || /%[0-9a-f]{2}/i.test(supplied)) return null;

  let host = '';
  let path = '';
  const scp = supplied.match(/^git@([^:]+):(.+)$/);
  if (scp) {
    host = scp[1];
    path = scp[2];
  } else if (/^[a-z][a-z0-9+.-]*:\/\//i.test(supplied)) {
    let url;
    try {
      url = new URL(supplied);
    } catch {
      return null;
    }
    if (!['https:', 'ssh:'].includes(url.protocol) || url.password || url.port || url.search || url.hash) return null;
    if (url.username && !(url.protocol === 'ssh:' && url.username === 'git')) return null;
    host = url.hostname;
    path = url.pathname;
  } else {
    const parts = supplied.split('/');
    host = parts.shift() ?? '';
    path = parts.join('/');
  }

  host = host.toLowerCase();
  path = path.replace(/^\/+|\/+$/g, '');
  if (path.endsWith('.git')) path = path.slice(0, -4);
  const parts = path.split('/');
  if (host !== 'github.com' || parts.length !== 2) return null;
  if (parts.some((part) => !REPOSITORY_SEGMENT.test(part))) return null;
  return `${host}/${parts.join('/')}`;
}

export function validateConsumerProfiles(profiles = GOVERNANCE_CONSUMER_PROFILES) {
  const violations = [];
  const ids = new Set();
  const webhookPaths = new Set();
  const repositories = new Set();

  for (const profile of profiles) {
    if (!profile || typeof profile !== 'object' || Array.isArray(profile)) {
      violations.push('CONSUMER_PROFILE_INVALID');
      continue;
    }
    if (Object.keys(profile).sort().join('|') !== [...PROFILE_KEYS].sort().join('|')) violations.push('CONSUMER_PROFILE_INVALID');
    if (!/^[a-z0-9][a-z0-9-]{2,63}$/.test(text(profile.id))) violations.push('CONSUMER_PROFILE_INVALID');
    if (ids.has(profile.id)) violations.push('CONSUMER_PROFILE_DUPLICATE');
    ids.add(profile.id);

    if (!/^[a-z0-9][a-z0-9-]{7,127}$/.test(text(profile.webhook_path))) violations.push('CONSUMER_PROFILE_INVALID');
    if (webhookPaths.has(profile.webhook_path)) violations.push('CONSUMER_WEBHOOK_DUPLICATE');
    webhookPaths.add(profile.webhook_path);

    const repository = normalizeConsumerRepository(profile.repository);
    if (!repository || repository !== profile.repository) violations.push('CONSUMER_PROFILE_INVALID');
    if (repositories.has(repository)) violations.push('CONSUMER_REPOSITORY_DUPLICATE');
    repositories.add(repository);

    if (!Array.isArray(profile.actions) || profile.actions.length === 0 || new Set(profile.actions).size !== profile.actions.length || profile.actions.some((action) => !['local_build_start', 'pr_merge_gate'].includes(action))) {
      violations.push('CONSUMER_PROFILE_INVALID');
    }
    if (profile.callers !== null && (!Array.isArray(profile.callers) || profile.callers.length !== 1 || profile.callers.some((caller) => !/^[a-z0-9][a-z0-9._:-]{2,63}$/i.test(caller)))) {
      violations.push('CONSUMER_PROFILE_INVALID');
    }
    if (profile.governance_policy_version !== GOVERNANCE_POLICY_VERSION) violations.push('POLICY_VERSION_MISMATCH');
    if (profile.story_contract_version !== STORY_CONTRACT_VERSION) violations.push('SYNTAX_VERSION_MISMATCH');
  }

  return [...new Set(violations)];
}

export function resolveConsumerProfile({
  consumerId,
  repository,
  action,
  caller,
  governancePolicyVersion,
  storyContractVersion,
}, profiles = GOVERNANCE_CONSUMER_PROFILES) {
  const profileViolations = validateConsumerProfiles(profiles);
  if (profileViolations.length) return { approved: false, repository: null, profile: null, violation_codes: profileViolations };

  const profile = profiles.find((candidate) => candidate.id === text(consumerId)) ?? null;
  if (!profile) return { approved: false, repository: null, profile: null, violation_codes: ['CONSUMER_NOT_APPROVED'] };
  const normalizedRepository = normalizeConsumerRepository(repository);
  if (!normalizedRepository) return { approved: false, repository: null, profile, violation_codes: ['INVALID_REPOSITORY_IDENTITY'] };

  const violations = [];
  if (normalizedRepository !== profile.repository) violations.push('CONSUMER_REPOSITORY_MISMATCH');
  if (!profile.actions.includes(text(action))) violations.push('ACTION_NOT_APPROVED');
  if (profile.callers !== null && !profile.callers.includes(text(caller))) violations.push('CALLER_NOT_APPROVED');
  if (text(governancePolicyVersion) !== profile.governance_policy_version) violations.push('POLICY_VERSION_MISMATCH');
  if (text(storyContractVersion) !== profile.story_contract_version) violations.push('SYNTAX_VERSION_MISMATCH');
  return {
    approved: violations.length === 0,
    repository: profile.repository,
    profile,
    violation_codes: violations,
  };
}

export function serializedConsumerProfiles(profiles = GOVERNANCE_CONSUMER_PROFILES) {
  const violations = validateConsumerProfiles(profiles);
  if (violations.length) throw new Error(`Invalid governance consumer profiles: ${violations.join(', ')}`);
  return JSON.stringify(profiles);
}
