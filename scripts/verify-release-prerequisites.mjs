import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { firebaseManagementHeaders, validateRuntimePrerequisites, policyTroubleshooterArgs, policyTroubleshooterAccess } from './release-preflight-core.mjs';
import { spawnGcloudSync } from './gcloud-process.mjs';

const expectedEnvironment = process.argv[2];
if (!['staging', 'production'].includes(expectedEnvironment)) throw new Error('Expected staging or production argument.');
const required = (name) => {
  const result = String(process.env[name] ?? '').trim();
  if (!result) throw new Error(`${name} is required.`);
  return result;
};
const project = required('TARGET_PROJECT');
const service = required('TARGET_SERVICE');
const region = required('TARGET_REGION');
const expectedRuntimeIdentity = required(
  expectedEnvironment === 'staging' ? 'STAGING_RUNTIME_IDENTITY' : 'PRODUCTION_RUNTIME_IDENTITY',
);
const described = spawnGcloudSync([
  'run', 'services', 'describe', service, '--project', project, '--region', region, '--format=json',
], { encoding: 'utf8' });
if (described.status !== 0) throw new Error('Cloud Run prerequisite query failed.');
const cloudRunService = JSON.parse(described.stdout);
const containers = cloudRunService?.spec?.template?.spec?.containers;
const runtimeEnvironment = new Map((containers?.[0]?.env ?? []).map((entry) => [entry.name, entry]));
const firebaseAppId = runtimeEnvironment.get('RUNTIME_FIREBASE_APP_ID')?.value;
if (typeof firebaseAppId !== 'string' || firebaseAppId.trim().length === 0) {
  throw new Error('RUNTIME_FIREBASE_APP_ID is missing from the Cloud Run runtime profile.');
}
const token = spawnGcloudSync(['auth', 'print-access-token'], { encoding: 'utf8' });
if (token.status !== 0 || token.stdout.trim().length === 0) {
  throw new Error('Firebase configuration verification could not obtain a read-only access token.');
}
const configResponse = await fetch(
  // The URL selects the Firebase resource project. The header below only
  // attributes quota/billing to that already-selected target project.
  `https://firebase.googleapis.com/v1beta1/projects/${encodeURIComponent(project)}/webApps/${encodeURIComponent(firebaseAppId)}/config`,
  {
    headers: firebaseManagementHeaders(token.stdout, project),
    signal: AbortSignal.timeout(15_000),
  },
);
if (!configResponse.ok) throw new Error('The target Firebase web-app configuration is missing or inaccessible.');
const authoritativeFirebaseConfig = await configResponse.json();
validateRuntimePrerequisites({
  service: cloudRunService,
  project,
  expectedEnvironment,
  expectedRuntimeIdentity,
  authoritativeFirebaseConfig,
});

const database = spawnGcloudSync([
  'firestore', 'databases', 'describe', '--database=(default)', '--project', project, '--format=json',
], { encoding: 'utf8' });
if (database.status !== 0) throw new Error('The target default Firestore database is missing or inaccessible.');

// The Firebase config names a bucket even before the bucket has been provisioned.
// Read the actual storage resource and its effective runtime IAM before a build.
const root = fileURLToPath(new URL('../', import.meta.url));
const lock = JSON.parse(await readFile(resolve(root, 'vendor/blog/lock.json'), 'utf8'));
if (!/^[a-f0-9]{64}$/.test(lock.packageSha256 || '') || !/^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/.test(lock.packageVersion || '')
  || typeof lock.archive !== 'string' || /[\\/]/.test(lock.archive)) throw new Error('Invalid pinned blog package.');
const archive = await readFile(resolve(root, 'vendor/blog', lock.archive));
if (createHash('sha256').update(archive).digest('hex') !== lock.packageSha256) throw new Error('Pinned blog archive integrity mismatch.');
const { verifyImageStoragePrerequisites, verifyFirebaseAuthPrerequisites } = await import(pathToFileURL(resolve(root, '.blog/releases',
  `${lock.packageVersion}-${lock.packageSha256.slice(0, 12)}`, 'runtime/tests/staging-preflight.mjs')).href);
if (typeof verifyFirebaseAuthPrerequisites !== 'function') {
  throw new Error('Pinned blog package lacks Firebase Auth permission preflight; adopt the updated package before release.');
}
const checkRuntimePermission = async request => {
  const result = spawnGcloudSync(policyTroubleshooterArgs({ ...request, billingProject: required('RELEASE_PROJECT') }), { encoding: 'utf8' });
  return policyTroubleshooterAccess(result.stdout);
};
await verifyFirebaseAuthPrerequisites({
  projectId: project, runtimeIdentity: expectedRuntimeIdentity, checkPermission: checkRuntimePermission,
});
const describedProject = spawnGcloudSync(['projects', 'describe', project, '--format=json'], { encoding: 'utf8' });
const projectNumber = JSON.parse(describedProject.stdout).projectNumber;
await verifyImageStoragePrerequisites({
  bucketName: runtimeEnvironment.get('RUNTIME_FIREBASE_STORAGE_BUCKET')?.value,
  projectNumber, runtimeIdentity: expectedRuntimeIdentity,
  readBucketMetadata: async bucket => {
    const response = await fetch(`https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}?fields=name,projectNumber,iamConfiguration`, {
      headers: firebaseManagementHeaders(token.stdout, project), redirect: 'error', signal: AbortSignal.timeout(15000),
    });
    if (response.status === 404) throw new Error('Configured image storage bucket does not exist. Provision it before staging or promotion.');
    if (!response.ok) throw new Error('Configured image storage bucket metadata is inaccessible.');
    return response.json();
  },
  checkPermission: checkRuntimePermission,
});
console.log(`PASS: ${expectedEnvironment} runtime profile, Firebase Auth user lookup, Firestore and private image storage with effective runtime permissions are verified.`);
