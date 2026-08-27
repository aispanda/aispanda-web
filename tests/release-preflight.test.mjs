import assert from 'node:assert/strict';
import test from 'node:test';
import { requireSuccessfulGcloud, resolveGcloudInvocation, spawnGcloudSync } from '../scripts/gcloud-process.mjs';
import {
  firebaseManagementHeaders,
  policyTroubleshooterArgs,
  releaseProjectListsBucket,
  validateEffectiveDenials,
  validateReleaseIsolation,
  validateRuntimePrerequisites,
} from '../scripts/release-preflight-core.mjs';

const binding = (role, serviceAccount) => ({ role, members: [`serviceAccount:${serviceAccount}`] });

test('gcloud launcher uses direct execution outside Windows', () => {
  assert.deepEqual(resolveGcloudInvocation(['projects', 'describe', 'example'], { platform: 'linux' }), {
    command: 'gcloud',
    args: ['projects', 'describe', 'example'],
  });
});

test('gcloud launcher uses the installed PowerShell wrapper on Windows without a command shell', () => {
  const launcher = resolveGcloudInvocation(
    ['firestore', 'databases', 'describe', '--database=(default)'],
    {
      platform: 'win32',
      pathValue: 'C:\\Other;C:\\Cloud SDK\\bin',
      pathExists: (candidate) => candidate === 'C:\\Cloud SDK\\bin\\gcloud.ps1',
      powershell: 'powershell.exe',
    },
  );
  assert.equal(launcher.command, 'powershell.exe');
  assert.deepEqual(launcher.args, [
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-File',
    'C:\\Cloud SDK\\bin\\gcloud.ps1',
    'firestore',
    'databases',
    'describe',
    '--database=(default)',
  ]);
});

test('gcloud launcher fails closed on Windows when the installed wrapper is absent', () => {
  assert.throws(() => resolveGcloudInvocation([], {
    platform: 'win32',
    pathValue: 'C:\\Other',
    pathExists: () => false,
  }), /gcloud\.ps1 was not found/);
});

test('gcloud launcher rejects options that could enable a command shell', () => {
  assert.throws(() => spawnGcloudSync([], { shell: true }), /Unsupported gcloud process options: shell/);
});

test('gcloud launcher fails closed on process errors and nonzero exits', () => {
  assert.throws(() => requireSuccessfulGcloud({ error: new Error('launch failed'), status: null }), /could not be launched/);
  assert.throws(() => requireSuccessfulGcloud({ status: 1 }), /exited with status 1/);
});

test('Firebase Management requests attribute quota to the isolated target project', () => {
  assert.deepEqual(firebaseManagementHeaders(' access-token ', ' stage-project-123 '), {
    Authorization: 'Bearer access-token',
    'x-goog-user-project': 'stage-project-123',
  });
});

test('source-bucket ownership uses the release project bucket listing, not an unstable descriptor field', () => {
  assert.equal(releaseProjectListsBucket([
    { name: 'release-source' },
    { storage_url: 'gs://another-release-bucket/' },
  ], 'release-source'), true);
  assert.equal(releaseProjectListsBucket([
    { name: 'other-project-bucket' },
  ], 'release-source'), false);
  assert.equal(releaseProjectListsBucket({ name: 'release-source' }, 'release-source'), false);
});

test('Policy Troubleshooter explicitly bills only the dedicated release project', () => {
  assert.deepEqual(policyTroubleshooterArgs({
    resource: '//run.googleapis.com/projects/staging/locations/us-east1/services/web',
    principalEmail: 'build@example.invalid',
    permission: 'run.services.update',
    billingProject: 'release-project',
  }), [
    'policy-intelligence', 'troubleshoot-policy', 'iam',
    '//run.googleapis.com/projects/staging/locations/us-east1/services/web',
    '--principal-email=build@example.invalid',
    '--permission=run.services.update',
    '--billing-project=release-project',
    '--format=value(access)',
  ]);
});

test('release isolation accepts only artifact/log build duties and no staging-to-production role', () => {
  validateReleaseIsolation({
    releaseProjectPolicy: { bindings: [binding('roles/logging.logWriter', 'build@example.invalid')] },
    stagingProjectPolicy: { bindings: [] },
    productionProjectPolicy: { bindings: [] },
    repositoryPolicy: { bindings: [binding('roles/artifactregistry.writer', 'build@example.invalid')] },
    sourceBucketPolicy: { bindings: [binding('roles/storage.objectViewer', 'build@example.invalid')] },
    buildServiceAccount: 'build@example.invalid',
    stagingRuntimeIdentity: 'stage@example.invalid',
    productionRuntimeIdentity: 'production@example.invalid',
  });
});

test('release isolation rejects build runtime administration', () => {
  assert.throws(() => validateReleaseIsolation({
    releaseProjectPolicy: { bindings: [
      binding('roles/logging.logWriter', 'build@example.invalid'),
      binding('roles/run.admin', 'build@example.invalid'),
    ] },
    stagingProjectPolicy: { bindings: [] },
    productionProjectPolicy: { bindings: [] },
    repositoryPolicy: { bindings: [binding('roles/artifactregistry.writer', 'build@example.invalid')] },
    sourceBucketPolicy: { bindings: [binding('roles/storage.objectViewer', 'build@example.invalid')] },
    buildServiceAccount: 'build@example.invalid',
    stagingRuntimeIdentity: 'stage@example.invalid',
    productionRuntimeIdentity: 'production@example.invalid',
  }), /unexpected direct IAM roles/);
});

test('release isolation rejects project-wide source-bucket read access', () => {
  assert.throws(() => validateReleaseIsolation({
    releaseProjectPolicy: { bindings: [
      binding('roles/logging.logWriter', 'build@example.invalid'),
      binding('roles/storage.objectViewer', 'build@example.invalid'),
    ] },
    stagingProjectPolicy: { bindings: [] },
    productionProjectPolicy: { bindings: [] },
    repositoryPolicy: { bindings: [binding('roles/artifactregistry.writer', 'build@example.invalid')] },
    sourceBucketPolicy: { bindings: [binding('roles/storage.objectViewer', 'build@example.invalid')] },
    buildServiceAccount: 'build@example.invalid',
    stagingRuntimeIdentity: 'stage@example.invalid',
    productionRuntimeIdentity: 'production@example.invalid',
  }), /unexpected direct IAM roles/);
});

test('effective IAM isolation fails closed on inherited or group-derived access', () => {
  assert.throws(() => validateEffectiveDenials([{
    principal: 'build@example.invalid',
    project: 'production-project-123',
    permission: 'datastore.entities.get',
    access: 'GRANTED',
  }]), /Effective IAM isolation failed/);
});

const service = (environment, project, origin = 'https://stage.example.test', identity = 'stage@example.invalid') => ({
  spec: { template: { spec: { serviceAccountName: identity, containers: [{ env: [
    { name: 'RUNTIME_ENVIRONMENT', value: environment },
    { name: 'RUNTIME_FIREBASE_PROJECT_ID', value: project },
    { name: 'RUNTIME_FIREBASE_API_KEY', value: 'public-key' },
    { name: 'RUNTIME_FIREBASE_AUTH_DOMAIN', value: `${project}.firebaseapp.com` },
    { name: 'RUNTIME_FIREBASE_STORAGE_BUCKET', value: `${project}.firebasestorage.app` },
    { name: 'RUNTIME_FIREBASE_MESSAGING_SENDER_ID', value: '123' },
    { name: 'RUNTIME_FIREBASE_APP_ID', value: 'app-id' },
    { name: 'RUNTIME_GOOGLE_CLIENT_ID', value: 'client-id' },
    { name: 'PUBLIC_SITE_ORIGIN', value: origin },
    { name: 'AI_VAULT_KEY_B64', valueFrom: { secretKeyRef: { name: 'vault', key: '1' } } },
  ] }] } } },
});

const firebaseConfig = (project) => ({
  projectId: project,
  apiKey: 'public-key',
  authDomain: `${project}.firebaseapp.com`,
  storageBucket: `${project}.firebasestorage.app`,
  messagingSenderId: '123',
  appId: 'app-id',
});

test('runtime prerequisite binds staging to its own Firebase project and secret reference', () => {
  validateRuntimePrerequisites({
    service: service('staging', 'stage-project-123'),
    project: 'stage-project-123',
    expectedEnvironment: 'staging',
    expectedRuntimeIdentity: 'stage@example.invalid',
    authoritativeFirebaseConfig: firebaseConfig('stage-project-123'),
  });
});

test('runtime prerequisite rejects the wrong Cloud Run runtime identity', () => {
  assert.throws(() => validateRuntimePrerequisites({
    service: service('staging', 'stage-project-123', 'https://stage.example.test', 'production@example.invalid'),
    project: 'stage-project-123',
    expectedEnvironment: 'staging',
    expectedRuntimeIdentity: 'stage@example.invalid',
    authoritativeFirebaseConfig: firebaseConfig('stage-project-123'),
  }), /runtime identity/);
});

test('runtime prerequisite rejects production Firebase client configuration in staging', () => {
  assert.throws(() => validateRuntimePrerequisites({
    service: service('staging', 'stage-project-123'),
    project: 'stage-project-123',
    expectedEnvironment: 'staging',
    expectedRuntimeIdentity: 'stage@example.invalid',
    authoritativeFirebaseConfig: firebaseConfig('production-project-123'),
  }), /target project's Firebase web app/);
});

test('runtime prerequisite rejects a staging profile that points at production', () => {
  assert.throws(() => validateRuntimePrerequisites({
    service: service('staging', 'aispanda', 'https://aispanda.com'),
    project: 'stage-project-123',
    expectedEnvironment: 'staging',
    expectedRuntimeIdentity: 'stage@example.invalid',
    authoritativeFirebaseConfig: firebaseConfig('stage-project-123'),
  }), /RUNTIME_FIREBASE_PROJECT_ID|production origin/);
});
