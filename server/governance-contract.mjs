import { createHash } from 'node:crypto';

export const GOVERNANCE_POLICY_VERSION = 'governance-policy-v1.1';
export const STORY_CONTRACT_VERSION = 'story-contract-v2';

export const REQUIRED_SECTIONS = Object.freeze([
  'User story',
  'Required change',
  'Acceptance criteria',
  'Deployment',
]);

export const OPTIONAL_SECTIONS = Object.freeze([
  'Non-goals',
  'Execution constraints',
  'Links',
]);

export const SECTION_ORDER = Object.freeze([
  'User story',
  'Required change',
  'Acceptance criteria',
  'Non-goals',
  'Execution constraints',
  'Deployment',
  'Links',
]);

export const BLOCKING_LABELS = Object.freeze([
  'NEEDS_PRODUCT_DECISION',
  'NEEDS_TECHNICAL_INPUT',
]);

export const PERMITTED_ACTIONS = Object.freeze([
  'local_build_start',
  'pr_merge_gate',
]);

const LEGACY_HEADINGS = new Set(['Change', 'Done when', 'Evidence', 'Boundaries']);
const DEFAULT_BRANCHES = new Set(['main', 'master', 'develop', 'development', 'trunk']);
const CONTRACT_COMPLETENESS_CODES = new Set([
  'ISSUE_NOT_FOUND',
  'LINEAR_QUERY_FAILED',
  'MISSING_PROPERTY',
  'INVALID_ISSUE_IDENTIFIER',
  'INVALID_LINEAR_REVISION',
  'CONTENT_OUTSIDE_SECTIONS',
  'MISSING_SECTION',
  'EMPTY_SECTION',
  'EMPTY_OPTIONAL_SECTION',
  'DUPLICATE_SECTION',
  'INVALID_HEADING_LEVEL',
  'INVALID_SECTION_ORDER',
  'UNSUPPORTED_SECTION',
  'LEGACY_CONTRACT',
  'PLACEHOLDER_PRESENT',
  'MISSING_ACCEPTANCE_CRITERIA',
  'INVALID_ACCEPTANCE_CRITERION',
  'DUPLICATE_ACCEPTANCE_CRITERION',
  'NONSEQUENTIAL_ACCEPTANCE_CRITERIA',
  'MISSING_VERIFICATION',
  'ORPHAN_VERIFICATION',
  'UNEXPECTED_ACCEPTANCE_CONTENT',
  'INVALID_DEPLOYMENT',
]);
const GOVERNANCE_CODES = new Set([
  'DECISION_BLOCKER',
  'STATUS_NOT_BUILDABLE',
  'STATUS_NOT_ACTIONABLE',
  'MISSING_POLICY_VERSION',
  'MISSING_SYNTAX_VERSION',
  'POLICY_VERSION_MISMATCH',
  'SYNTAX_VERSION_MISMATCH',
]);
const RUNTIME_CODES = new Set([
  'MISSING_EXPECTED_TASK_ID',
  'INVALID_EXPECTED_TASK_ID',
  'MISSING_EXPECTED_REPOSITORY',
  'INVALID_EXPECTED_REPOSITORY',
  'MISSING_RUNTIME_FIELD',
  'DETACHED_HEAD',
  'DEFAULT_BRANCH',
  'BRANCH_TASK_MISMATCH',
  'TASK_ID_MISMATCH',
  'INVALID_REPOSITORY',
  'REPOSITORY_MISMATCH',
  'INVALID_HEAD_SHA',
  'UNSUPPORTED_ACTION',
  'INVALID_OPERATION_ID',
  'INVALID_BRANCH_FORMAT',
  'MISSING_LINEAR_BRANCH',
  'LINEAR_BRANCH_TASK_MISMATCH',
]);

function violation(code, field, message) {
  return { code, field, message };
}

function normalizedText(value) {
  return typeof value === 'string' ? value.replace(/\r\n?/g, '\n').trim() : '';
}

function valueName(value) {
  if (value && typeof value === 'object') return value.name ?? value.label ?? value.value ?? null;
  return value;
}

function labelsFrom(issue) {
  const labels = issue?.labels?.nodes ?? issue?.labels ?? [];
  if (!Array.isArray(labels)) return [];
  return labels
    .map((label) => valueName(label))
    .filter((label) => typeof label === 'string' && label.trim())
    .map((label) => label.trim());
}

function issueField(issue, field) {
  switch (field) {
    case 'identifier': return normalizedText(issue?.identifier ?? issue?.task_id);
    case 'title': return normalizedText(issue?.title);
    case 'team': return normalizedText(valueName(issue?.team));
    case 'project': return normalizedText(valueName(issue?.project));
    case 'priority': {
      const priority = valueName(issue?.priorityLabel ?? issue?.priority);
      if (priority === 0 || normalizedText(String(priority ?? '')).toLowerCase() === 'no priority') return '';
      return normalizedText(String(priority ?? ''));
    }
    case 'status': return normalizedText(valueName(issue?.status ?? issue?.state));
    case 'source_url': return normalizedText(issue?.source_url ?? issue?.url);
    case 'updated_at': return normalizedText(issue?.updated_at ?? issue?.updatedAt);
    case 'linear_branch_name': return normalizedText(issue?.linear_branch_name ?? issue?.branchName);
    default: return '';
  }
}

function parseSections(description) {
  const lines = normalizedText(description).split('\n');
  const headings = [];

  lines.forEach((line, index) => {
    const match = line.match(/^(#{1,6})\s+(.+?)\s*$/);
    if (match) headings.push({ level: match[1].length, name: match[2].trim(), line: index });
  });

  const sections = new Map();
  headings.forEach((heading, index) => {
    const end = headings[index + 1]?.line ?? lines.length;
    const content = lines.slice(heading.line + 1, end).join('\n').trim();
    const entries = sections.get(heading.name) ?? [];
    entries.push({ ...heading, content });
    sections.set(heading.name, entries);
  });
  const firstHeadingLine = headings[0]?.line ?? lines.length;
  const preamble = lines.slice(0, firstHeadingLine).join('\n').trim();
  return { headings, sections, preamble };
}

function hasTemplatePlaceholder(text) {
  if (/\b(?:TBD|TODO|TO[- ]?BE[- ]?DECIDED)\b|\?\?\?/i.test(text)) return true;
  if (/<target>/i.test(text)) return true;
  if (/\[(?:real user|accountable operational role|observable|current behaviour|required behaviour|essential invariant|one atomic|specific automated|canonical requirement|include only|use exactly)/i.test(text)) return true;
  return /\[[^\]\n]+\](?!\s*\()/.test(text);
}

function validateAcceptanceCriteria(content) {
  const violations = [];
  const lines = normalizedText(content).split('\n').map((line) => line.trim()).filter(Boolean);
  const criteria = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const match = line.match(/^AC-(\d+):\s+(.+)$/);
    if (!match) {
      if (/^AC-/i.test(line)) {
        violations.push(violation('INVALID_ACCEPTANCE_CRITERION', 'acceptance_criteria', `Invalid acceptance-criterion line: ${line}`));
      } else if (/^Verify with:/i.test(line)) {
        violations.push(violation('ORPHAN_VERIFICATION', 'acceptance_criteria', 'Verify with must immediately follow its AC-N criterion.'));
      } else if (!/^Record every criterion as PASS, FAIL, or UNPROVEN\./.test(line)) {
        violations.push(violation('UNEXPECTED_ACCEPTANCE_CONTENT', 'acceptance_criteria', `Unexpected acceptance-criteria content: ${line}`));
      }
      continue;
    }

    const number = Number(match[1]);
    const criterion = { number, outcome: match[2], evidence: null };
    criteria.push(criterion);
    const verify = (lines[index + 1] ?? '').match(/^Verify with:\s+(.+)$/);
    if (!verify) {
      violations.push(violation('MISSING_VERIFICATION', `AC-${number}`, `AC-${number} must be followed by its own Verify with line.`));
      continue;
    }
    criterion.evidence = verify[1];
    index += 1;
  }

  if (criteria.length === 0) {
    violations.push(violation('MISSING_ACCEPTANCE_CRITERIA', 'acceptance_criteria', 'At least one AC-N criterion is required.'));
  }

  const seen = new Set();
  criteria.forEach((criterion, index) => {
    if (seen.has(criterion.number)) {
      violations.push(violation('DUPLICATE_ACCEPTANCE_CRITERION', `AC-${criterion.number}`, `AC-${criterion.number} is duplicated.`));
    }
    seen.add(criterion.number);
    if (criterion.number !== index + 1) {
      violations.push(violation('NONSEQUENTIAL_ACCEPTANCE_CRITERIA', `AC-${criterion.number}`, 'Acceptance criteria must be numbered sequentially from AC-1.'));
    }
    if (hasTemplatePlaceholder(criterion.outcome) || hasTemplatePlaceholder(criterion.evidence ?? '')) {
      violations.push(violation('PLACEHOLDER_PRESENT', `AC-${criterion.number}`, `AC-${criterion.number} contains an unresolved placeholder.`));
    }
  });
  return { criteria, violations };
}

export function inspectStoryContract(description) {
  const violations = [];
  const { headings, sections, preamble } = parseSections(description);
  const observed = headings.map((heading) => heading.name);

  if (preamble) {
    violations.push(violation('CONTENT_OUTSIDE_SECTIONS', 'description', 'Content before the first contract section is not allowed.'));
  }

  for (const [name, entries] of sections.entries()) {
    if (entries.length > 1) violations.push(violation('DUPLICATE_SECTION', name, `Section ${name} appears more than once.`));
    if (entries.some((entry) => entry.level !== 3)) {
      violations.push(violation('INVALID_HEADING_LEVEL', name, `Section ${name} must use an exact level-three Markdown heading.`));
    }
    if (!SECTION_ORDER.includes(name)) {
      const code = LEGACY_HEADINGS.has(name) ? 'LEGACY_CONTRACT' : 'UNSUPPORTED_SECTION';
      violations.push(violation(code, name, `Unsupported heading: ${name}.`));
    }
  }

  for (const required of REQUIRED_SECTIONS) {
    const entry = sections.get(required)?.[0];
    if (!entry) violations.push(violation('MISSING_SECTION', required, `Required section ${required} is missing.`));
    else if (!entry.content) violations.push(violation('EMPTY_SECTION', required, `Required section ${required} is empty.`));
  }

  const canonicalObserved = observed.filter((name) => SECTION_ORDER.includes(name));
  const orderIndexes = canonicalObserved.map((name) => SECTION_ORDER.indexOf(name));
  if (orderIndexes.some((value, index) => index > 0 && value <= orderIndexes[index - 1])) {
    violations.push(violation('INVALID_SECTION_ORDER', 'description', 'Canonical sections are not in the required order.'));
  }

  for (const optional of OPTIONAL_SECTIONS) {
    const entry = sections.get(optional)?.[0];
    if (entry && !entry.content) violations.push(violation('EMPTY_OPTIONAL_SECTION', optional, `Optional section ${optional} must be removed when empty.`));
  }

  for (const [name, entries] of sections.entries()) {
    const content = entries[0]?.content ?? '';
    if (hasTemplatePlaceholder(content)) {
      violations.push(violation('PLACEHOLDER_PRESENT', name, `Section ${name} contains an unresolved placeholder.`));
    }
  }

  const acceptance = validateAcceptanceCriteria(sections.get('Acceptance criteria')?.[0]?.content ?? '');
  violations.push(...acceptance.violations);

  const deployment = sections.get('Deployment')?.[0]?.content ?? '';
  if (deployment && deployment !== 'not applicable' && deployment !== 'later' && !/^in scope:[ \t]+\S[^\r\n]*$/.test(deployment)) {
    violations.push(violation('INVALID_DEPLOYMENT', 'Deployment', 'Deployment must be exactly not applicable, later, or in scope: <target>.'));
  }

  return {
    sections: Object.fromEntries([...sections.entries()].map(([name, entries]) => [name, entries[0]?.content ?? ''])),
    acceptance_criteria: acceptance.criteria,
    deployment,
    violations,
  };
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  }
  return value;
}

export function stableJson(value) {
  return JSON.stringify(stableValue(value));
}

export function hashContract(issue) {
  const payload = {
    task_id: normalizedText(issue?.identifier ?? issue?.task_id ?? issue?.id).toUpperCase(),
    title: issueField(issue, 'title'),
    description: normalizedText(issue?.description),
    team: issueField(issue, 'team'),
    project: issueField(issue, 'project'),
    priority: issueField(issue, 'priority'),
    status: issueField(issue, 'status'),
    labels: labelsFrom(issue).sort(),
    source_url: issueField(issue, 'source_url'),
  };
  return createHash('sha256').update(stableJson(payload)).digest('hex');
}

function branchContainsTask(branch, taskId) {
  const escaped = taskId.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[/_.-])${escaped}($|[/_.-])`, 'i').test(branch);
}

export function taskIdFromGovernedBranch(branch) {
  const match = normalizedText(branch).match(/^codex\/([a-z][a-z0-9]*-[0-9]+)-[a-z0-9][a-z0-9._-]*$/i);
  return match ? match[1].toUpperCase() : null;
}

export function normalizeRepository(value) {
  let repository = normalizedText(value).replace(/\\/g, '/');
  const ssh = repository.match(/^git@([^:]+):(.+)$/i);
  if (ssh) repository = `${ssh[1]}/${ssh[2]}`;
  else {
    try {
      const url = new URL(repository);
      repository = `${url.hostname}${url.pathname}`;
    } catch {
      repository = repository.replace(/^ssh:\/\//i, '');
    }
  }
  return repository.replace(/^\/+|\/+$/g, '').replace(/\.git$/i, '').toLowerCase();
}

function isTaskIdentifier(value) {
  return /^[A-Z][A-Z0-9]*-\d+$/.test(normalizedText(value).toUpperCase());
}

function isRepositoryIdentity(value) {
  return /^[a-z0-9.-]+\/[^\s/]+\/[^\s/]+$/i.test(value);
}

export function evaluateTaskContract(issue, runtime = {}, options = {}) {
  const violations = [];
  const queryErrors = Array.isArray(options.query_errors) ? options.query_errors.filter(Boolean).map(String) : [];
  const ok = Boolean(issue) && queryErrors.length === 0;
  if (!issue) violations.push(violation('ISSUE_NOT_FOUND', 'task_id', 'Linear issue was not returned.'));
  if (queryErrors.length > 0) violations.push(violation('LINEAR_QUERY_FAILED', 'linear', 'Linear issue lookup failed.'));

  if (issue) {
    for (const field of ['identifier', 'title', 'team', 'project', 'priority', 'status', 'source_url', 'updated_at']) {
      if (!issueField(issue, field)) violations.push(violation('MISSING_PROPERTY', field, `Required Linear property ${field} is missing.`));
    }
    const updatedAt = issueField(issue, 'updated_at');
    const identifier = issueField(issue, 'identifier');
    if (identifier && !isTaskIdentifier(identifier)) {
      violations.push(violation('INVALID_ISSUE_IDENTIFIER', 'identifier', 'Linear issue identifier must use TEAM-NUMBER syntax.'));
    }
    if (updatedAt && Number.isNaN(Date.parse(updatedAt))) {
      violations.push(violation('INVALID_LINEAR_REVISION', 'updated_at', 'Linear updatedAt must be a valid timestamp.'));
    }
  }

  const contract = inspectStoryContract(issue?.description ?? '');
  violations.push(...contract.violations);

  const labels = labelsFrom(issue);
  const normalizedLabels = new Set(labels.map((label) => label.toUpperCase()));
  for (const blocker of BLOCKING_LABELS) {
    if (normalizedLabels.has(blocker)) violations.push(violation('DECISION_BLOCKER', 'labels', `${blocker} blocks build authorization.`));
  }

  const expectedPolicy = normalizedText(options.expected_policy_version);
  const expectedSyntax = normalizedText(options.expected_story_contract_version);
  if (!expectedPolicy) {
    violations.push(violation('MISSING_POLICY_VERSION', 'governance_policy_version', 'Caller governance policy version is required.'));
  } else if (expectedPolicy !== GOVERNANCE_POLICY_VERSION) {
    violations.push(violation('POLICY_VERSION_MISMATCH', 'governance_policy_version', 'Caller and validator policy versions differ.'));
  }
  if (!expectedSyntax) {
    violations.push(violation('MISSING_SYNTAX_VERSION', 'story_contract_version', 'Caller story contract version is required.'));
  } else if (expectedSyntax !== STORY_CONTRACT_VERSION) {
    violations.push(violation('SYNTAX_VERSION_MISMATCH', 'story_contract_version', 'Caller and validator syntax versions differ.'));
  }

  const status = issueField(issue, 'status');
  if (status && status !== 'Ready' && status !== 'In Progress') {
    violations.push(violation('STATUS_NOT_BUILDABLE', 'status', 'Build start is allowed only from Ready or as a valid In Progress resumption.'));
  }

  const permittedAction = normalizedText(runtime.permitted_action);
  if (permittedAction && !PERMITTED_ACTIONS.includes(permittedAction)) {
    violations.push(violation('UNSUPPORTED_ACTION', 'permitted_action', 'The requested governance action is not supported.'));
  }
  if (status && permittedAction === 'pr_merge_gate' && status !== 'In Progress') {
    violations.push(violation('STATUS_NOT_ACTIONABLE', 'status', 'The pull-request merge gate requires the Linear issue to be In Progress.'));
  }

  const requestedTaskId = normalizedText(options.expected_task_id).toUpperCase();
  const issueTaskId = issueField(issue, 'identifier').toUpperCase();
  const requestedTaskValid = isTaskIdentifier(requestedTaskId);
  if (!requestedTaskId) {
    violations.push(violation('MISSING_EXPECTED_TASK_ID', 'task_id', 'Caller task ID is required.'));
  } else if (!requestedTaskValid) {
    violations.push(violation('INVALID_EXPECTED_TASK_ID', 'task_id', 'Caller task ID must use TEAM-NUMBER syntax.'));
  } else if (issueTaskId && requestedTaskId !== issueTaskId) {
    violations.push(violation('TASK_ID_MISMATCH', 'task_id', `Linear returned ${issueTaskId} for requested task ${requestedTaskId}.`));
  }

  const expectedRepository = normalizeRepository(options.expected_repository);
  const expectedRepositoryValid = isRepositoryIdentity(expectedRepository);
  if (!expectedRepository) {
    violations.push(violation('MISSING_EXPECTED_REPOSITORY', 'repository', 'Governed repository identity is required.'));
  } else if (!expectedRepositoryValid) {
    violations.push(violation('INVALID_EXPECTED_REPOSITORY', 'repository', 'Governed repository identity is invalid.'));
  }

  const requireRuntime = options.require_runtime !== false;
  if (requireRuntime) {
    for (const field of ['branch_name', 'head_sha', 'repository', 'caller', 'permitted_action', 'operation_id']) {
      if (!normalizedText(runtime[field])) violations.push(violation('MISSING_RUNTIME_FIELD', field, `Runtime field ${field} is required.`));
    }

    const branch = normalizedText(runtime.branch_name);
    const taskId = normalizedText(requestedTaskValid ? requestedTaskId : (issue?.identifier ?? issue?.task_id)).toLowerCase();
    if (branch === 'HEAD') violations.push(violation('DETACHED_HEAD', 'branch_name', 'Detached HEAD cannot be authorized.'));
    if (DEFAULT_BRANCHES.has(branch.toLowerCase())) violations.push(violation('DEFAULT_BRANCH', 'branch_name', 'Implementation cannot begin on a default branch.'));
    if (branch && taskId && !branchContainsTask(branch, taskId)) {
      violations.push(violation('BRANCH_TASK_MISMATCH', 'branch_name', `Actual branch is not associated with ${taskId.toUpperCase()}.`));
    }
    if (runtime.head_sha && !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(runtime.head_sha)) {
      violations.push(violation('INVALID_HEAD_SHA', 'head_sha', 'HEAD must be a full 40- or 64-character hexadecimal Git object ID.'));
    }
    if (runtime.operation_id && !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(runtime.operation_id)) {
      violations.push(violation('INVALID_OPERATION_ID', 'operation_id', 'Operation ID must be 8-128 safe identifier characters.'));
    }

    if (permittedAction === 'pr_merge_gate') {
      const branchTaskId = taskIdFromGovernedBranch(branch);
      if (!branchTaskId) {
        violations.push(violation('INVALID_BRANCH_FORMAT', 'branch_name', 'Pull-request branches must use codex/<team>-<number>-<description>.'));
      } else if (requestedTaskValid && branchTaskId !== requestedTaskId) {
        violations.push(violation('BRANCH_TASK_MISMATCH', 'branch_name', `Pull-request branch identifies ${branchTaskId}, not ${requestedTaskId}.`));
      }

      const linearBranchName = issueField(issue, 'linear_branch_name');
      if (!linearBranchName) {
        violations.push(violation('MISSING_LINEAR_BRANCH', 'linear_branch_name', 'Linear did not return its generated branch identity.'));
      } else if (requestedTaskValid && !branchContainsTask(linearBranchName, requestedTaskId)) {
        violations.push(violation('LINEAR_BRANCH_TASK_MISMATCH', 'linear_branch_name', 'Linear generated branch identity does not match the requested task.'));
      }
    }

    const actualRepository = normalizeRepository(runtime.repository);
    if (runtime.repository && !isRepositoryIdentity(actualRepository)) {
      violations.push(violation('INVALID_REPOSITORY', 'repository', 'Actual Git repository identity is invalid.'));
    } else if (expectedRepositoryValid && actualRepository && expectedRepository !== actualRepository) {
      violations.push(violation('REPOSITORY_MISMATCH', 'repository', 'Actual Git repository does not match the governed repository.'));
    }
  }

  const contractComplete = ok && !violations.some((entry) => CONTRACT_COMPLETENESS_CODES.has(entry.code));
  const governanceCompliant = contractComplete && !violations.some((entry) => GOVERNANCE_CODES.has(entry.code));
  const runtimeValid = requireRuntime && !violations.some((entry) => RUNTIME_CODES.has(entry.code));
  const buildAllowed = requireRuntime && ok && violations.length === 0;

  return {
    contract_version: '2.0',
    governance_policy_version: GOVERNANCE_POLICY_VERSION,
    story_contract_version: STORY_CONTRACT_VERSION,
    ok,
    contract_complete: contractComplete,
    governance_compliant: governanceCompliant,
    runtime_valid: runtimeValid,
    build_allowed: buildAllowed,
    task_id: normalizedText(issue?.identifier ?? issue?.task_id ?? issue?.id).toUpperCase() || null,
    title: issueField(issue, 'title') || null,
    status: issueField(issue, 'status') || null,
    branch_name: normalizedText(runtime.branch_name) || null,
    head_sha: normalizedText(runtime.head_sha) || null,
    repository: normalizeRepository(runtime.repository) || null,
    caller: normalizedText(runtime.caller) || null,
    permitted_action: permittedAction || null,
    operation_id: normalizedText(runtime.operation_id) || null,
    contract_hash: issue ? hashContract(issue) : null,
    linear_updated_at: issueField(issue, 'updated_at') || null,
    acceptance_criteria: contract.acceptance_criteria,
    sections: contract.sections,
    deployment: contract.deployment || null,
    legacy_contract: violations.some((entry) => entry.code === 'LEGACY_CONTRACT'),
    query_errors: queryErrors,
    violation_codes: [...new Set(violations.map((entry) => entry.code))],
    violations,
  };
}
