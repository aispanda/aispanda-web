import { expr, node, trigger, workflow } from '@n8n/workflow-sdk';

const cloudFixture = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Create Synthetic Cloud Fixture',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: `return [{
  json: {
    source: 'manual_synthetic',
    test_mode: true,
    synthetic: true,
    authorization_capable: false,
    fixture_id: 'cloud-parent-mirror-pass',
    issue: {
      identifier: 'DEV-1',
      title: 'Synthetic governed delivery check',
      description: '### User story\\n\\nAs a delivery owner, I want a validated task, so that work starts from approved facts.\\n\\n### Required change\\n\\nReplace informal readiness checks with a deterministic contract decision.\\n\\n### Acceptance criteria\\n\\nAC-1: The validator returns one deterministic outcome for a synthetic task.\\n\\nVerify with: Run this synthetic fixture and inspect the outcome.\\n\\n### Deployment\\n\\nnot applicable',
      url: 'https://example.invalid/issues/DEV-1',
      priorityLabel: 'High',
      state: { name: 'Ready' },
      team: { name: 'Development' },
      project: { name: 'Governance' },
      labels: { nodes: [] },
      updatedAt: '2026-08-28T16:30:00.000Z',
    },
    runtime: {
      branch_name: 'codex/dev-1-synthetic-check',
      head_sha: 'd1bd88182eabea9378bb75452ecd6e5d814a1e1d',
      repository: 'github.com/example/governance-synthetic',
      caller: 'cloud-parent-mirror',
    },
    options: {
      expected_task_id: 'DEV-1',
      expected_repository: 'github.com/example/governance-synthetic',
      expected_policy_version: 'governance-policy-v1.1',
      expected_story_contract_version: 'story-contract-v2',
    },
    query_errors: [],
  },
}];`,
    },
  },
});

const validateContract = node({
  type: 'n8n-nodes-base.executeWorkflow',
  version: 1.3,
  config: {
    name: 'Execute Cloud Contract Validator',
    parameters: {
      mode: 'once',
      source: 'database',
      workflowId: { __rl: true, mode: 'id', value: '3873bmInftBGbgEo', cachedResultName: 'get_task_contract' },
      options: { waitForSubWorkflow: true },
    },
  },
});

const prepareBaseline = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Prepare Synthetic Baseline Input',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: `const contract = $input.first().json || {};
return [{
  json: {
    task_id: contract.task_id || '',
    repository: contract.repository || '',
    branch_name: contract.branch_name || '',
    head_sha: 'd1bd88182eabea9378bb75452ecd6e5d814a1e1d',
    caller_identity: 'cloud-parent-mirror',
    permitted_action: 'local_build_start',
    operation_id: 'cloud:dev-1:00000001',
    governance_policy_version: contract.governance_policy_version || '',
    story_contract_version: contract.story_contract_version || '',
    linear_updated_at: contract.linear_updated_at || '',
    contract_hash: contract.contract_hash || '',
    build_allowed: contract.candidate_build_allowed === true,
  },
}];`,
    },
  },
});

const storeBaseline = node({
  type: 'n8n-nodes-base.executeWorkflow',
  version: 1.3,
  config: {
    name: 'Execute Cloud Baseline Store',
    parameters: {
      mode: 'once',
      source: 'database',
      workflowId: { __rl: true, mode: 'id', value: 'SkpDKwXxolljARQf', cachedResultName: 'AI-95 Governance Baseline Store' },
      workflowInputs: {
        mappingMode: 'defineBelow',
        value: {
          task_id: expr('{{ $json.task_id }}'),
          repository: expr('{{ $json.repository }}'),
          branch_name: expr('{{ $json.branch_name }}'),
          head_sha: expr('{{ $json.head_sha }}'),
          caller_identity: expr('{{ $json.caller_identity }}'),
          permitted_action: expr('{{ $json.permitted_action }}'),
          operation_id: expr('{{ $json.operation_id }}'),
          governance_policy_version: expr('{{ $json.governance_policy_version }}'),
          story_contract_version: expr('{{ $json.story_contract_version }}'),
          linear_updated_at: expr('{{ $json.linear_updated_at }}'),
          contract_hash: expr('{{ $json.contract_hash }}'),
          build_allowed: expr('{{ $json.build_allowed }}'),
        },
        schema: [
          { id: 'task_id', displayName: 'task_id', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'repository', displayName: 'repository', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'branch_name', displayName: 'branch_name', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'head_sha', displayName: 'head_sha', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'caller_identity', displayName: 'caller_identity', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'permitted_action', displayName: 'permitted_action', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'operation_id', displayName: 'operation_id', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'governance_policy_version', displayName: 'governance_policy_version', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'story_contract_version', displayName: 'story_contract_version', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'linear_updated_at', displayName: 'linear_updated_at', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'contract_hash', displayName: 'contract_hash', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'build_allowed', displayName: 'build_allowed', required: false, defaultMatch: false, display: true, type: 'boolean', canBeUsedToMatch: true },
        ],
      },
      options: { waitForSubWorkflow: true },
    },
  },
});

const denyAuthority = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Return Cloud Test-Only Result',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: `const baseline = $input.first().json || {};
const contract = $('Execute Cloud Contract Validator').first().json || {};
return [{
  json: {
    outcome: 'CLOUD_TEST_ONLY',
    test_result: contract.candidate_build_allowed === true && baseline.storage_verified === true ? 'PASS' : 'FAIL',
    build_allowed: false,
    authority_granted: false,
    authorization_mode: 'cloud_test_only',
    synthetic: true,
    contract_candidate_valid: contract.candidate_build_allowed === true,
    baseline_storage_verified: baseline.storage_verified === true,
    message: 'Cloud mirror completed a synthetic test. Only localhost authorize_build_start can grant build authority.',
  },
}];`,
    },
  },
});

const manual = trigger({
  type: 'n8n-nodes-base.manualTrigger',
  version: 1,
  config: { name: 'Run Cloud Mirror Test' },
});

export default workflow('ai93-cloud-parent-mirror', 'AI-93 Governed Delivery Parent — Cloud Mirror')
  .add(manual)
  .to(cloudFixture)
  .to(validateContract)
  .to(prepareBaseline)
  .to(storeBaseline)
  .to(denyAuthority);
