import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const profile = JSON.parse(readFileSync(resolve('site-profile.json'), 'utf8'));
const errors = [];

for (const key of ['name', 'baseUrl', 'promise', 'primaryAction']) {
  if (!profile.site?.[key]) errors.push(`site.${key} is required`);
}
if (!Array.isArray(profile.audiences) || profile.audiences.length === 0) errors.push('At least one audience is required');
if (!Array.isArray(profile.stages?.launch) || profile.stages.launch.length === 0) errors.push('At least one launch capability is required');
if (profile.sourceControl?.visibility === 'public' && !profile.sourceControl?.mfaRequired) errors.push('Public repositories require MFA governance');

if (errors.length) {
  console.error(errors.map((error) => `- ${error}`).join('\n'));
  process.exit(1);
}
console.log(`Site profile valid: ${profile.site.name} (${profile.stages.launch.length} launch capabilities)`);
