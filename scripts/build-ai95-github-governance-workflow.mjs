import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';

const scriptUrl = new URL('./Invoke-AI95PullRequestGovernance.ps1', import.meta.url);
const workflowUrl = new URL('../.github/workflows/ai-governance.yml', import.meta.url);
const script = (await readFile(scriptUrl, 'utf8')).replace(/\r\n?/g, '\n').trimEnd();
const indentedScript = script
  .split('\n')
  .map((line) => (line === '' ? '' : `          ${line}`))
  .join('\n');

const workflow = `name: AI governance

on:
  pull_request_target:
    branches: [main]
    types: [opened, reopened, synchronize, ready_for_review, converted_to_draft]

concurrency:
  group: ai-governance-\${{ github.event.pull_request.head.repo.full_name }}-\${{ github.event.pull_request.head.sha }}
  cancel-in-progress: true

permissions: {}

jobs:
  governance:
    name: AI governance
    if: github.event.pull_request.head.repo.full_name == github.repository
    runs-on: [self-hosted, windows, x64, ai-governance]
    timeout-minutes: 5
    permissions:
      contents: read
      statuses: write
    env:
      AI95_BASE_REPOSITORY: \${{ github.repository }}
      AI95_PR_HEAD_REPOSITORY: \${{ github.event.pull_request.head.repo.full_name }}
      AI95_PR_HEAD_REF: \${{ github.event.pull_request.head.ref }}
      AI95_PR_HEAD_SHA: \${{ github.event.pull_request.head.sha }}
      AI95_PR_DRAFT: \${{ github.event.pull_request.draft }}
      AI95_OPERATION_ID: github:pr:\${{ github.event.pull_request.number }}:\${{ github.run_id }}:\${{ github.run_attempt }}
      AI95_GITHUB_TOKEN: \${{ secrets.GITHUB_TOKEN }}
      AI95_N8N_KEY: \${{ secrets.N8N_GOVERNANCE_TOKEN }}
      AI95_RUN_URL: \${{ github.server_url }}/\${{ github.repository }}/actions/runs/\${{ github.run_id }}
    steps:
      - name: Validate current story and approved baseline
        shell: pwsh
        run: |
${indentedScript}
`;

if (process.argv.includes('--check')) {
  const committed = await readFile(workflowUrl, 'utf8');
  assert.equal(
    committed.replace(/\r\n?/g, '\n'),
    workflow,
    'The protected AI governance workflow has drifted. Regenerate it from the reviewed PowerShell source.',
  );
} else {
  await writeFile(workflowUrl, workflow);
}
