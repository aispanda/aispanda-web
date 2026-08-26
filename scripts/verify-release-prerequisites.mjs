import { firebaseManagementHeaders, validateRuntimePrerequisites } from './release-preflight-core.mjs';
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
console.log(`PASS: ${expectedEnvironment} runtime profile and isolated Firestore database exist.`);
