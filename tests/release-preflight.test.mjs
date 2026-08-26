import assert from 'node:assert/strict';
import test from 'node:test';
import {
  validateEffectiveDenials,
  validateReleaseIsolation,
  validateRuntimePrerequisites,
} from '../scripts/release-preflight-core.mjs';

const binding = (role, serviceAccount) => ({ role, members: [`serviceAccount:${serviceAccount}`] });

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
