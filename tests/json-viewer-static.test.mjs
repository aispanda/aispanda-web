import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';

test('standalone viewer loads its assets under its own route', async () => {
  const html = await readFile(new URL('../public/json-viewer/index.html', import.meta.url), 'utf8');
  assert.match(html, /<base href="\/json-viewer\/"\s*\/>/);
  assert.match(html, /AI Spanda JSON Viewer/);
  assert.match(html, /\.\/assets\/index-[\w-]+\.js/);
});
