import { spawnSync } from 'node:child_process';
import { validateEffectiveDenials, validateReleaseIsolation } from './release-preflight-core.mjs';

const required = (name) => {
  const result = String(process.env[name] ?? '').trim();
  if (!result) throw new Error(`${name} is required.`);
  return result;
};
const gcloudJson = (args) => {
  const result = spawnSync('gcloud', [...args, '--format=json'], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`Read-only gcloud query failed: gcloud ${args.slice(0, 3).join(' ')}`);
  return JSON.parse(result.stdout);
};

const releaseProject = required('RELEASE_PROJECT');
const stagingProject = required('STAGING_PROJECT');
const productionProject = required('PRODUCTION_PROJECT');
const stagingService = required('STAGING_SERVICE');
const productionService = required('PRODUCTION_SERVICE');
const region = required('TARGET_REGION');
const buildServiceAccount = required('BUILD_SERVICE_ACCOUNT');
const stagingRuntimeIdentity = required('STAGING_RUNTIME_IDENTITY');
const productionRuntimeIdentity = required('PRODUCTION_RUNTIME_IDENTITY');
const image = new URL(`https://${required('IMAGE_REPOSITORY')}`);
const [location] = image.hostname.split('-docker.pkg.dev');
const [imageProject, repository] = image.pathname.replace(/^\//, '').split('/');
if (imageProject !== releaseProject || !repository) throw new Error('IMAGE_REPOSITORY does not belong to RELEASE_PROJECT.');
const source = new URL(required('SOURCE_BUCKET'));
if (source.protocol !== 'gs:' || !source.hostname) throw new Error('SOURCE_BUCKET must be a Cloud Storage path.');
const sourceBucket = `gs://${source.hostname}`;
const releaseDescriptor = gcloudJson(['projects', 'describe', releaseProject]);
const sourceDescriptor = gcloudJson(['storage', 'buckets', 'describe', sourceBucket, '--project', releaseProject]);
const releaseProjectNumber = String(releaseDescriptor.projectNumber ?? '');
const sourceProjectNumber = String(sourceDescriptor.projectNumber ?? '');
if (!releaseProjectNumber || sourceProjectNumber !== releaseProjectNumber) {
  throw new Error('SOURCE_BUCKET does not belong to RELEASE_PROJECT.');
}

validateReleaseIsolation({
  releaseProjectPolicy: gcloudJson(['projects', 'get-iam-policy', releaseProject]),
  stagingProjectPolicy: gcloudJson(['projects', 'get-iam-policy', stagingProject]),
  productionProjectPolicy: gcloudJson(['projects', 'get-iam-policy', productionProject]),
  repositoryPolicy: gcloudJson(['artifacts', 'repositories', 'get-iam-policy', repository, '--location', location, '--project', releaseProject]),
  sourceBucketPolicy: gcloudJson(['storage', 'buckets', 'get-iam-policy', sourceBucket]),
  buildServiceAccount,
  stagingRuntimeIdentity,
  productionRuntimeIdentity,
});

const cloudRunService = (project, service) => gcloudJson([
  'run', 'services', 'describe', service, '--project', project, '--region', region,
]);
const secretVersionResource = (project, serviceDocument) => {
  const containers = serviceDocument?.spec?.template?.spec?.containers;
  const environment = new Map((containers?.[0]?.env ?? []).map((entry) => [entry.name, entry]));
  const reference = environment.get('AI_VAULT_KEY_B64')?.valueFrom?.secretKeyRef;
  const name = String(reference?.name ?? '');
  const version = String(reference?.key ?? '');
  if (!/^[A-Za-z0-9_-]+$/.test(name) || !/^(latest|[1-9][0-9]*)$/.test(version)) {
    throw new Error(`AI_VAULT_KEY_B64 must reference a secret owned by ${project}.`);
  }
  return `//secretmanager.googleapis.com/projects/${project}/secrets/${name}/versions/${version}`;
};
const targetResources = ({ project, service, runtimeIdentity, document }) => [
  {
    permission: 'resourcemanager.projects.setIamPolicy',
    resource: `//cloudresourcemanager.googleapis.com/projects/${project}`,
  },
  {
    permission: 'iam.serviceAccounts.actAs',
    resource: `//iam.googleapis.com/projects/${project}/serviceAccounts/${runtimeIdentity}`,
  },
  {
    permission: 'run.services.update',
    resource: `//run.googleapis.com/projects/${project}/locations/${region}/services/${service}`,
  },
  {
    permission: 'datastore.entities.get',
    resource: `//firestore.googleapis.com/projects/${project}/databases/(default)`,
  },
  {
    permission: 'datastore.entities.create',
    resource: `//firestore.googleapis.com/projects/${project}/databases/(default)`,
  },
  {
    permission: 'secretmanager.versions.access',
    resource: secretVersionResource(project, document),
  },
];
const stagingTarget = {
  project: stagingProject,
  service: stagingService,
  runtimeIdentity: stagingRuntimeIdentity,
  document: cloudRunService(stagingProject, stagingService),
};
const productionTarget = {
  project: productionProject,
  service: productionService,
  runtimeIdentity: productionRuntimeIdentity,
  document: cloudRunService(productionProject, productionService),
};
const crossBoundaryPairs = [
  [buildServiceAccount, stagingTarget],
  [buildServiceAccount, productionTarget],
  [stagingRuntimeIdentity, productionTarget],
  [productionRuntimeIdentity, stagingTarget],
];
const effectiveChecks = crossBoundaryPairs.flatMap(([principal, target]) => targetResources(target).map(({ permission, resource }) => {
  const result = spawnSync('gcloud', [
    'policy-intelligence', 'troubleshoot-policy', 'iam',
    resource,
    `--principal-email=${principal}`,
    `--permission=${permission}`,
    '--format=value(access)',
  ], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`Effective IAM query failed for ${principal} on ${target.project}.`);
  return { principal, project: target.project, permission, access: result.stdout.trim() };
}));
validateEffectiveDenials(effectiveChecks);
console.log('PASS: direct and effective IAM checks keep build, staging runtime and production duties separated.');
