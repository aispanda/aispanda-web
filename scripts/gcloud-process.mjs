import { existsSync } from 'node:fs';
import { win32 } from 'node:path';
import { spawnSync } from 'node:child_process';

export const resolveGcloudInvocation = (
  args,
  {
    platform = process.platform,
    pathValue = process.env.PATH ?? '',
    pathExists = existsSync,
    powershell = 'powershell.exe',
  } = {},
) => {
  if (!Array.isArray(args) || args.some((arg) => typeof arg !== 'string')) {
    throw new TypeError('gcloud arguments must be strings.');
  }
  if (platform !== 'win32') return { command: 'gcloud', args: [...args] };

  const launcher = pathValue
    .split(win32.delimiter)
    .map((entry) => entry.trim().replace(/^"|"$/g, ''))
    .filter(Boolean)
    .map((entry) => win32.join(entry, 'gcloud.ps1'))
    .find((candidate) => pathExists(candidate));
  if (!launcher) throw new Error('gcloud.ps1 was not found on PATH.');

  return {
    command: powershell,
    args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', launcher, ...args],
  };
};

export const requireSuccessfulGcloud = (result) => {
  if (result?.error) throw new Error('gcloud could not be launched.', { cause: result.error });
  if (result?.status !== 0) throw new Error(`gcloud exited with status ${String(result?.status)}.`);
  return result;
};

export const spawnGcloudSync = (args, options = {}) => {
  const allowedOptions = new Set(['encoding', 'maxBuffer', 'timeout']);
  const unsupported = Object.keys(options).filter((name) => !allowedOptions.has(name));
  if (unsupported.length > 0) {
    throw new Error(`Unsupported gcloud process options: ${unsupported.sort().join(', ')}`);
  }
  const invocation = resolveGcloudInvocation(args);
  return requireSuccessfulGcloud(spawnSync(invocation.command, invocation.args, {
    ...options,
    shell: false,
    windowsVerbatimArguments: false,
  }));
};
