import { createHash } from 'node:crypto';
import { normalizeRepository, stableJson } from './governance-contract.mjs';

export const BASELINE_TTL_MS = 24 * 60 * 60 * 1000;
export const BASELINE_STATUSES = Object.freeze(['pending', 'active', 'retired']);

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function upper(value) {
  return text(value).toUpperCase();
}

function time(value) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function sameScope(left, right) {
  return upper(left.task_id) === upper(right.task_id)
    && normalizeRepository(left.repository) === normalizeRepository(right.repository)
    && text(left.branch_name) === text(right.branch_name);
}

function isExpired(record, now) {
  const expiresAt = time(record.expires_at);
  return expiresAt === null || expiresAt <= now;
}

function fail(code, message) {
  return { outcome: 'FAIL', allowed: false, code, message };
}

export function authorizationFingerprint(input) {
  const payload = {
    task_id: upper(input.task_id),
    repository: normalizeRepository(input.repository),
    branch_name: text(input.branch_name),
    head_sha: text(input.head_sha).toLowerCase(),
    caller: text(input.caller),
    permitted_action: text(input.permitted_action),
    governance_policy_version: text(input.governance_policy_version),
    story_contract_version: text(input.story_contract_version),
    linear_updated_at: text(input.linear_updated_at),
    contract_hash: text(input.contract_hash).toLowerCase(),
  };
  return createHash('sha256').update(stableJson(payload)).digest('hex');
}

export function createBaselineCandidate(decision, operationId, options = {}) {
  if (decision?.build_allowed !== true || decision?.permitted_action !== 'local_build_start') {
    throw new TypeError('A baseline candidate requires an exact local_build_start PASS.');
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(text(operationId))) {
    throw new TypeError('A valid operation ID is required.');
  }

  const now = options.now ?? Date.now();
  const ttlMs = options.ttl_ms ?? BASELINE_TTL_MS;
  if (!Number.isSafeInteger(now) || !Number.isSafeInteger(ttlMs) || ttlMs <= 0) {
    throw new TypeError('Baseline time and TTL must be positive safe integers.');
  }

  const candidate = {
    operation_id: text(operationId),
    task_id: upper(decision.task_id),
    repository: normalizeRepository(decision.repository),
    branch_name: text(decision.branch_name),
    head_sha: text(decision.head_sha).toLowerCase(),
    caller: text(decision.caller),
    permitted_action: 'local_build_start',
    governance_policy_version: text(decision.governance_policy_version),
    story_contract_version: text(decision.story_contract_version),
    linear_updated_at: text(decision.linear_updated_at),
    contract_hash: text(decision.contract_hash).toLowerCase(),
    outcome: 'PASS',
    status: 'pending',
    created_at: new Date(now).toISOString(),
    expires_at: new Date(now + ttlMs).toISOString(),
  };
  candidate.request_fingerprint = authorizationFingerprint(candidate);
  return candidate;
}

export function planBuildStartBaseline(records, candidate, options = {}) {
  if (!Array.isArray(records)) throw new TypeError('Baseline records must be an array.');
  if (!candidate || candidate.status !== 'pending') throw new TypeError('A pending baseline candidate is required.');
  const now = options.now ?? Date.now();

  const operations = records.filter((record) => text(record.operation_id) === candidate.operation_id);
  if (operations.length > 1) {
    return fail('BASELINE_OPERATION_AMBIGUOUS', 'The operation ID resolves to multiple baseline records.');
  }
  if (operations.length === 1 && operations[0].request_fingerprint !== candidate.request_fingerprint) {
    return fail('OPERATION_ID_CONFLICT', 'The operation ID was already used with different governed facts.');
  }

  const scoped = records.filter((record) => sameScope(record, candidate));
  const active = scoped.filter((record) => record.status === 'active');
  if (active.length > 1) {
    return fail('BASELINE_AMBIGUOUS', 'Multiple active baselines exist for this task, repository, and branch.');
  }

  if (operations.length === 1) {
    const existing = operations[0];
    if (existing.status === 'active') {
      if (isExpired(existing, now)) return fail('BASELINE_EXPIRED', 'The duplicate operation baseline has expired.');
      return { outcome: 'PASS', allowed: true, code: 'BASELINE_DUPLICATE', mode: 'reuse', baseline: existing, steps: [] };
    }
    if (existing.status === 'retired') {
      return fail('BASELINE_OPERATION_RETIRED', 'A retired operation cannot create a new active baseline.');
    }
    if (isExpired(existing, now)) return fail('BASELINE_PENDING_EXPIRED', 'The pending operation expired before rollover completed.');
    return {
      outcome: 'PASS',
      allowed: true,
      code: 'BASELINE_ROLLOVER_RESUME',
      mode: 'resume',
      baseline: existing,
      steps: [
        ...(active.length === 1 ? [{ action: 'retire', row_id: active[0].id }] : []),
        { action: 'activate', operation_id: candidate.operation_id },
      ],
    };
  }

  return {
    outcome: 'PASS',
    allowed: true,
    code: active.length === 1 ? 'BASELINE_ROLLOVER' : 'BASELINE_INITIALIZE',
    mode: active.length === 1 ? 'rollover' : 'initialize',
    baseline: candidate,
    steps: [
      { action: 'insert', record: candidate },
      ...(active.length === 1 ? [{ action: 'retire', row_id: active[0].id }] : []),
      { action: 'activate', operation_id: candidate.operation_id },
    ],
  };
}

export function evaluateMergeBaseline(records, current, options = {}) {
  if (!Array.isArray(records)) throw new TypeError('Baseline records must be an array.');
  const now = options.now ?? Date.now();
  const scoped = records.filter((record) => sameScope(record, current));
  const active = scoped.filter((record) => record.status === 'active');

  if (active.length === 0) return fail('BASELINE_MISSING', 'No active build-start baseline matches this pull request.');
  if (active.length > 1) return fail('BASELINE_AMBIGUOUS', 'Multiple active baselines match this pull request.');

  const baseline = active[0];
  if (isExpired(baseline, now)) return fail('BASELINE_EXPIRED', 'The matching build-start baseline has expired.');
  if (current.permitted_action !== 'pr_merge_gate' || baseline.permitted_action !== 'local_build_start') {
    return fail('BASELINE_ACTION_MISMATCH', 'The build-start baseline cannot authorize a different action directly.');
  }

  const changed = [];
  if (text(current.head_sha).toLowerCase() !== text(baseline.head_sha).toLowerCase()) changed.push('head_sha');
  if (text(current.linear_updated_at) !== text(baseline.linear_updated_at)) changed.push('linear_updated_at');
  if (text(current.contract_hash).toLowerCase() !== text(baseline.contract_hash).toLowerCase()) changed.push('contract_hash');
  if (text(current.governance_policy_version) !== text(baseline.governance_policy_version)) changed.push('governance_policy_version');
  if (text(current.story_contract_version) !== text(baseline.story_contract_version)) changed.push('story_contract_version');
  if (changed.length > 0) {
    return {
      outcome: 'REPLAN',
      allowed: false,
      code: 'BASELINE_STALE',
      message: 'Current commit, Linear, or governance facts differ from the approved build-start baseline.',
      changed_fields: changed,
      baseline,
    };
  }

  return { outcome: 'PASS', allowed: true, code: 'BASELINE_CURRENT', baseline };
}
