import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  GOVERNANCE_POLICY_VERSION,
  STORY_CONTRACT_VERSION,
  evaluateTaskContract,
  hashContract,
  inspectStoryContract,
} from '../server/governance-contract.mjs';

const fixtureUrl = new URL('./fixtures/governance-contract-v2.json', import.meta.url);
const fixtures = JSON.parse(await readFile(fixtureUrl, 'utf8'));

function merge(base, patch) {
  if (patch === undefined) return structuredClone(base);
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) return structuredClone(patch);
  const result = structuredClone(base);
  for (const [key, value] of Object.entries(patch)) {
    if (value && typeof value === 'object' && !Array.isArray(value) && result?.[key] && typeof result[key] === 'object' && !Array.isArray(result[key])) {
      result[key] = merge(result[key], value);
    } else {
      result[key] = structuredClone(value);
    }
  }
  return result;
}

function materialize(entry) {
  const issue = entry.issue === null ? null : merge(fixtures.base_issue, entry.issue);
  if (issue) issue.description = fixtures.descriptions[entry.description_key ?? issue.description_key];
  if (issue && entry.deployment_value) {
    issue.description = issue.description.replace(
      /(### Deployment\n\n)[^\n]+/,
      `$1${entry.deployment_value}`,
    );
  }
  if (issue) delete issue.description_key;
  return {
    issue,
    runtime: merge(fixtures.base_runtime, entry.runtime),
    options: merge(fixtures.base_options, entry.options),
  };
}

test('fixture versions match the validator versions', () => {
  assert.equal(fixtures.fixture_version, STORY_CONTRACT_VERSION);
  assert.equal(fixtures.governance_policy_version, GOVERNANCE_POLICY_VERSION);
});

for (const entry of fixtures.cases) {
  test(`governance fixture: ${entry.name}`, () => {
    const { issue, runtime, options } = materialize(entry);
    const result = evaluateTaskContract(issue, runtime, options);

    assert.equal(result.build_allowed, entry.build_allowed);
    assert.deepEqual(result.violation_codes, entry.codes);
    assert.equal(new Set(result.violation_codes).size, result.violation_codes.length);

    for (const field of ['contract_complete', 'governance_compliant', 'runtime_valid']) {
      if (field in entry) assert.equal(result[field], entry[field], `${entry.name}: ${field}`);
    }

    if (result.build_allowed) {
      assert.equal(result.contract_complete, true);
      assert.equal(result.governance_compliant, true);
      assert.equal(result.runtime_valid, true);
      assert.deepEqual(result.violation_codes, []);
    } else {
      assert.equal(
        result.contract_complete && result.governance_compliant && result.runtime_valid,
        false,
        `${entry.name}: a rejected result must expose at least one false gate`,
      );
    }
  });
}

test('canonical inspection preserves extracted contract fields', () => {
  const contract = inspectStoryContract(fixtures.descriptions.canonical);
  assert.equal(contract.sections['User story'].startsWith('As the delivery owner'), true);
  assert.equal(contract.acceptance_criteria.length, 2);
  assert.equal(contract.acceptance_criteria[0].number, 1);
  assert.match(contract.acceptance_criteria[0].evidence, /canonical positive fixture/);
  assert.equal(contract.deployment, 'in scope: localhost n8n Community Edition MVP');
  assert.deepEqual(contract.violations, []);
});

test('contract hash is stable across object and label order but changes with governed content', () => {
  const issue = materialize(fixtures.cases[0]).issue;
  const reordered = {
    updatedAt: issue.updatedAt,
    url: issue.url,
    labels: { nodes: [...issue.labels.nodes].reverse() },
    state: issue.state,
    priorityLabel: issue.priorityLabel,
    project: issue.project,
    team: issue.team,
    description: issue.description,
    title: issue.title,
    identifier: issue.identifier,
  };
  assert.equal(hashContract(reordered), hashContract(issue));
  assert.notEqual(hashContract({ ...issue, title: `${issue.title} changed` }), hashContract(issue));
  assert.notEqual(hashContract({ ...issue, labels: ['quality', 'security'] }), hashContract(issue));
});
