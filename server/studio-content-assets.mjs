import { randomUUID } from 'node:crypto';
import sharp from 'sharp';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_IMAGE_EDGE = 10_000;
const MAX_IMAGE_PIXELS = 40_000_000;
const MAX_DRAFT_IMAGES = 50;
const ASSET_ID_PATTERN = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;

const fail = (message, statusCode = 400) => {
  throw Object.assign(new Error(message), { statusCode });
};

const assertDimensions = (width, height) => {
  if (
    !Number.isInteger(width) || !Number.isInteger(height)
    || width < 1 || height < 1
    || width > MAX_IMAGE_EDGE || height > MAX_IMAGE_EDGE
    || width * height > MAX_IMAGE_PIXELS
  ) fail('The image dimensions are too large or invalid.');
  return { width, height };
};

const pngMetadata = (bytes) => {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (bytes.length < 33 || !bytes.subarray(0, 8).equals(signature)) fail('The file is not a valid PNG image.');
  let offset = 8;
  let dimensions;
  let ended = false;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    const next = offset + 12 + length;
    if (next > bytes.length) fail('The PNG image is truncated.');
    if (offset === 8 && (type !== 'IHDR' || length !== 13)) fail('The PNG header is invalid.');
    if (type === 'IHDR') dimensions = assertDimensions(bytes.readUInt32BE(offset + 8), bytes.readUInt32BE(offset + 12));
    if (type === 'IEND') {
      if (length !== 0 || next !== bytes.length) fail('The PNG image contains trailing or invalid data.');
      ended = true;
      break;
    }
    offset = next;
  }
  if (!ended || !dimensions) fail('The PNG image is incomplete.');
  return dimensions;
};

const jpegMetadata = (bytes) => {
  if (bytes.length < 12 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes.at(-2) !== 0xff || bytes.at(-1) !== 0xd9) {
    fail('The file is not a complete JPEG image.');
  }
  let offset = 2;
  let dimensions;
  while (offset < bytes.length - 2) {
    if (bytes[offset] !== 0xff) fail('The JPEG marker structure is invalid.');
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset++];
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length) fail('The JPEG image is truncated.');
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) fail('The JPEG segment length is invalid.');
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      if (length < 7) fail('The JPEG dimensions are invalid.');
      dimensions = assertDimensions(bytes.readUInt16BE(offset + 5), bytes.readUInt16BE(offset + 3));
    }
    offset += length;
  }
  if (!dimensions) fail('The JPEG image has no valid dimensions.');
  return dimensions;
};

const uint24le = (bytes, offset) => bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);

const webpMetadata = (bytes) => {
  if (
    bytes.length < 25
    || bytes.toString('ascii', 0, 4) !== 'RIFF'
    || bytes.toString('ascii', 8, 12) !== 'WEBP'
    || bytes.readUInt32LE(4) + 8 !== bytes.length
  ) fail('The file is not a complete WebP image.');
  const kind = bytes.toString('ascii', 12, 16);
  if (kind === 'VP8X' && bytes.length >= 30) {
    return assertDimensions(uint24le(bytes, 24) + 1, uint24le(bytes, 27) + 1);
  }
  if (kind === 'VP8L' && bytes.length >= 25 && bytes[20] === 0x2f) {
    const width = 1 + bytes[21] + ((bytes[22] & 0x3f) << 8);
    const height = 1 + ((bytes[22] & 0xc0) >> 6) + (bytes[23] << 2) + ((bytes[24] & 0x0f) << 10);
    return assertDimensions(width, height);
  }
  if (kind === 'VP8 ' && bytes.length >= 30 && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
    return assertDimensions(bytes.readUInt16LE(26) & 0x3fff, bytes.readUInt16LE(28) & 0x3fff);
  }
  fail('The WebP image header is invalid.');
};

export const validateStudioImageUpload = async ({ bytes: input, mimeType }) => {
  const bytes = Buffer.isBuffer(input) ? input : Buffer.from(input ?? []);
  if (!bytes.length) fail('Choose an image file to upload.');
  if (bytes.length > MAX_IMAGE_BYTES) fail('Images must be 5 MB or smaller.', 413);
  const type = String(mimeType ?? '').toLowerCase();
  const formats = {
    'image/png': { extension: 'png', dimensions: pngMetadata },
    'image/jpeg': { extension: 'jpg', dimensions: jpegMetadata },
    'image/webp': { extension: 'webp', dimensions: webpMetadata },
  };
  const format = formats[type];
  if (!format) fail('Use a PNG, JPEG, or WebP image. SVG and embedded media are not allowed.');
  format.dimensions(bytes);
  try {
    const decoder = sharp(bytes, {
      animated: false,
      failOn: 'error',
      limitInputPixels: MAX_IMAGE_PIXELS,
      sequentialRead: true,
    });
    const metadata = await decoder.metadata();
    const expectedFormat = type === 'image/jpeg' ? 'jpeg' : format.extension;
    if (metadata.format !== expectedFormat || Number(metadata.pages ?? 1) !== 1) {
      fail('The image format does not match the uploaded file or contains unsupported animation.');
    }
    const normalized = decoder.rotate();
    if (type === 'image/png') normalized.png({ compressionLevel: 9 });
    else if (type === 'image/jpeg') normalized.jpeg({ quality: 92, chromaSubsampling: '4:4:4' });
    else normalized.webp({ lossless: true, effort: 4 });
    const { data, info } = await normalized.toBuffer({ resolveWithObject: true });
    const dimensions = assertDimensions(info.width, info.height);
    if (!data.length || data.length > MAX_IMAGE_BYTES) fail('The validated image must be 5 MB or smaller.', 413);
    return {
      bytes: data,
      mimeType: type,
      extension: format.extension,
      size: data.length,
      ...dimensions,
    };
  } catch (error) {
    if (error?.statusCode) throw error;
    fail('The image is corrupt or cannot be safely decoded.');
  }
};

export const validateStudioImageDescription = ({ alt, decorative, caption }) => {
  const normalizedAlt = String(alt ?? '').trim();
  const normalizedCaption = String(caption ?? '').trim();
  if (decorative !== true && decorative !== false) fail('Choose whether the image is decorative.');
  if (normalizedAlt.length > 500 || normalizedCaption.length > 1_000) fail('Image description or caption is too long.');
  if ((decorative && normalizedAlt) || (!decorative && !normalizedAlt)) {
    fail('Add alternative text or mark the image as decorative.');
  }
  return { alt: decorative ? '' : normalizedAlt, decorative, caption: normalizedCaption };
};

const readDocument = async (reference, transaction) => {
  const snapshot = transaction ? await transaction.get(reference) : await reference.get();
  return snapshot.exists ? snapshot.data() : null;
};

const assertReadyAssetRecord = (record, assetId, draftId) => {
  const extensions = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
  const extension = extensions[record?.contentType];
  const expectedPath = extension ? `studio-content/${draftId}/${assetId}.${extension}` : '';
  if (
    !record
    || record.id !== assetId
    || record.draftId !== draftId
    || record.status !== 'ready'
    || record.objectPath !== expectedPath
    || !/^\d+$/.test(String(record.generation ?? ''))
    || !Number.isInteger(record.size) || record.size < 1 || record.size > MAX_IMAGE_BYTES
  ) fail('An image is unavailable or does not belong to this draft.', 409);
  assertDimensions(record.width, record.height);
  return record;
};

const assertDraftEditor = (access, draft, uid) => {
  if (!access || access.active !== true || !['administrator', 'publisher', 'author'].includes(access.role)) {
    fail('Author, Publisher or Administrator access is required.', 403);
  }
  if (!draft) fail('Save the cloud draft before adding an image.', 409);
  if (access.role === 'author' && draft.ownerUid !== uid) fail('Authors can add images only to drafts they own.', 403);
  if (draft.archivedAt) fail('Restore this draft before adding images.', 409);
  if (draft.format !== 'tiptap-json') fail('Convert this draft before adding images.', 409);
};

export const assertDraftAssetsReady = async ({ db, transaction, draftId, assetIds }) => {
  const ids = [...new Set(assetIds ?? [])].sort();
  if (ids.length > MAX_DRAFT_IMAGES) fail('An article can contain at most 50 images.');
  const records = await Promise.all(ids.map(async (assetId) => {
    if (!ASSET_ID_PATTERN.test(String(assetId))) fail('The article contains an invalid image reference.');
    const record = await readDocument(db.collection('contentAssets').doc(assetId), transaction);
    return assertReadyAssetRecord(record, assetId, draftId);
  }));
  return records;
};

export const createStudioImageAsset = async ({
  db,
  bucket,
  draftId,
  publisherUid,
  bytes,
  mimeType,
  alt,
  decorative,
  caption,
  assetId = randomUUID(),
  now = new Date(),
}) => {
  if (!ASSET_ID_PATTERN.test(String(assetId))) fail('The generated image ID is invalid.', 500);
  if (!bucket?.file) fail('Image storage is unavailable.', 503);
  const image = await validateStudioImageUpload({ bytes, mimeType });
  const description = validateStudioImageDescription({ alt, decorative, caption });
  const createdAt = now.toISOString();
  const objectPath = `studio-content/${draftId}/${assetId}.${image.extension}`;
  const assetRef = db.collection('contentAssets').doc(assetId);
  const auditRef = db.collection('contentAuditEvents').doc();

  await db.runTransaction(async (transaction) => {
    const [access, draft, existing] = await Promise.all([
      readDocument(db.collection('studioAccess').doc(publisherUid), transaction),
      readDocument(db.collection('contentDrafts').doc(draftId), transaction),
      readDocument(assetRef, transaction),
    ]);
    assertDraftEditor(access, draft, publisherUid);
    if (existing) fail('The generated image ID is already in use.', 409);
    transaction.create(assetRef, {
      id: assetId,
      draftId,
      ownerUid: draft.ownerUid,
      objectPath,
      contentType: image.mimeType,
      size: image.size,
      width: image.width,
      height: image.height,
      status: 'uploading',
      createdAt,
    });
  });

  const file = bucket.file(objectPath);
  try {
    await file.save(image.bytes, {
      resumable: false,
      preconditionOpts: { ifGenerationMatch: 0 },
      metadata: {
        contentType: image.mimeType,
        cacheControl: 'no-store',
        metadata: { assetId, draftId, ownerUid: publisherUid },
      },
    });
    const [objectMetadata] = await file.getMetadata();
    const readyAt = new Date(now.getTime() + 1).toISOString();
    await db.runTransaction(async (transaction) => {
      const current = await readDocument(assetRef, transaction);
      if (!current || current.status !== 'uploading' || current.objectPath !== objectPath) {
        fail('The image upload state changed unexpectedly.', 409);
      }
      transaction.update(assetRef, {
        status: 'ready',
        generation: String(objectMetadata.generation ?? ''),
        readyAt,
      });
      transaction.create(auditRef, {
        action: 'image-upload', actorUid: publisherUid, draftId, assetId, occurredAt: readyAt,
      });
    });
  } catch (error) {
    await assetRef.set({ status: 'failed', failedAt: new Date().toISOString() }, { merge: true }).catch(() => {});
    if (error?.statusCode) throw error;
    fail('The image could not be stored. Your article was not changed.', 502);
  }

  return {
    assetId,
    url: `/content-assets/${assetId}`,
    ...description,
    contentType: image.mimeType,
    size: image.size,
    width: image.width,
    height: image.height,
  };
};

export const resolveStudioContentAsset = async ({ db, bucket, assetId, user }) => {
  if (!ASSET_ID_PATTERN.test(String(assetId))) fail('Image not found.', 404);
  const [asset, publicReference] = await Promise.all([
    readDocument(db.collection('contentAssets').doc(assetId)),
    readDocument(db.collection('contentAssetPublicRefs').doc(assetId)),
  ]);
  if (!asset) fail('Image not found.', 404);
  try {
    assertReadyAssetRecord(asset, assetId, asset.draftId);
  } catch {
    fail('Image not found.', 404);
  }
  const isPublic = publicReference?.active === true && publicReference.draftId === asset.draftId;
  if (!isPublic) {
    if (!user?.uid) fail('Sign in to view this draft image.', 401);
    const [access, draft] = await Promise.all([
      readDocument(db.collection('studioAccess').doc(user.uid)),
      readDocument(db.collection('contentDrafts').doc(asset.draftId)),
    ]);
    assertDraftEditor(access, draft, user.uid);
  }
  return {
    asset,
    file: bucket.file(asset.objectPath, { generation: asset.generation }),
    isPublic,
  };
};
