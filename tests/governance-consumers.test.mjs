import assert from 'node:assert/strict';
import test from 'node:test';

import {
  GOVERNANCE_CONSUMER_PROFILES,
  normalizeConsumerRepository,
  resolveConsumerProfile,
  validateConsumerProfiles,
} from '../server/governance-consumers.mjs';

const request = Object.freeze({
  consumerId: 'aispanda-governance',
  repository: 'github.com/aispanda/aispanda-governance',
  action: 'local_build_start',
  caller: 'codex',
  governancePolicyVersion: 'governance-policy-v1.1',
  storyContractVersion: 'story-contract-v2',
});

test('the approved consumer registry is exact, versioned, and free of duplicates', () => {
  assert.deepEqual(validateConsumerProfiles(), []);
  assert.deepEqual(
    GOVERNANCE_CONSUMER_PROFILES.map(({ id, webhook_path, repository }) => ({ id, webhook_path, repository })),
    [
      { id: 'aispanda-web', webhook_path: 'authorize-build-start-ai95-candidate', repository: 'github.com/aispanda/aispanda-web' },
      { id: 'aispanda-governance', webhook_path: 'authorize-build-start-ai99-governance-candidate', repository: 'github.com/aispanda/aispanda-governance' },
    ],
  );
});

test('approved GitHub repository spellings normalize to one exact identity', () => {
  for (const value of [
    'github.com/aispanda/aispanda-governance',
    'https://github.com/aispanda/aispanda-governance.git',
    'git@github.com:aispanda/aispanda-governance.git',
    'ssh://git@github.com/aispanda/aispanda-governance.git',
  ]) {
    assert.equal(normalizeConsumerRepository(value), request.repository);
  }
});

test('the website and governance repositories resolve only through trusted profiles', () => {
  assert.equal(resolveConsumerProfile(request).approved, true);
  assert.equal(resolveConsumerProfile({
    ...request,
    consumerId: 'aispanda-web',
    repository: 'https://github.com/aispanda/aispanda-web.git',
    action: 'pr_merge_gate',
    caller: 'github-actions',
  }).approved, true);
});

test('the governance consumer cannot broaden its approved action, caller, or versions', () => {
  assert.deepEqual(resolveConsumerProfile({ ...request, action: 'pr_merge_gate' }).violation_codes, ['ACTION_NOT_APPROVED']);
  assert.deepEqual(resolveConsumerProfile({ ...request, caller: 'github-actions' }).violation_codes, ['CALLER_NOT_APPROVED']);
  assert.deepEqual(resolveConsumerProfile({ ...request, governancePolicyVersion: 'governance-policy-v2' }).violation_codes, ['POLICY_VERSION_MISMATCH']);
  assert.deepEqual(resolveConsumerProfile({ ...request, storyContractVersion: 'story-contract-v3' }).violation_codes, ['SYNTAX_VERSION_MISMATCH']);
});

test('lookalikes, wildcards, encoded paths, and non-GitHub hosts fail closed', () => {
  const invalid = [
    'github.com/aispanda/aispanda-governance-evil',
    'github.com/aispanda/aispanda-governance/extra',
    'github.com/aispanda/*',
    'github.com/aispanda/aispanda-governance%2fevil',
    'github.com/aispanda/aispanda‑governance',
    'https://github.example/aispanda/aispanda-governance',
    'https://github.com.evil.example/aispanda/aispanda-governance',
    'https://github.com:8443/aispanda/aispanda-governance',
    'https://user@github.com/aispanda/aispanda-governance',
    'github.com/AISpanda/aispanda-governance',
  ];
  for (const repository of invalid) {
    const result = resolveConsumerProfile({ ...request, repository });
    assert.equal(result.approved, false, repository);
    assert.ok(
      result.violation_codes.includes('INVALID_REPOSITORY_IDENTITY') || result.violation_codes.includes('CONSUMER_REPOSITORY_MISMATCH'),
      `${repository}: ${result.violation_codes.join(',')}`,
    );
  }
});

test('an unregistered repository cannot register itself through request data', () => {
  const result = resolveConsumerProfile({
    ...request,
    consumerId: 'self-registered',
    repository: 'github.com/example/self-registered',
    consumer_profiles: [{ repository: 'github.com/example/self-registered' }],
  });
  assert.deepEqual(result.violation_codes, ['CONSUMER_NOT_APPROVED']);
});

test('a fictional second consumer proves portable isolation only when test configuration supplies it', () => {
  const fictional = Object.freeze({
    id: 'example-synthetic',
    webhook_path: 'authorize-build-start-example-synthetic',
    repository: 'github.com/example/governance-synthetic',
    actions: Object.freeze(['local_build_start']),
    callers: Object.freeze(['fixture-runner']),
    governance_policy_version: 'governance-policy-v1.1',
    story_contract_version: 'story-contract-v2',
  });
  const fictionalRequest = {
    ...request,
    consumerId: fictional.id,
    repository: fictional.repository,
    caller: 'fixture-runner',
  };
  assert.deepEqual(resolveConsumerProfile(fictionalRequest).violation_codes, ['CONSUMER_NOT_APPROVED']);
  assert.equal(resolveConsumerProfile(fictionalRequest, [...GOVERNANCE_CONSUMER_PROFILES, fictional]).approved, true);
  assert.equal(GOVERNANCE_CONSUMER_PROFILES.some((profile) => profile.repository === fictional.repository), false);
});

test('invalid, duplicate, or secret-bearing profiles invalidate the registry', () => {
  const duplicate = [...GOVERNANCE_CONSUMER_PROFILES, GOVERNANCE_CONSUMER_PROFILES[0]];
  assert.ok(validateConsumerProfiles(duplicate).includes('CONSUMER_PROFILE_DUPLICATE'));
  assert.ok(validateConsumerProfiles(duplicate).includes('CONSUMER_REPOSITORY_DUPLICATE'));
  assert.ok(validateConsumerProfiles(duplicate).includes('CONSUMER_WEBHOOK_DUPLICATE'));

  const secretBearing = {
    ...GOVERNANCE_CONSUMER_PROFILES[1],
    credential: 'never-store-a-secret-here',
  };
  assert.ok(validateConsumerProfiles([secretBearing]).includes('CONSUMER_PROFILE_INVALID'));

  const duplicateAction = {
    ...GOVERNANCE_CONSUMER_PROFILES[1],
    actions: ['local_build_start', 'local_build_start'],
  };
  assert.ok(validateConsumerProfiles([duplicateAction]).includes('CONSUMER_PROFILE_INVALID'));
});

test('a trusted route profile cannot be replaced by cross-profile request claims', () => {
  const governanceRouteClaimingWeb = resolveConsumerProfile({
    ...request,
    repository: 'github.com/aispanda/aispanda-web',
    action: 'pr_merge_gate',
    caller: 'github-actions',
  });
  assert.equal(governanceRouteClaimingWeb.approved, false);
  assert.deepEqual(
    governanceRouteClaimingWeb.violation_codes,
    ['CONSUMER_REPOSITORY_MISMATCH', 'ACTION_NOT_APPROVED', 'CALLER_NOT_APPROVED'],
  );

  const webRouteClaimingGovernance = resolveConsumerProfile({
    ...request,
    consumerId: 'aispanda-web',
  });
  assert.deepEqual(webRouteClaimingGovernance.violation_codes, ['CONSUMER_REPOSITORY_MISMATCH']);
});
