import { readdir, readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { extname, resolve } from 'node:path';

const forbiddenDigests = new Set([
  '3ccbd9105a45d8fcd4a0101c6532c599f6f59cfa4d4ce378792f547a869a4bea',
  'b5738c169b693bee89e1b74ebd48e0dfa53a34e8571790b7727721a0bfadc470',
  '97ea785cb8b633299f23e9be28cfddacc81c9e133e8af07faa1c19100b1b48a6',
]);
const textExtensions = new Set([
  '.astro', '.css', '.html', '.js', '.json', '.md', '.mjs', '.ps1', '.svg',
  '.ts', '.tsx', '.txt', '.xml', '.yaml', '.yml',
]);
const ignoredDirectories = new Set(['.astro', '.git', 'dist', 'node_modules']);
const ignoredPathMatchers = [
  /(?:^|\/)docs\/content(?:\/|$)/i,
  /(?:^|\/)docs\/private(?:\/|$)/i,
  /(?:^|\/)docs\/seeds\/SEED-002[^/]*\.md$/i,
  /(?:^|\/)docs\/brand\/VIBE_IDENTITY_BRIEF\.md$/i,
  /(?:^|\/)docs\/brand\/[^/]*-private[^/]*$/i,
];
const requestedRoots = process.argv.slice(2);
const roots = requestedRoots.length ? requestedRoots : ['.'];
const findings = [];
const localPathPatterns = [
  /\b[A-Za-z]:[\\/](?:Users|Personal|Documents|Desktop|Downloads)[\\/]/i,
  /\bfile:\/\//i,
];

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

function isBoundaryExempt(target) {
  const normalized = target.replace(/\\/g, '/');
  return ignoredPathMatchers.some((pattern) => pattern.test(normalized));
}

async function inspect(target) {
  if (isBoundaryExempt(target)) return;
  const info = await stat(target);
  if (info.isDirectory()) {
    const entries = await readdir(target, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
      await inspect(resolve(target, entry.name));
    }
    return;
  }

  if (!textExtensions.has(extname(target).toLowerCase())) return;
  const content = await readFile(target, 'utf8');
  if (localPathPatterns.some((pattern) => pattern.test(content))) {
    findings.push(`Local filesystem path: ${target}`);
  }
  const words = content.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  for (let index = 0; index < words.length; index += 1) {
    const candidates = [words[index], `${words[index]}${words[index + 1] ?? ''}`];
    if (candidates.some((candidate) => forbiddenDigests.has(digest(candidate)))) {
      findings.push(`Prohibited project term: ${target}`);
      break;
    }
  }
}

for (const root of roots) await inspect(resolve(root));

if (findings.length) {
  console.error(`Content boundary failed:\n${findings.join('\n')}`);
  process.exit(1);
}

console.log(`Content boundary valid: ${roots.join(', ')}`);
