import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..', 'dist');
const shell = await readFile(resolve(root, 'article-shell-internal', 'index.html'), 'utf8');
const insights = await readFile(resolve(root, 'insights', 'index.html'), 'utf8');

for (const token of [
  '@@AISPANDA_ARTICLE_TITLE@@',
  '@@AISPANDA_ARTICLE_BODY@@',
  '@@AISPANDA_ARTICLE_SLUG@@',
]) {
  if (!shell.includes(token)) throw new Error(`Runtime article shell is missing ${token}.`);
}

if (!shell.includes('https://aispanda.com/article-shell-internal')) {
  throw new Error('Runtime article shell is missing its replaceable internal canonical URL.');
}

if (!insights.includes('<!--@@AISPANDA_DYNAMIC_INSIGHTS@@-->')) {
  throw new Error('Insights page is missing the runtime publication insertion point.');
}

const sitemapFiles = (await readdir(root)).filter((name) => /^sitemap.*\.xml$/.test(name));
for (const name of sitemapFiles) {
  const sitemap = await readFile(resolve(root, name), 'utf8');
  if (sitemap.includes('article-shell-internal')) {
    throw new Error(`Internal article shell leaked into ${name}.`);
  }
}

console.log('Runtime publication artifacts valid.');
