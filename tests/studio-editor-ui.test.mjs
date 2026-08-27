import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  closeToolbarMenuAndFocusSummary,
  evaluateStudioClipboardPaste,
  evaluateStudioPasteHtml,
  nextToolbarControlIndex,
} from '../src/scripts/studio-toolbar-navigation.mjs';
import { createStudioImageOperationCoordinator } from '../src/scripts/studio-image-operations.mjs';
import { captureStudioPreviewState, isStudioPreviewStateCurrent } from '../src/scripts/studio-preview-operations.mjs';

test('an edit during delayed preview cannot restore publication readiness', async () => {
  let current = {
    editVersion: 7,
    updatedAt: '2026-08-26T15:00:00.000Z',
    revision: 4,
    contentSha256: 'a'.repeat(64),
    hasUnsavedChanges: false,
  };
  const captured = captureStudioPreviewState(current);
  let finishPreview;
  const delayedPreview = new Promise((resolve) => { finishPreview = resolve; })
    .then(() => isStudioPreviewStateCurrent(captured, current));

  current = { ...current, editVersion: 8, hasUnsavedChanges: true };
  finishPreview();
  assert.equal(await delayedPreview, false);
});

test('cancelled or superseded image uploads cannot mutate the article', async () => {
  const operations = createStudioImageOperationCoordinator();
  let applyCount = 0;
  let resolveFirst;
  const firstUpload = new Promise((resolve) => { resolveFirst = resolve; });
  const first = operations.begin({ targetAssetId: 'first' });
  const delayedCompletion = firstUpload.then(() => operations.complete(first, () => {
    applyCount += 1;
    return true;
  }));

  operations.cancel();
  const second = operations.begin({ targetAssetId: 'second' });
  resolveFirst();
  assert.equal(await delayedCompletion, false);
  assert.equal(applyCount, 0);
  assert.equal(first.controller.signal.aborted, true);

  assert.equal(operations.complete(second, () => {
    applyCount += 1;
    return true;
  }), true);
  assert.equal(applyCount, 1);

  const submittedDescription = Object.freeze({ alt: 'Architecture diagram', decorative: false, caption: 'System' });
  const descriptionOperation = operations.begin({ description: submittedDescription });
  let currentDecorativeChoice = true;
  let appliedDescription;
  assert.equal(operations.complete(descriptionOperation, ({ description }) => {
    appliedDescription = description;
    return true;
  }), true);
  assert.equal(currentDecorativeChoice, true);
  assert.deepEqual(appliedDescription, submittedDescription);
});

const loadEditorSources = async () => Promise.all([
  readFile(new URL('../src/pages/studio/index.astro', import.meta.url), 'utf8'),
  readFile(new URL('../src/scripts/studio-tiptap-schema.mjs', import.meta.url), 'utf8'),
]);

test('professional editor exposes the approved understandable formatting controls', async () => {
  const [studio] = await loadEditorSources();

  assert.match(studio, /role="toolbar" aria-label="Article formatting"/);
  assert.match(studio, /data-text-style[\s\S]*Paragraph[\s\S]*Heading 2[\s\S]*Heading 3/);
  for (const action of [
    'bold', 'italic', 'link', 'bulletList', 'orderedList', 'liftListItem', 'sinkListItem',
    'blockquote', 'callout', 'horizontalRule', 'undo', 'redo',
  ]) {
    assert.match(studio, new RegExp(`data-editor-action="${action}"`), action);
  }

  assert.match(studio, /data-link-dialog aria-labelledby="studio-link-title"/);
  assert.match(studio, /Select the text you want to link, then choose Link/);
  assert.match(studio, /aria-pressed="false"/);
  assert.match(studio, /button\.setAttribute\('aria-pressed'/);
  assert.match(studio, /button\.disabled = !canRunEditorAction\(action\)/);
  assert.equal(studio.includes('window.prompt('), false);
  assert.equal(studio.includes('data-command='), false);
  assert.equal(studio.includes('data-block='), false);
});

test('toolbar keyboard, paste, and narrow-screen behavior remain explicit', async () => {
  const [studio] = await loadEditorSources();

  assert.match(studio, /aria-keyshortcuts="Control\+B Meta\+B"/);
  assert.match(studio, /aria-keyshortcuts="Control\+I Meta\+I"/);
  assert.match(studio, /aria-keyshortcuts="Control\+K Meta\+K"/);
  assert.match(studio, /event\.altKey && event\.key === 'F10'/);
  assert.match(studio, /\['ArrowLeft', 'ArrowRight', 'Home', 'End'\]/);
  assert.match(studio, /setToolbarTabStop/);
  assert.match(studio, /transformPastedHTML: normalizePastedHtml/);
  assert.match(studio, /handlePaste: \(_view, event\)/);
  assert.match(studio, /event\.preventDefault\(\);[\s\S]*showToast\(result\.message\);[\s\S]*return true;/);
  assert.match(studio, /querySelectorAll\('script, style, iframe, object, embed'\)/);
  assert.match(studio, /parsed\.querySelectorAll\('h1'\)/);
  assert.match(studio, /\.studio-toolbar-more \{ display: block/);
  assert.match(studio, /grid-template-columns: minmax\(100px, 1fr\) repeat\(4, 40px\)/);
  assert.match(studio, /\.studio-toolbar-wide \{ display: none !important; \}/);
  assert.match(studio, /min-height: 44px/);
});

test('Style participates in desktop and mobile roving toolbar navigation', () => {
  const desktopControlCount = 12;
  const mobileControlCount = 5;
  assert.equal(nextToolbarControlIndex('ArrowRight', 0, desktopControlCount), 1);
  assert.equal(nextToolbarControlIndex('ArrowLeft', 0, desktopControlCount), desktopControlCount - 1);
  assert.equal(nextToolbarControlIndex('End', 0, mobileControlCount), mobileControlCount - 1);
  assert.equal(nextToolbarControlIndex('Home', mobileControlCount - 1, mobileControlCount), 0);
  assert.equal(nextToolbarControlIndex('ArrowRight', mobileControlCount - 1, mobileControlCount), 0);
});

test('closing an Insert or mobile More menu restores focus to its visible summary', () => {
  let focused = false;
  const summary = { focus: () => { focused = true; } };
  const menu = { open: true, querySelector: (selector) => selector === 'summary' ? summary : null };
  const control = { closest: (selector) => selector === 'details' ? menu : null };

  assert.equal(closeToolbarMenuAndFocusSummary(control), true);
  assert.equal(menu.open, false);
  assert.equal(focused, true);
});

test('Word, Docs, code, and image paste cannot silently lose unsupported structure', () => {
  const goldenRejectedPastes = [
    '<table class="MsoTableGrid"><tr><td>Alpha</td><td>Beta</td></tr></table>',
    '<table><tbody><tr><td><p>Google Docs A</p></td><td><p>Google Docs B</p></td></tr></tbody></table>',
    '<pre><code>const answer = 42;</code></pre>',
    '<p>Before</p><img src="data:image/png;base64,AAAA" alt="diagram"><p>After</p>',
  ];
  for (const html of goldenRejectedPastes) {
    const result = evaluateStudioPasteHtml(html);
    assert.equal(result.accepted, false, html);
    assert.match(result.message, /Use Paste as plain text instead/);
    assert.ok(result.unsupportedTags.length > 0);
  }

  assert.deepEqual(evaluateStudioPasteHtml('<h2>Heading</h2><p><strong>Safe</strong> text</p><ul><li>One</li></ul>'), {
    accepted: true,
    unsupportedTags: [],
    message: '',
  });
});

test('file-only clipboard images are rejected visibly before the editor can mutate', () => {
  const screenshotPaste = evaluateStudioClipboardPaste({
    html: '',
    items: [{ kind: 'file', type: 'image/png' }],
    files: [{ type: 'image/png' }],
  });
  assert.equal(screenshotPaste.accepted, false);
  assert.deepEqual(screenshotPaste.unsupportedTags, ['clipboard-file']);
  assert.match(screenshotPaste.message, /Pasted files and images are not supported yet/);
  assert.match(screenshotPaste.message, /Paste as plain text/);

  assert.deepEqual(evaluateStudioClipboardPaste({
    html: '',
    items: [{ kind: 'string', type: 'text/plain' }],
    files: [],
  }), { accepted: true, unsupportedTags: [], message: '' });
});

test('the editor schema excludes word-processor styling that the publisher does not support', async () => {
  const [studio, schema] = await loadEditorSources();

  assert.match(schema, /heading: \{ levels: \[2, 3\] \}/);
  assert.match(schema, /strike: false/);
  assert.match(schema, /underline: false/);
  assert.match(schema, /code: false/);
  assert.match(schema, /codeBlock: false/);
  for (const excluded of ['underline', 'strike', 'fontFamily', 'fontSize', 'textColor', 'highlight']) {
    assert.equal(studio.includes(`data-editor-action="${excluded}"`), false, excluded);
  }
});

test('image UX changes the editor only after governed upload success', async () => {
  const [studio] = await loadEditorSources();
  const [backend, schema, server] = await Promise.all([
    readFile(new URL('../src/scripts/studio-firebase.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/scripts/studio-tiptap-schema.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../server/server.mjs', import.meta.url), 'utf8'),
  ]);

  assert.match(studio, /data-editor-action="image"/);
  assert.match(studio, /accept="image\/png,image\/jpeg,image\/webp"/);
  assert.match(studio, /data-image-alt/);
  assert.match(studio, /data-image-decorative/);
  assert.match(studio, /Add alternative text or mark the image as decorative/);
  assert.match(studio, /if \(!await persist\(false\)\)[\s\S]*studioBackend\.uploadImage/);
  assert.match(studio, /uploadImage[\s\S]*updateAttributes\('image', attrs\)/);
  assert.match(studio, /deleteSelection\(\)\.run\(\)[\s\S]*Undo is available/);
  assert.match(backend, /new FormData\(\)/);
  assert.match(backend, /\/api\/content\/drafts\/\$\{encodeURIComponent\(id\)\}\/images/);
  assert.match(backend, /loadImage:[\s\S]*Authorization:[\s\S]*cache: 'no-store'/);
  assert.match(schema, /configureStudioImageLoader/);
  assert.match(schema, /studioImageLoader\(String\(assetId\)\)[\s\S]*URL\.createObjectURL/);
  assert.match(schema, /await image\.decode\(\)/);
  assert.match(studio, /configureStudioImageLoader\(\(assetId\) => studioBackend\.loadImage\(assetId\)\)/);
  assert.match(studio, /hydratePrivatePreviewImages[\s\S]*studioBackend\.loadImage\(assetId\)/);
  assert.match(studio, /hydratePrivatePreviewImages[\s\S]*await image\.decode\(\)/);
  assert.match(studio, /imageOperations\.cancel\(\)[\s\S]*imageDialog\.close\(\)/);
  assert.match(studio, /imageOperations\.complete\(operation/);
  assert.match(studio, /const description = Object\.freeze\(/);
  assert.match(studio, /setImageFormBusy\(true\)/);
  assert.match(studio, /const attrs = \{ assetId, \.\.\.description \}/);
  assert.match(studio, /clearPreviewImageUrls[\s\S]*URL\.revokeObjectURL/);
  assert.match(server, /'Cache-Control': 'no-store'/);
  assert.match(server, /'Vary': 'Authorization'/);
});
