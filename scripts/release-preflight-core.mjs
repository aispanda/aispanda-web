const member = (serviceAccount) => `serviceAccount:${serviceAccount}`;

export const rolesForMember = (policy, serviceAccount) => {
  if (!policy || typeof policy !== 'object') throw new Error('IAM policy is invalid.');
  const bindings = policy.bindings ?? [];
  if (!Array.isArray(bindings)) throw new Error('IAM policy bindings are invalid.');
  const target = member(serviceAccount);
  return new Set(bindings.flatMap((binding) => (
    Array.isArray(binding.members) && binding.members.includes(target) && typeof binding.role === 'string'
      ? [binding.role]
      : []
  )));
};

const requireSubset = (observed, allowed, label) => {
  const unexpected = [...observed].filter((role) => !allowed.has(role));
  if (unexpected.length) throw new Error(`${label} has unexpected direct IAM roles: ${unexpected.sort().join(', ')}`);
};

export const validateReleaseIsolation = ({
  releaseProjectPolicy,
  stagingProjectPolicy,
  productionProjectPolicy,
  repositoryPolicy,
  sourceBucketPolicy,
  buildServiceAccount,
  stagingRuntimeIdentity,
  productionRuntimeIdentity,
}) => {
  const buildProjectRoles = rolesForMember(releaseProjectPolicy, buildServiceAccount);
  requireSubset(
    buildProjectRoles,
    new Set(['roles/logging.logWriter']),
    'Build identity',
  );
  if (!buildProjectRoles.has('roles/logging.logWriter')) {
    throw new Error('Build identity is missing direct roles/logging.logWriter.');
  }

  const buildRepositoryRoles = rolesForMember(repositoryPolicy, buildServiceAccount);
  requireSubset(buildRepositoryRoles, new Set(['roles/artifactregistry.writer']), 'Build repository binding');
  if (!buildRepositoryRoles.has('roles/artifactregistry.writer')) {
    throw new Error('Build identity is missing repository-scoped roles/artifactregistry.writer.');
  }
  const buildSourceRoles = rolesForMember(sourceBucketPolicy, buildServiceAccount);
  requireSubset(buildSourceRoles, new Set(['roles/storage.objectViewer']), 'Build source-bucket binding');
  if (!buildSourceRoles.has('roles/storage.objectViewer')) {
    throw new Error('Build identity is missing source-bucket-scoped roles/storage.objectViewer.');
  }
  if (rolesForMember(stagingProjectPolicy, buildServiceAccount).size > 0) {
    throw new Error('Build identity must not have direct roles in the staging project.');
  }
  if (rolesForMember(productionProjectPolicy, buildServiceAccount).size > 0) {
    throw new Error('Build identity must not have direct roles in the production project.');
  }
  if (rolesForMember(releaseProjectPolicy, stagingRuntimeIdentity).size > 0) {
    throw new Error('Staging runtime identity must not have direct roles in the release project.');
  }
  if (rolesForMember(productionProjectPolicy, stagingRuntimeIdentity).size > 0) {
    throw new Error('Staging runtime identity must not have direct roles in the production project.');
  }
  if (rolesForMember(releaseProjectPolicy, productionRuntimeIdentity).size > 0) {
    throw new Error('Production runtime identity must not have direct roles in the release project.');
  }
  if (rolesForMember(stagingProjectPolicy, productionRuntimeIdentity).size > 0) {
    throw new Error('Production runtime identity must not have direct roles in the staging project.');
  }
};

export const validateEffectiveDenials = (checks) => {
  if (!Array.isArray(checks) || checks.length === 0) throw new Error('Effective IAM checks are required.');
  for (const check of checks) {
    if (check.access !== 'DENIED') {
      throw new Error(`Effective IAM isolation failed: ${check.principal} has or may have ${check.permission} on ${check.project}.`);
    }
  }
};

export const releaseProjectListsBucket = (buckets, bucketName) => (
  Array.isArray(buckets)
  && typeof bucketName === 'string'
  && bucketName.length > 0
  && buckets.some((bucket) => bucket?.name === bucketName || bucket?.storage_url === `gs://${bucketName}/`)
);

export const firebaseManagementHeaders = (accessToken, project) => {
  if (typeof accessToken !== 'string' || accessToken.trim().length === 0) {
    throw new Error('Firebase Management access token is required.');
  }
  if (typeof project !== 'string' || project.trim().length === 0) {
    throw new Error('Firebase Management quota project is required.');
  }
  return {
    Authorization: `Bearer ${accessToken.trim()}`,
    'x-goog-user-project': project.trim(),
  };
};

const environmentMap = (service) => {
  const containers = service?.spec?.template?.spec?.containers;
  if (!Array.isArray(containers) || containers.length !== 1) throw new Error('Cloud Run service must have one container.');
  return new Map((containers[0].env ?? []).map((entry) => [entry.name, entry]));
};

export const validateRuntimePrerequisites = ({
  service,
  project,
  expectedEnvironment,
  expectedRuntimeIdentity,
  authoritativeFirebaseConfig,
}) => {
  const observedRuntimeIdentity = service?.spec?.template?.spec?.serviceAccountName;
  if (observedRuntimeIdentity !== expectedRuntimeIdentity) {
    throw new Error('Cloud Run runtime identity does not match the configured environment identity.');
  }
  const runtime = environmentMap(service);
  const expectedValues = {
    RUNTIME_ENVIRONMENT: expectedEnvironment,
    RUNTIME_FIREBASE_PROJECT_ID: project,
  };
  for (const [name, expected] of Object.entries(expectedValues)) {
    if (runtime.get(name)?.value !== expected) throw new Error(`${name} does not match the target environment.`);
  }
  for (const name of [
    'RUNTIME_FIREBASE_API_KEY',
    'RUNTIME_FIREBASE_AUTH_DOMAIN',
    'RUNTIME_FIREBASE_STORAGE_BUCKET',
    'RUNTIME_FIREBASE_MESSAGING_SENDER_ID',
    'RUNTIME_FIREBASE_APP_ID',
    'RUNTIME_GOOGLE_CLIENT_ID',
  ]) {
    if (typeof runtime.get(name)?.value !== 'string' || runtime.get(name).value.trim().length === 0) {
      throw new Error(`${name} is missing from the Cloud Run runtime profile.`);
    }
  }
  const authoritativeFields = {
    RUNTIME_FIREBASE_PROJECT_ID: 'projectId',
    RUNTIME_FIREBASE_API_KEY: 'apiKey',
    RUNTIME_FIREBASE_AUTH_DOMAIN: 'authDomain',
    RUNTIME_FIREBASE_STORAGE_BUCKET: 'storageBucket',
    RUNTIME_FIREBASE_MESSAGING_SENDER_ID: 'messagingSenderId',
    RUNTIME_FIREBASE_APP_ID: 'appId',
  };
  if (!authoritativeFirebaseConfig || typeof authoritativeFirebaseConfig !== 'object') {
    throw new Error('Authoritative Firebase web-app configuration is required.');
  }
  for (const [runtimeName, authoritativeName] of Object.entries(authoritativeFields)) {
    const observed = runtime.get(runtimeName)?.value;
    if (observed !== authoritativeFirebaseConfig[authoritativeName]) {
      throw new Error(`${runtimeName} does not match the target project's Firebase web app.`);
    }
  }
  const origin = runtime.get('PUBLIC_SITE_ORIGIN')?.value;
  if (!/^https:\/\/[^\s/]+$/.test(origin ?? '')) throw new Error('PUBLIC_SITE_ORIGIN must be an HTTPS origin.');
  if (expectedEnvironment === 'production' && origin !== 'https://aispanda.com') {
    throw new Error('Production PUBLIC_SITE_ORIGIN must be https://aispanda.com.');
  }
  if (expectedEnvironment === 'staging' && origin === 'https://aispanda.com') {
    throw new Error('Staging PUBLIC_SITE_ORIGIN must not use the production origin.');
  }
  if (!runtime.get('AI_VAULT_KEY_B64')?.valueFrom?.secretKeyRef) {
    throw new Error('AI_VAULT_KEY_B64 must use a Secret Manager reference.');
  }
};
