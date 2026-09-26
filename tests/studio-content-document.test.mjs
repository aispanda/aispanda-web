import assert from 'node:assert/strict';
import test from 'node:test';

import {
  StudioContentError,
  assertContentDocument,
  createContentDocument,
  migrateLegacyHtml,
  renderContentDocument,
  sha256,
  stableJson,
} from '../server/studio-content-document.mjs';

const goldenLegacyHtml = [
  '<h1>Consulting Rewired — પરામર્શ — परामर्श</h1>',
  '<p>Opening <strong>bold</strong> and <em>italic</em> text.</p>',
  '<h2>What changes</h2>',
  '<p>Visit <a href="https://example.com/path" title="Evidence">the evidence</a><br>then continue.</p>',
  '<blockquote><p>Good advice preserves agency.</p></blockquote>',
  '<h3>Ordered work</h3>',
  '<ol><li><p>First</p><ul><li><p>Nested point</p></li></ul></li><li><p>Second</p></li></ol>',
  '<aside class="studio-callout"><strong>Key point</strong><p>Original context stays recoverable.</p></aside>',
  '<hr>',
  '<p>Email <a href="mailto:editor@example.com">the editor</a>.</p>',
].join('');

test('supported legacy HTML becomes deterministic governed Tiptap JSON without visible text loss', () => {
  const migrated = migrateLegacyHtml({
    html: goldenLegacyHtml,
    title: 'Consulting Rewired — પરામર્શ — परामर्श',
  });

  assert.equal(migrated.document.format, 'tiptap-json');
  assert.equal(migrated.document.schemaVersion, 1);
  assert.equal(migrated.document.registryVersion, 'ai-91-v1');
  assert.equal(migrated.legacyHtmlOriginal, goldenLegacyHtml);
  assert.equal(migrated.legacyHtmlSha256, sha256(goldenLegacyHtml));
  assert.equal(migrated.renderedHtml.includes('<h1>'), false);
  assert.match(migrated.renderedHtml, /<h2>What changes<\/h2>/);
  assert.match(migrated.renderedHtml, /<h3>Ordered work<\/h3>/);
  assert.match(migrated.renderedHtml, /<aside class="studio-callout"><p><strong>Key point<\/strong><\/p>/);
  assert.match(migrated.renderedHtml, /<ol><li><p>First<\/p><ul>/);
  assert.equal(renderContentDocument(migrated.document), migrated.renderedHtml);

  const repeated = migrateLegacyHtml({ html: migrated.renderedHtml, title: 'Different title' });
  assert.deepEqual(repeated.document, migrated.document);
  assert.equal(repeated.contentSha256, migrated.contentSha256);
});

test('a different leading body H1 is normalized to H2 while the exact original remains preserved', () => {
  const html = '<h1>Body heading</h1><p>Text</p>';
  const migrated = migrateLegacyHtml({ html, title: 'Article title' });
  assert.equal(migrated.legacyHtmlOriginal, html);
  assert.equal(migrated.renderedHtml, '<h2>Body heading</h2><p>Text</p>');
});

for (const [label, html, expectedCode] of [
  ['underline', '<p><u>Underline</u></p>', 'unsupported-legacy-element'],
  ['strike', '<p><s>Strike</s></p>', 'unsupported-legacy-element'],
  ['code', '<pre><code>const unsafeScope = true</code></pre>', 'unsupported-legacy-element'],
  ['table', '<table><tr><td>Cell</td></tr></table>', 'unsupported-legacy-element'],
  ['image', '<p>Text</p><img src="data:image/png;base64,unsafe">', 'unsupported-legacy-element'],
  ['raw script', '<p>Text</p><script>alert(1)</script>', 'unsupported-legacy-element'],
  ['event handler', '<p onclick="alert(1)">Text</p>', 'unsupported-legacy-attribute'],
  ['unsafe link', '<p><a href="javascript:alert(1)">Bad</a></p>', 'unsafe-legacy-link'],
  ['unknown callout', '<aside class="marketing"><p>Text</p></aside>', 'unsupported-legacy-callout'],
]) {
  test(`legacy migration fails closed for ${label}`, () => {
    assert.throws(
      () => migrateLegacyHtml({ html, title: 'Title' }),
      (error) => error instanceof StudioContentError && error.code === expectedCode,
    );
  });
}

test('structured content validation rejects excluded nodes, marks and heading levels', () => {
  const base = { format: 'tiptap-json', schemaVersion: 1, registryVersion: 'ai-91-v1' };
  for (const content of [
    { type: 'doc', content: [{ type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'H1' }] }] },
    { type: 'doc', content: [{ type: 'codeBlock', content: [{ type: 'text', text: 'code' }] }] },
    { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'strike' }], text: 'strike' }] }] },
  ]) {
    assert.throws(() => assertContentDocument({ ...base, content }), StudioContentError);
  }
});

test('governed images require immutable asset IDs and accessible metadata', () => {
  const assetId = '11111111-2222-4333-8444-555555555555';
  const document = createContentDocument({
    type: 'doc',
    content: [{
      type: 'image',
      attrs: { assetId, alt: 'A process diagram', decorative: false, caption: 'Delivery flow' },
    }],
  });
  const html = renderContentDocument(document);
  assert.match(html, new RegExp(`src="/content-assets/${assetId}"`));
  assert.match(html, /alt="A process diagram"/);
  assert.match(html, /<figcaption>Delivery flow<\/figcaption>/);

  for (const attrs of [
    { assetId: 'not-an-asset', alt: 'Diagram', decorative: false, caption: '' },
    { assetId, alt: '', decorative: false, caption: '' },
    { assetId, alt: 'Must be empty', decorative: true, caption: '' },
  ]) {
    assert.throws(() => createContentDocument({ type: 'doc', content: [{ type: 'image', attrs }] }), /image|alternative text/i);
  }
});

test('migration and structured validation enforce UTF-8 size and depth limits', () => {
  assert.throws(
    () => migrateLegacyHtml({ html: `<p>${'a'.repeat(430_000)}</p>`, title: 'Large' }),
    (error) => error instanceof StudioContentError && error.code === 'combined-migration-size-limit',
  );
  assert.throws(
    () => migrateLegacyHtml({ html: `<p>${'परामर्श'.repeat(30_000)}</p>`, title: 'Unicode size' }),
    (error) => error instanceof StudioContentError && error.code === 'invalid-legacy-size',
  );

  let content = { type: 'paragraph', content: [{ type: 'text', text: 'Deep' }] };
  for (let index = 0; index < 101; index += 1) content = { type: 'callout', content: [content] };
  assert.throws(
    () => assertContentDocument({
      format: 'tiptap-json', schemaVersion: 1, registryVersion: 'ai-91-v1',
      content: { type: 'doc', content: [content] },
    }),
    (error) => error instanceof StudioContentError && error.code === 'json-complexity-limit',
  );
});

for (const [label, html, expectedCode] of [
  ['unsafe title attribute', '<h1 onclick="alert(1)">Title</h1><p>Body</p>', 'unsupported-legacy-attribute'],
  ['media inside removable title', '<h1><img src="x">Title</h1><p>Body</p>', 'unsupported-legacy-element'],
  ['script inside removable title', '<h1><script>alert(1)</script>Title</h1><p>Body</p>', 'unsupported-legacy-element'],
]) {
  test(`leading title validation rejects ${label} before normalization`, () => {
    assert.throws(
      () => migrateLegacyHtml({ html, title: 'Title' }),
      (error) => error instanceof StudioContentError && error.code === expectedCode,
    );
  });
}

test('legacy failures report positions in the exact preserved original', () => {
  const html = '<h1>Title</h1><p>Body</p><table><tr><td>Cell</td></tr></table>';
  const position = html.indexOf('<table>');
  assert.throws(
    () => migrateLegacyHtml({ html, title: 'Title' }),
    (error) => error instanceof StudioContentError
      && error.code === 'unsupported-legacy-element'
      && error.element === 'table'
      && error.position === position,
  );
});

for (const [label, html] of [
  ['orphan list item', '<li><p>Orphan</p></li>'],
  ['block quote nested in paragraph', '<p>Before<blockquote><p>Quote</p></blockquote></p>'],
  ['stray closing tag', '<p>Body</p></aside>'],
]) {
  test(`legacy migration rejects malformed structure: ${label}`, () => {
    assert.throws(
      () => migrateLegacyHtml({ html, title: 'Title' }),
      (error) => error instanceof StudioContentError && error.code === 'invalid-legacy-structure',
    );
  });
}

test('the real ProseMirror schema rejects invalid JSON trees and malformed mark arrays', () => {
  const wrap = (content) => ({
    format: 'tiptap-json', schemaVersion: 1, registryVersion: 'ai-91-v1', content,
  });
  for (const content of [
    { type: 'doc', content: [{ type: 'text', text: 'Orphan' }] },
    { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Nested' }] }] }] },
    { type: 'doc', content: [{ type: 'horizontalRule', content: [{ type: 'paragraph' }] }] },
    { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Marks', marks: { type: 'bold' } }] }] },
    { type: 'doc', content: [] },
  ]) {
    assert.throws(() => assertContentDocument(wrap(content)), StudioContentError);
  }
});

test('canonical JSON serialization and hashes ignore object key insertion order', () => {
  const first = { format: 'tiptap-json', schemaVersion: 1, content: { type: 'doc', content: [{ type: 'paragraph' }] } };
  const reordered = { content: { content: [{ type: 'paragraph' }], type: 'doc' }, schemaVersion: 1, format: 'tiptap-json' };
  assert.equal(stableJson(first), stableJson(reordered));
  assert.equal(sha256(stableJson(first)), sha256(stableJson(reordered)));
});

test('link policy accepts only complete http, https and mailto URLs', () => {
  for (const href of ['http://example.com', 'https://example.com/path', 'mailto:editor@example.com']) {
    assert.doesNotThrow(() => migrateLegacyHtml({ html: `<p><a href="${href}">Safe</a></p>`, title: 'Title' }));
  }
  for (const href of ['//example.com', 'javascript:alert(1)', 'data:text/html,bad', 'blob:https://example.com/id']) {
    assert.throws(
      () => migrateLegacyHtml({ html: `<p><a href="${href}">Unsafe</a></p>`, title: 'Title' }),
      (error) => error instanceof StudioContentError && error.code === 'unsafe-legacy-link',
    );
  }
});

test('structured node-count boundary permits 10,000 total nodes and rejects the next node', () => {
  const wrap = (paragraphs) => ({
    format: 'tiptap-json', schemaVersion: 1, registryVersion: 'ai-91-v1',
    content: { type: 'doc', content: Array.from({ length: paragraphs }, () => ({ type: 'paragraph' })) },
  });
  assert.doesNotThrow(() => assertContentDocument(wrap(9_999)));
  assert.throws(
    () => assertContentDocument(wrap(10_000)),
    (error) => error instanceof StudioContentError && error.code === 'json-complexity-limit',
  );
});

test('malformed tag fragments fail closed at the original source offset', () => {
  const html = '<p>Before <img src="x" after</p>';
  const position = html.indexOf('<img');
  assert.throws(
    () => migrateLegacyHtml({ html, title: 'Title' }),
    (error) => error instanceof StudioContentError
      && error.code === 'malformed-legacy-markup'
      && error.position === position,
  );
});

for (const attribute of ['href', 'title']) {
  test(`duplicate ${attribute} attributes fail closed`, () => {
    const html = attribute === 'href'
      ? '<p><a href="https://one.example" HREF="https://two.example">Link</a></p>'
      : '<p><a href="https://example.com" title="One" TITLE="Two">Link</a></p>';
    assert.throws(
      () => migrateLegacyHtml({ html, title: 'Title' }),
      (error) => error instanceof StudioContentError
        && error.code === 'duplicate-legacy-attribute'
        && error.attribute === attribute
        && error.position === html.indexOf('<a '),
    );
  });
}
