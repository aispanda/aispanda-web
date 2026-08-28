import assert from 'node:assert/strict';
import test from 'node:test';
import {
  authorizationFingerprint,
  createBaselineCandidate,
  evaluateMergeBaseline,
  planBuildStartBaseline,
} from '../server/governance-baseline.mjs';

const now = Date.parse('2026-08-28T16:00:00.000Z');

function decision(patch = {}) {
  return {
    build_allowed: true,
    task_id: 'AI-95',
    repository: 'github.com/aispanda/aispanda-web',
    branch_name: 'codex/ai-95-harden-governed-ai-delivery-path',
    head_sha: 'a'.repeat(40),
    caller: 'codex',
    permitted_action: 'local_build_start',
    governance_policy_version: 'governance-policy-v1.1',
    story_contract_version: 'story-contract-v2',
    linear_updated_at: '2026-08-28T14:27:42.166Z',
    contract_hash: 'b'.repeat(64),
    ...patch,
  };
}

function candidate(operationId = 'local:ai-95:00000001', patch = {}) {
  return createBaselineCandidate(decision(patch), operationId, { now, ttl_ms: 60 * 60 * 1000 });
}

function active(record, id = 'row-a') {
  return { ...record, id, status: 'active' };
}

function mergeFacts(record, patch = {}) {
  return {
    task_id: record.task_id,
    repository: record.repository,
    branch_name: record.branch_name,
    permitted_action: 'pr_merge_gate',
    governance_policy_version: record.governance_policy_version,
    story_contract_version: record.story_contract_version,
    linear_updated_at: record.linear_updated_at,
    contract_hash: record.contract_hash,
    ...patch,
  };
}

test('authorization fingerprint is stable and changes with governed facts', () => {
  const input = decision();
  assert.equal(authorizationFingerprint(input), authorizationFingerprint({ ...input }));
  assert.equal(
    authorizationFingerprint(input),
    authorizationFingerprint({ ...input, repository: 'https://github.com/aispanda/aispanda-web.git' }),
  );
  assert.notEqual(authorizationFingerprint(input), authorizationFingerprint({ ...input, head_sha: 'c'.repeat(40) }));
  assert.notEqual(authorizationFingerprint(input), authorizationFingerprint({ ...input, permitted_action: 'pr_merge_gate' }));
});

test('baseline candidate requires an exact local build-start PASS', () => {
  assert.throws(() => createBaselineCandidate(decision({ build_allowed: false }), 'local:ai-95:00000001'), /exact local_build_start PASS/);
  assert.throws(() => createBaselineCandidate(decision({ permitted_action: 'pr_merge_gate' }), 'local:ai-95:00000001'), /exact local_build_start PASS/);
  assert.throws(() => createBaselineCandidate(decision(), 'bad id'), /valid operation ID/);
});

test('first authorization initializes a pending then active baseline', () => {
  const proposed = candidate();
  const plan = planBuildStartBaseline([], proposed, { now });
  assert.equal(plan.code, 'BASELINE_INITIALIZE');
  assert.deepEqual(plan.steps.map((step) => step.action), ['insert', 'activate']);
  assert.equal(plan.steps[0].record.status, 'pending');
  assert.equal(plan.steps[1].operation_id, proposed.operation_id);
});

test('an exact duplicate reuses its original active result', () => {
  const proposed = candidate();
  const existing = active(proposed);
  const plan = planBuildStartBaseline([existing], proposed, { now });
  assert.equal(plan.code, 'BASELINE_DUPLICATE');
  assert.equal(plan.baseline.id, 'row-a');
  assert.deepEqual(plan.steps, []);
});

test('an expired operation cannot be replayed but a new operation can replace it', () => {
  const proposed = candidate();
  const expired = active({ ...proposed, expires_at: new Date(now - 1).toISOString() });
  const replay = planBuildStartBaseline([expired], proposed, { now });
  assert.equal(replay.allowed, false);
  assert.equal(replay.code, 'BASELINE_EXPIRED');

  const replacement = candidate('local:ai-95:00000002');
  const rollover = planBuildStartBaseline([expired], replacement, { now });
  assert.equal(rollover.code, 'BASELINE_ROLLOVER');
  assert.deepEqual(rollover.steps.map((step) => step.action), ['insert', 'retire', 'activate']);
});

test('reusing an operation ID with different facts fails', () => {
  const existing = active(candidate());
  const conflicting = candidate('local:ai-95:00000001', { head_sha: 'c'.repeat(40) });
  const plan = planBuildStartBaseline([existing], conflicting, { now });
  assert.equal(plan.allowed, false);
  assert.equal(plan.code, 'OPERATION_ID_CONFLICT');
});

test('reusing an operation ID for a different governed scope fails', () => {
  const existing = active(candidate());
  const conflicting = candidate('local:ai-95:00000001', {
    task_id: 'AI-96',
    branch_name: 'codex/ai-96-design-governed-delivery-future-state',
  });
  const plan = planBuildStartBaseline([existing], conflicting, { now });
  assert.equal(plan.allowed, false);
  assert.equal(plan.code, 'OPERATION_ID_CONFLICT');
});

test('equivalent local and GitHub repository identities share one baseline scope', () => {
  const proposed = candidate('local:ai-95:00000002', {
    repository: 'https://github.com/aispanda/aispanda-web.git',
  });
  assert.equal(proposed.repository, 'github.com/aispanda/aispanda-web');

  const existing = active(proposed);
  const merge = evaluateMergeBaseline(
    [existing],
    mergeFacts(existing, { repository: 'git@github.com:aispanda/aispanda-web.git' }),
    { now },
  );
  assert.equal(merge.allowed, true);
  assert.equal(merge.code, 'BASELINE_CURRENT');
});

test('a changed authorization plans pending, retire, then activate rollover', () => {
  const old = active(candidate());
  const replacement = candidate('local:ai-95:00000002', {
    linear_updated_at: '2026-08-28T15:00:00.000Z',
    contract_hash: 'c'.repeat(64),
  });
  const plan = planBuildStartBaseline([old], replacement, { now });
  assert.equal(plan.code, 'BASELINE_ROLLOVER');
  assert.deepEqual(plan.steps.map((step) => step.action), ['insert', 'retire', 'activate']);
  assert.equal(plan.steps[1].row_id, 'row-a');
  assert.equal(plan.steps[2].operation_id, replacement.operation_id);
});

test('a retry resumes an existing pending rollover after revalidation', () => {
  const old = active(candidate());
  const pending = candidate('local:ai-95:00000002', {
    linear_updated_at: '2026-08-28T15:00:00.000Z',
    contract_hash: 'c'.repeat(64),
  });
  const plan = planBuildStartBaseline([old, { ...pending, id: 'row-b' }], pending, { now });
  assert.equal(plan.code, 'BASELINE_ROLLOVER_RESUME');
  assert.deepEqual(plan.steps, [
    { action: 'retire', row_id: 'row-a' },
    { action: 'activate', operation_id: pending.operation_id },
  ]);
});

test('multiple active baselines fail closed', () => {
  const proposed = candidate('local:ai-95:00000003', { head_sha: 'd'.repeat(40) });
  const first = active(candidate(), 'row-a');
  const second = active(candidate('local:ai-95:00000002', { head_sha: 'c'.repeat(40) }), 'row-b');
  const plan = planBuildStartBaseline([first, second], proposed, { now });
  assert.equal(plan.allowed, false);
  assert.equal(plan.code, 'BASELINE_AMBIGUOUS');
});

test('merge gate accepts exactly one current, unexpired baseline', () => {
  const baseline = active(candidate());
  const result = evaluateMergeBaseline([baseline], mergeFacts(baseline), { now });
  assert.equal(result.allowed, true);
  assert.equal(result.code, 'BASELINE_CURRENT');
});

test('changed Linear revision or contract requires replan', () => {
  const baseline = active(candidate());
  const result = evaluateMergeBaseline([baseline], mergeFacts(baseline, {
    linear_updated_at: '2026-08-28T15:00:00.000Z',
    contract_hash: 'c'.repeat(64),
  }), { now });
  assert.equal(result.outcome, 'REPLAN');
  assert.equal(result.code, 'BASELINE_STALE');
  assert.deepEqual(result.changed_fields, ['linear_updated_at', 'contract_hash']);
});

test('missing, ambiguous, expired, and wrong-action baselines fail', () => {
  const baseline = active(candidate());
  const current = mergeFacts(baseline);
  assert.equal(evaluateMergeBaseline([], current, { now }).code, 'BASELINE_MISSING');
  assert.equal(evaluateMergeBaseline([baseline, { ...baseline, id: 'row-b' }], current, { now }).code, 'BASELINE_AMBIGUOUS');
  assert.equal(evaluateMergeBaseline([{ ...baseline, expires_at: new Date(now - 1).toISOString() }], current, { now }).code, 'BASELINE_EXPIRED');
  assert.equal(evaluateMergeBaseline([baseline], { ...current, permitted_action: 'local_build_start' }, { now }).code, 'BASELINE_ACTION_MISMATCH');
});

test('rollover has no transient false-PASS window', () => {
  const old = active(candidate());
  const pending = candidate('local:ai-95:00000002', {
    linear_updated_at: '2026-08-28T15:00:00.000Z',
    contract_hash: 'c'.repeat(64),
  });
  const current = mergeFacts(pending);

  const prepared = evaluateMergeBaseline([old, { ...pending, id: 'row-b' }], current, { now });
  assert.equal(prepared.code, 'BASELINE_STALE');
  assert.equal(prepared.allowed, false);

  const retired = evaluateMergeBaseline([{ ...old, status: 'retired' }, { ...pending, id: 'row-b' }], current, { now });
  assert.equal(retired.code, 'BASELINE_MISSING');
  assert.equal(retired.allowed, false);

  const activated = evaluateMergeBaseline([{ ...old, status: 'retired' }, active(pending, 'row-b')], current, { now });
  assert.equal(activated.code, 'BASELINE_CURRENT');
  assert.equal(activated.allowed, true);

  const invalidDoubleActive = evaluateMergeBaseline([old, active(pending, 'row-b')], current, { now });
  assert.equal(invalidDoubleActive.code, 'BASELINE_AMBIGUOUS');
  assert.equal(invalidDoubleActive.allowed, false);
});
