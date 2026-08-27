import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';

import {
  assertDraftAssetsReady,
  createStudioImageAsset,
  resolveStudioContentAsset,
  validateStudioImageDescription,
  validateStudioImageUpload,
} from '../server/studio-content-assets.mjs';

const clone = (value) => value === undefined ? undefined : structuredClone(value);

class FakeSnapshot {
  constructor(value) {
    this.value = value;
    this.exists = value !== undefined;
  }
  data() { return clone(this.value); }
}

class FakeDb {
  constructor(initial = {}) {
    this.records = new Map(Object.entries(initial).map(([key, value]) => [key, clone(value)]));
    this.sequence = 0;
  }
  collection(name) {
    const database = this;
    return {
      doc: (id = `generated-${++database.sequence}`) => ({
        id,
        path: `${name}/${id}`,
        get: async () => new FakeSnapshot(database.records.get(`${name}/${id}`)),
        set: async (value, options) => {
          const path = `${name}/${id}`;
          database.records.set(path, options?.merge
            ? { ...clone(database.records.get(path) ?? {}), ...clone(value) }
            : clone(value));
        },
      }),
    };
  }
  async runTransaction(callback) {
    const operations = [];
    const transaction = {
      get: async (reference) => new FakeSnapshot(this.records.get(reference.path)),
      create: (reference, value) => operations.push({ type: 'create', reference, value }),
      set: (reference, value) => operations.push({ type: 'set', reference, value }),
      update: (reference, value) => operations.push({ type: 'update', reference, value }),
    };
    const result = await callback(transaction);
    for (const operation of operations) {
      const path = operation.reference.path;
      const current = this.records.get(path);
      if (operation.type === 'create' && current !== undefined) throw new Error('Document already exists');
      if (operation.type === 'update' && current === undefined) throw new Error('Document does not exist');
      this.records.set(path, operation.type === 'update'
        ? { ...clone(current), ...clone(operation.value) }
        : clone(operation.value));
    }
    return result;
  }
}

const headerOnlyPng = (width = 640, height = 360) => {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(25);
  ihdr.writeUInt32BE(13, 0);
  ihdr.write('IHDR', 4, 'ascii');
  ihdr.writeUInt32BE(width, 8);
  ihdr.writeUInt32BE(height, 12);
  ihdr[16] = 8;
  ihdr[17] = 6;
  const iend = Buffer.alloc(12);
  iend.write('IEND', 4, 'ascii');
  return Buffer.concat([signature, ihdr, iend]);
};

const source = { create: { width: 8, height: 6, channels: 4, background: { r: 36, g: 78, b: 157, alpha: 1 } } };
const validPng = await sharp(source).png().toBuffer();
const validJpeg = await sharp(source).jpeg().toBuffer();
const validWebp = await sharp(source).webp({ lossless: true }).toBuffer();
const png = () => Buffer.from(validPng);
const jpeg = () => Buffer.from(validJpeg);
const webp = () => Buffer.from(validWebp);

const assetId = '11111111-2222-4333-8444-555555555555';
const draftRecord = {
  format: 'tiptap-json', ownerUid: 'author-1', archivedAt: undefined,
};

const fakeBucket = ({ failSave = false } = {}) => {
  const calls = [];
  return {
    calls,
    file: (path, options) => ({
      path,
      options,
      save: async (bytes, saveOptions) => {
        calls.push({ path, bytes: Buffer.from(bytes), saveOptions });
        if (failSave) throw new Error('storage unavailable');
      },
      getMetadata: async () => [{ generation: '7' }],
      createReadStream: () => ({ pipe: () => {} }),
    }),
  };
};

test('server decodes and re-encodes real PNG, JPEG, and WebP images', async () => {
  const validatedPng = await validateStudioImageUpload({ bytes: png(), mimeType: 'image/png' });
  assert.deepEqual({ mimeType: validatedPng.mimeType, extension: validatedPng.extension, width: validatedPng.width, height: validatedPng.height }, {
    mimeType: 'image/png', extension: 'png', width: 8, height: 6,
  });
  assert.equal((await sharp(validatedPng.bytes).metadata()).format, 'png');
  assert.equal((await validateStudioImageUpload({ bytes: jpeg(), mimeType: 'image/jpeg' })).width, 8);
  assert.equal((await validateStudioImageUpload({ bytes: webp(), mimeType: 'image/webp' })).height, 6);
  await assert.rejects(validateStudioImageUpload({ bytes: png(), mimeType: 'image/jpeg' }), /JPEG image/);
  await assert.rejects(validateStudioImageUpload({ bytes: Buffer.concat([png(), Buffer.from('<script>')]), mimeType: 'image/png' }), /trailing/);
  await assert.rejects(validateStudioImageUpload({ bytes: headerOnlyPng(12_000, 20), mimeType: 'image/png' }), /dimensions/);
  await assert.rejects(validateStudioImageUpload({ bytes: headerOnlyPng(), mimeType: 'image/png' }), /corrupt|decoded/);
  await assert.rejects(validateStudioImageUpload({ bytes: png(), mimeType: 'image/svg+xml' }), /SVG/);
});

test('image description requires alt text or an explicit decorative choice', () => {
  assert.deepEqual(validateStudioImageDescription({ alt: 'A clear diagram', decorative: false, caption: 'Architecture' }), {
    alt: 'A clear diagram', decorative: false, caption: 'Architecture',
  });
  assert.deepEqual(validateStudioImageDescription({ alt: '', decorative: true, caption: '' }), {
    alt: '', decorative: true, caption: '',
  });
  assert.throws(() => validateStudioImageDescription({ alt: '', decorative: false, caption: '' }), /alternative text/);
  assert.throws(() => validateStudioImageDescription({ alt: 'Must be empty', decorative: true, caption: '' }), /alternative text/);
});

test('authorized upload creates a private immutable ready asset and audit event', async () => {
  const db = new FakeDb({
    'studioAccess/author-1': { active: true, role: 'author' },
    'contentDrafts/draft-1': draftRecord,
  });
  const bucket = fakeBucket();
  const result = await createStudioImageAsset({
    db, bucket, draftId: 'draft-1', publisherUid: 'author-1', assetId,
    bytes: png(), mimeType: 'image/png', alt: 'Diagram', decorative: false, caption: '',
    now: new Date('2026-08-26T20:00:00.000Z'),
  });

  assert.equal(result.url, `/content-assets/${assetId}`);
  assert.equal(db.records.get(`contentAssets/${assetId}`).status, 'ready');
  assert.equal(db.records.get(`contentAssets/${assetId}`).generation, '7');
  assert.equal(bucket.calls.length, 1);
  assert.equal(bucket.calls[0].saveOptions.preconditionOpts.ifGenerationMatch, 0);
  assert.equal(bucket.calls[0].saveOptions.metadata.cacheControl, 'no-store');
  assert.equal([...db.records.values()].some((value) => value.action === 'image-upload' && value.assetId === assetId), true);
});

test('unauthorized or failed uploads never change the draft or expose an asset', async () => {
  const baseline = clone(draftRecord);
  const unauthorizedDb = new FakeDb({
    'studioAccess/author-2': { active: true, role: 'author' },
    'contentDrafts/draft-1': draftRecord,
  });
  await assert.rejects(createStudioImageAsset({
    db: unauthorizedDb, bucket: fakeBucket(), draftId: 'draft-1', publisherUid: 'author-2', assetId,
    bytes: png(), mimeType: 'image/png', alt: 'Diagram', decorative: false, caption: '',
  }), /drafts they own/);
  assert.deepEqual(unauthorizedDb.records.get('contentDrafts/draft-1'), baseline);
  assert.equal(unauthorizedDb.records.has(`contentAssets/${assetId}`), false);

  const failedDb = new FakeDb({
    'studioAccess/author-1': { active: true, role: 'author' },
    'contentDrafts/draft-1': draftRecord,
  });
  await assert.rejects(createStudioImageAsset({
    db: failedDb, bucket: fakeBucket({ failSave: true }), draftId: 'draft-1', publisherUid: 'author-1', assetId,
    bytes: png(), mimeType: 'image/png', alt: 'Diagram', decorative: false, caption: '',
  }), /article was not changed/);
  assert.equal(failedDb.records.get(`contentAssets/${assetId}`).status, 'failed');
  assert.deepEqual(failedDb.records.get('contentDrafts/draft-1'), baseline);
});

test('draft assets stay private until an active publication reference exists', async () => {
  const asset = {
    id: assetId, draftId: 'draft-1', ownerUid: 'author-1', status: 'ready',
    objectPath: `studio-content/draft-1/${assetId}.png`, generation: '7',
    contentType: 'image/png', size: png().length,
    width: 640, height: 360,
  };
  const db = new FakeDb({
    [`contentAssets/${assetId}`]: asset,
    'studioAccess/author-1': { active: true, role: 'author' },
    'contentDrafts/draft-1': draftRecord,
  });
  const bucket = fakeBucket();
  await assert.rejects(resolveStudioContentAsset({ db, bucket, assetId, user: null }), /Sign in/);
  const privateResult = await resolveStudioContentAsset({ db, bucket, assetId, user: { uid: 'author-1' } });
  assert.equal(privateResult.isPublic, false);
  assert.equal(privateResult.file.options.generation, '7');

  db.records.set(`contentAssetPublicRefs/${assetId}`, { active: true, draftId: 'draft-1' });
  const publicResult = await resolveStudioContentAsset({ db, bucket, assetId, user: null });
  assert.equal(publicResult.isPublic, true);
  await assertDraftAssetsReady({ db, draftId: 'draft-1', assetIds: [assetId] });
  await assert.rejects(assertDraftAssetsReady({ db, draftId: 'other-draft', assetIds: [assetId] }), /does not belong/);
});
