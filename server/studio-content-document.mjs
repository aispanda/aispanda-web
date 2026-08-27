import { createHash } from 'node:crypto';

import { getSchema } from '@tiptap/core';
import { generateHTML, generateJSON } from '@tiptap/html/server';
import sanitizeHtml from 'sanitize-html';

import {
  STUDIO_CONTENT_FORMAT,
  STUDIO_REGISTRY_VERSION,
  STUDIO_SCHEMA_VERSION,
  studioTiptapExtensions,
} from '../src/scripts/studio-tiptap-schema.mjs';

const LEGACY_HTML_LIMIT = 500_000;
const DOCUMENT_JSON_LIMIT = 500_000;
const COMBINED_MIGRATION_LIMIT = 850_000;
const DOCUMENT_NODE_LIMIT = 10_000;
const DOCUMENT_DEPTH_LIMIT = 100;
const SAFE_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);
const ALLOWED_TAGS = new Set([
  'p', 'h2', 'h3', 'strong', 'b', 'em', 'i', 'ul', 'ol', 'li',
  'blockquote', 'hr', 'br', 'a', 'aside',
]);
const ALLOWED_ATTRIBUTES = {
  a: new Set(['href', 'title', 'target', 'rel']),
  aside: new Set(['class']),
};
const ALLOWED_NODE_TYPES = new Set([
  'doc', 'paragraph', 'text', 'heading', 'bulletList', 'orderedList',
  'listItem', 'blockquote', 'horizontalRule', 'hardBreak', 'callout', 'image',
]);
const ALLOWED_MARK_TYPES = new Set(['bold', 'italic', 'link']);
const EXPECTED_SCHEMA_NODES = [
  'blockquote', 'bulletList', 'callout', 'doc', 'hardBreak', 'heading',
  'horizontalRule', 'image', 'listItem', 'orderedList', 'paragraph', 'text',
];
const EXPECTED_SCHEMA_MARKS = ['bold', 'italic', 'link'];
const studioTiptapSchema = getSchema(studioTiptapExtensions);

export class StudioContentError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'StudioContentError';
    this.code = details.code ?? 'invalid-studio-content';
    this.position = details.position ?? -1;
    this.element = details.element ?? '';
    this.attribute = details.attribute ?? '';
  }
}

export const publicStudioContentErrorDetails = (error) => {
  if (!(error instanceof StudioContentError)) return null;
  return {
    code: String(error.code ?? 'invalid-studio-content').slice(0, 80),
    element: String(error.element ?? '').slice(0, 80),
    attribute: String(error.attribute ?? '').slice(0, 80),
    position: Number.isInteger(error.position) ? error.position : -1,
  };
};

export const sha256 = (value) => createHash('sha256').update(String(value)).digest('hex');

const canonicalize = (value) => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]),
  );
};

export const stableJson = (value) => JSON.stringify(canonicalize(value));
const utf8Bytes = (value) => Buffer.byteLength(String(value), 'utf8');

const plainText = (html) => sanitizeHtml(String(html), {
  allowedTags: [],
  allowedAttributes: {},
}).replace(/\s+/g, ' ').trim();

export const normalizeLegacyTitle = (html, title = '') => String(html).replace(
  /^\s*<h1(?:\s[^>]*)?>([\s\S]*?)<\/h1>/i,
  (_match, inner) => {
    const heading = plainText(inner);
    return heading === String(title).trim() ? '' : `<h2>${inner}</h2>`;
  },
);

const parseAttributes = (source, element, position) => {
  const attributes = [];
  const names = new Set();
  const pattern = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  let match;
  let consumed = '';
  while ((match = pattern.exec(source)) !== null) {
    const name = match[1].toLowerCase();
    const value = match[2] ?? match[3] ?? match[4] ?? '';
    if (names.has(name)) {
      throw new StudioContentError(`Duplicate ${name} attribute on <${element}>.`, {
        code: 'duplicate-legacy-attribute', element, attribute: name, position,
      });
    }
    names.add(name);
    attributes.push({ name, value });
    consumed += match[0];
  }
  const compactSource = source.replace(/[\s/]+/g, '');
  const compactConsumed = consumed.replace(/[\s/]+/g, '');
  if (compactSource !== compactConsumed) {
    throw new StudioContentError(`Malformed attributes on <${element}>.`, {
      code: 'malformed-legacy-attributes', element, position,
    });
  }
  return attributes;
};

const canonicalTag = (tag) => tag === 'b' ? 'strong' : tag === 'i' ? 'em' : tag;
const BLOCK_TAGS = new Set(['p', 'h1', 'h2', 'h3', 'ul', 'ol', 'blockquote', 'hr', 'aside']);
const INLINE_TAGS = new Set(['strong', 'em', 'a', 'br']);
const VOID_TAGS = new Set(['hr', 'br']);

const assertAllowedChild = (parent, child, position, leadingH1Index) => {
  if (!parent) {
    if (!BLOCK_TAGS.has(child) || (child === 'h1' && position !== leadingH1Index)) {
      throw new StudioContentError(`Element <${child}> is not allowed at the article root.`, {
        code: 'invalid-legacy-structure', element: child, position,
      });
    }
    return;
  }
  if (['p', 'h1', 'h2', 'h3', 'strong', 'em', 'a'].includes(parent)) {
    if (!INLINE_TAGS.has(child) || (parent === 'a' && child === 'a')) {
      throw new StudioContentError(`Element <${child}> is not valid inside <${parent}>.`, {
        code: 'invalid-legacy-structure', element: child, position,
      });
    }
    return;
  }
  if (parent === 'ul' || parent === 'ol') {
    if (child !== 'li') {
      throw new StudioContentError(`Only list items are valid inside <${parent}>.`, {
        code: 'invalid-legacy-structure', element: child, position,
      });
    }
    return;
  }
  if (['li', 'blockquote', 'aside'].includes(parent)) {
    if (!BLOCK_TAGS.has(child) && !INLINE_TAGS.has(child)) {
      throw new StudioContentError(`Element <${child}> is not valid inside <${parent}>.`, {
        code: 'invalid-legacy-structure', element: child, position,
      });
    }
  }
};

const assertWellFormedLegacyStructure = (source, leadingH1Index) => {
  if (/<!--|<!doctype/i.test(source)) {
    throw new StudioContentError('Comments and document declarations are not supported in article HTML.', {
      code: 'unsupported-legacy-element', position: source.search(/<!--|<!doctype/i),
    });
  }
  const tokenPattern = /<\s*(\/?)\s*([a-zA-Z][\w:-]*)([^<>]*?)>/g;
  const stack = [];
  let cursor = 0;
  let match;
  while ((match = tokenPattern.exec(source)) !== null) {
    const text = source.slice(cursor, match.index);
    const malformedOffset = text.search(/[<>]/);
    if (malformedOffset !== -1) {
      throw new StudioContentError('Malformed or incomplete HTML markup is not supported.', {
        code: 'malformed-legacy-markup', position: cursor + malformedOffset,
      });
    }
    const parent = stack.at(-1)?.canonical ?? null;
    if (text.trim() && (!parent || parent === 'ul' || parent === 'ol')) {
      throw new StudioContentError('Text appears outside a valid text block.', {
        code: 'invalid-legacy-structure', element: parent ?? 'root', position: cursor,
      });
    }
    const rawTag = match[2].toLowerCase();
    const tag = canonicalTag(rawTag);
    if (match[1]) {
      const open = stack.pop();
      if (!open || open.rawTag !== rawTag) {
        throw new StudioContentError(`Closing </${rawTag}> does not match the open article structure.`, {
          code: 'invalid-legacy-structure', element: rawTag, position: match.index,
        });
      }
    } else {
      assertAllowedChild(parent, tag, match.index, leadingH1Index);
      const selfClosing = /\/\s*$/.test(match[3]);
      if (selfClosing && !VOID_TAGS.has(tag)) {
        throw new StudioContentError(`Element <${rawTag}> cannot be self-closing.`, {
          code: 'invalid-legacy-structure', element: rawTag, position: match.index,
        });
      }
      if (!VOID_TAGS.has(tag)) stack.push({ rawTag, canonical: tag, position: match.index });
    }
    cursor = tokenPattern.lastIndex;
  }
  const trailing = source.slice(cursor);
  const malformedOffset = trailing.search(/[<>]/);
  if (malformedOffset !== -1) {
    throw new StudioContentError('Malformed or incomplete HTML markup is not supported.', {
      code: 'malformed-legacy-markup', position: cursor + malformedOffset,
    });
  }
  const parent = stack.at(-1)?.canonical ?? null;
  if (trailing.trim() && (!parent || parent === 'ul' || parent === 'ol')) {
    throw new StudioContentError('Text appears outside a valid text block.', {
      code: 'invalid-legacy-structure', element: parent ?? 'root', position: cursor,
    });
  }
  if (stack.length) {
    const open = stack.at(-1);
    throw new StudioContentError(`Element <${open.rawTag}> is not closed.`, {
      code: 'invalid-legacy-structure', element: open.rawTag, position: open.position,
    });
  }
};

const assertSafeHref = (href, position) => {
  let url;
  try {
    url = new URL(href);
  } catch {
    throw new StudioContentError('Links must use a complete http, https or mailto URL.', {
      code: 'unsafe-legacy-link', element: 'a', attribute: 'href', position,
    });
  }
  if (!SAFE_PROTOCOLS.has(url.protocol)) {
    throw new StudioContentError(`The ${url.protocol || 'unknown'} link protocol is not allowed.`, {
      code: 'unsafe-legacy-link', element: 'a', attribute: 'href', position,
    });
  }
};

export const assertSupportedLegacyHtml = (html) => {
  const source = String(html ?? '');
  if (!source.trim() || utf8Bytes(source) > LEGACY_HTML_LIMIT) {
    throw new StudioContentError('Legacy article HTML is empty or too large.', {
      code: 'invalid-legacy-size',
    });
  }
  const leadingH1 = source.match(/^\s*<h1([^>]*)>/i);
  const leadingH1Index = leadingH1 ? source.search(/<h1/i) : -1;
  const tagPattern = /<\s*(\/?)\s*([a-zA-Z][\w:-]*)([^<>]*?)>/g;
  let match;
  while ((match = tagPattern.exec(source)) !== null) {
    if (match[1]) continue;
    const element = match[2].toLowerCase();
    const governedLeadingH1 = element === 'h1' && match.index === leadingH1Index;
    if (!ALLOWED_TAGS.has(element) && !governedLeadingH1) {
      throw new StudioContentError(`Unsupported legacy element <${element}>. Original HTML was preserved.`, {
        code: 'unsupported-legacy-element', element, position: match.index,
      });
    }
    const attributes = parseAttributes(match[3], element, match.index);
    const allowed = governedLeadingH1 ? new Set() : (ALLOWED_ATTRIBUTES[element] ?? new Set());
    for (const attribute of attributes) {
      if (!allowed.has(attribute.name)) {
        throw new StudioContentError(`Unsupported ${attribute.name} attribute on <${element}>. Original HTML was preserved.`, {
          code: 'unsupported-legacy-attribute', element, attribute: attribute.name, position: match.index,
        });
      }
      if (element === 'aside' && attribute.name === 'class' && attribute.value !== 'studio-callout') {
        throw new StudioContentError('Only the studio-callout aside is supported.', {
          code: 'unsupported-legacy-callout', element, attribute: 'class', position: match.index,
        });
      }
      if (element === 'a' && attribute.name === 'href') assertSafeHref(attribute.value, match.index);
      if (element === 'a' && attribute.name === 'target' && attribute.value !== '_blank') {
        throw new StudioContentError('Only the governed _blank link target is supported.', {
          code: 'unsupported-legacy-link-metadata', element, attribute: 'target', position: match.index,
        });
      }
      if (element === 'a' && attribute.name === 'rel' && attribute.value !== 'noopener noreferrer nofollow') {
        throw new StudioContentError('Link relationship metadata does not match the governed policy.', {
          code: 'unsupported-legacy-link-metadata', element, attribute: 'rel', position: match.index,
        });
      }
    }
    if (element === 'a' && !attributes.some(({ name }) => name === 'href')) {
      throw new StudioContentError('Legacy links require a safe href.', {
        code: 'missing-legacy-link', element, attribute: 'href', position: match.index,
      });
    }
    if (element === 'aside' && !attributes.some(({ name, value }) => name === 'class' && value === 'studio-callout')) {
      throw new StudioContentError('Only the studio-callout aside is supported.', {
        code: 'unsupported-legacy-callout', element, attribute: 'class', position: match.index,
      });
    }
  }
  assertWellFormedLegacyStructure(source, leadingH1Index);
  return source;
};

const assertOnlyKeys = (value, allowed, label) => {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new StudioContentError(`${label} contains unsupported property ${key}.`, {
        code: 'unsupported-json-property', attribute: key,
      });
    }
  }
};

const assertLinkMark = (mark) => {
  const attrs = mark.attrs ?? {};
  assertOnlyKeys(attrs, new Set(['href', 'target', 'rel', 'class', 'title']), 'Link');
  assertSafeHref(String(attrs.href ?? ''), -1);
  if (attrs.target !== '_blank' || attrs.rel !== 'noopener noreferrer nofollow' || attrs.class !== null) {
    throw new StudioContentError('Link metadata does not match the governed editor schema.', {
      code: 'invalid-json-link', element: 'link',
    });
  }
  if (attrs.title !== null && typeof attrs.title !== 'string') {
    throw new StudioContentError('Link title must be text or null.', {
      code: 'invalid-json-link', element: 'link', attribute: 'title',
    });
  }
};

export const assertStudioImageAttributes = (attrs) => {
  const value = attrs ?? {};
  assertOnlyKeys(value, new Set(['assetId', 'alt', 'decorative', 'caption']), 'Image');
  if (!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(String(value.assetId ?? ''))) {
    throw new StudioContentError('Image asset reference is invalid.', {
      code: 'invalid-image-asset', element: 'image', attribute: 'assetId',
    });
  }
  if (typeof value.alt !== 'string' || value.alt.length > 500) {
    throw new StudioContentError('Image alternative text is invalid.', {
      code: 'invalid-image-alt', element: 'image', attribute: 'alt',
    });
  }
  if (typeof value.decorative !== 'boolean') {
    throw new StudioContentError('Choose whether the image is decorative.', {
      code: 'invalid-image-decorative', element: 'image', attribute: 'decorative',
    });
  }
  if ((value.decorative && value.alt !== '') || (!value.decorative && !value.alt.trim())) {
    throw new StudioContentError('Add alternative text or mark the image as decorative.', {
      code: 'missing-image-alt', element: 'image', attribute: 'alt',
    });
  }
  if (typeof value.caption !== 'string' || value.caption.length > 1_000) {
    throw new StudioContentError('Image caption is invalid.', {
      code: 'invalid-image-caption', element: 'image', attribute: 'caption',
    });
  }
  return value;
};

const validateNode = (node, depth, counter) => {
  if (!node || typeof node !== 'object' || Array.isArray(node) || !ALLOWED_NODE_TYPES.has(node.type)) {
    throw new StudioContentError(`Unsupported Tiptap node ${String(node?.type ?? 'unknown')}.`, {
      code: 'unsupported-json-node', element: String(node?.type ?? ''),
    });
  }
  if (depth > DOCUMENT_DEPTH_LIMIT || ++counter.count > DOCUMENT_NODE_LIMIT) {
    throw new StudioContentError('The article structure is too deep or complex.', {
      code: 'json-complexity-limit',
    });
  }
  assertOnlyKeys(node, new Set(['type', 'attrs', 'content', 'marks', 'text']), `Node ${node.type}`);
  if (node.marks !== undefined && !Array.isArray(node.marks)) {
    throw new StudioContentError(`Node ${node.type} marks must be a list.`, {
      code: 'invalid-json-marks', element: node.type,
    });
  }
  if (node.type === 'text') {
    if (typeof node.text !== 'string' || node.content !== undefined || node.attrs !== undefined) {
      throw new StudioContentError('Text nodes must contain text only.', { code: 'invalid-json-text' });
    }
  } else if (node.text !== undefined || node.marks !== undefined) {
    throw new StudioContentError(`Node ${node.type} cannot contain inline text properties.`, {
      code: 'invalid-json-node-shape', element: node.type,
    });
  }
  if (node.type === 'heading') {
    assertOnlyKeys(node.attrs ?? {}, new Set(['level']), 'Heading');
    if (![2, 3].includes(node.attrs?.level)) {
      throw new StudioContentError('Only heading levels 2 and 3 are supported.', {
        code: 'unsupported-heading-level', element: 'heading', attribute: 'level',
      });
    }
  } else if (node.type === 'orderedList') {
    assertOnlyKeys(node.attrs ?? {}, new Set(['start', 'type']), 'Ordered list');
    if (node.attrs?.start !== 1 || node.attrs?.type !== null) {
      throw new StudioContentError('Custom ordered-list numbering is not supported.', {
        code: 'unsupported-list-attributes', element: 'orderedList',
      });
    }
  } else if (node.type === 'image') {
    assertStudioImageAttributes(node.attrs);
    if (node.content !== undefined) {
      throw new StudioContentError('Image nodes cannot contain editable content.', {
        code: 'invalid-image-content', element: 'image',
      });
    }
  } else if (node.attrs !== undefined && Object.keys(node.attrs).length > 0) {
    throw new StudioContentError(`Node ${node.type} has unsupported attributes.`, {
      code: 'unsupported-json-attributes', element: node.type,
    });
  }
  for (const mark of node.marks ?? []) {
    if (!mark || typeof mark !== 'object' || !ALLOWED_MARK_TYPES.has(mark.type)) {
      throw new StudioContentError(`Unsupported Tiptap mark ${String(mark?.type ?? 'unknown')}.`, {
        code: 'unsupported-json-mark', element: String(mark?.type ?? ''),
      });
    }
    assertOnlyKeys(mark, new Set(['type', 'attrs']), `Mark ${mark.type}`);
    if (mark.type === 'link') assertLinkMark(mark);
    else if (mark.attrs !== undefined && Object.keys(mark.attrs).length > 0) {
      throw new StudioContentError(`Mark ${mark.type} has unsupported attributes.`, {
        code: 'unsupported-json-mark-attributes', element: mark.type,
      });
    }
  }
  if (node.content !== undefined) {
    if (!Array.isArray(node.content)) {
      throw new StudioContentError(`Node ${node.type} content must be a list.`, {
        code: 'invalid-json-content', element: node.type,
      });
    }
    for (const child of node.content) validateNode(child, depth + 1, counter);
  }
};

export const assertContentDocument = (document) => {
  if (!document || typeof document !== 'object' || Array.isArray(document)) {
    throw new StudioContentError('The article body is not a structured content document.', {
      code: 'invalid-content-document',
    });
  }
  assertOnlyKeys(document, new Set(['format', 'schemaVersion', 'registryVersion', 'content']), 'Content document');
  if (
    document.format !== STUDIO_CONTENT_FORMAT
    || document.schemaVersion !== STUDIO_SCHEMA_VERSION
    || document.registryVersion !== STUDIO_REGISTRY_VERSION
  ) {
    throw new StudioContentError('The article uses an unsupported editor schema version.', {
      code: 'unsupported-content-version',
    });
  }
  if (utf8Bytes(stableJson(document)) > DOCUMENT_JSON_LIMIT) {
    throw new StudioContentError('The structured article is too large.', { code: 'invalid-content-size' });
  }
  validateNode(document.content, 0, { count: 0 });
  if (document.content.type !== 'doc') {
    throw new StudioContentError('The structured article root must be a document.', {
      code: 'invalid-content-root', element: String(document.content.type ?? ''),
    });
  }
  const registryNodes = Object.keys(studioTiptapSchema.nodes).sort();
  const registryMarks = Object.keys(studioTiptapSchema.marks).sort();
  if (
    stableJson(registryNodes) !== stableJson(EXPECTED_SCHEMA_NODES)
    || stableJson(registryMarks) !== stableJson(EXPECTED_SCHEMA_MARKS)
  ) {
    throw new StudioContentError('The active editor registry differs from the governed schema.', {
      code: 'schema-registry-drift',
    });
  }
  try {
    studioTiptapSchema.nodeFromJSON(document.content).check();
  } catch (error) {
    throw new StudioContentError('The article tree violates the governed editor structure.', {
      code: 'invalid-json-structure',
    }, { cause: error });
  }
  return document;
};

export const createContentDocument = (content) => assertContentDocument({
  format: STUDIO_CONTENT_FORMAT,
  schemaVersion: STUDIO_SCHEMA_VERSION,
  registryVersion: STUDIO_REGISTRY_VERSION,
  content,
});

export const contentAssetIds = (document) => {
  const valid = assertContentDocument(document);
  const ids = new Set();
  const visit = (node) => {
    if (node.type === 'image') ids.add(node.attrs.assetId);
    for (const child of node.content ?? []) visit(child);
  };
  visit(valid.content);
  return [...ids].sort();
};

export const renderContentDocument = (document) => {
  const valid = assertContentDocument(document);
  return generateHTML(valid.content, studioTiptapExtensions);
};

export const contentDocumentFromDraft = (draft) => assertContentDocument({
  format: draft?.format,
  schemaVersion: draft?.schemaVersion,
  registryVersion: draft?.registryVersion,
  content: draft?.content,
});

export const canonicalContentFields = (document) => {
  const valid = assertContentDocument(document);
  return {
    ...valid,
    contentSha256: sha256(stableJson(valid)),
  };
};

export const resolveStoredDraftContent = (draft) => {
  if (draft?.format === STUDIO_CONTENT_FORMAT) {
    const document = contentDocumentFromDraft(draft);
    const contentSha256 = sha256(stableJson(document));
    if (!/^[a-f0-9]{64}$/.test(String(draft.contentSha256 ?? ''))) {
      throw new StudioContentError('The structured article is missing its governed integrity hash.', {
        code: 'missing-content-hash',
      });
    }
    if (draft.contentSha256 !== contentSha256) {
      throw new StudioContentError('The structured article hash does not match its governed content.', {
        code: 'content-hash-mismatch',
      });
    }
    return {
      document,
      contentSha256,
      renderedHtml: renderContentDocument(document),
      source: 'canonical',
    };
  }
  if (typeof draft?.body === 'string') {
    return { ...migrateLegacyHtml({ html: draft.body, title: draft.title }), source: 'legacy' };
  }
  throw new StudioContentError('The cloud draft does not contain governed article content.', {
    code: 'missing-draft-content',
  });
};

export const migrateLegacyHtml = ({ html, title = '' }) => {
  const legacyHtmlOriginal = String(html ?? '');
  assertSupportedLegacyHtml(legacyHtmlOriginal);
  const normalizedHtml = normalizeLegacyTitle(legacyHtmlOriginal, title);
  const content = generateJSON(normalizedHtml, studioTiptapExtensions);
  const document = createContentDocument(content);
  if (utf8Bytes(legacyHtmlOriginal) + utf8Bytes(stableJson(document)) > COMBINED_MIGRATION_LIMIT) {
    throw new StudioContentError('The preserved original and structured article exceed the safe draft storage budget.', {
      code: 'combined-migration-size-limit',
    });
  }
  const renderedHtml = renderContentDocument(document);
  const reparsed = createContentDocument(generateJSON(renderedHtml, studioTiptapExtensions));
  if (stableJson(reparsed) !== stableJson(document) || plainText(renderedHtml) !== plainText(normalizedHtml)) {
    throw new StudioContentError('Legacy conversion changed article structure or visible text. Original HTML was preserved.', {
      code: 'legacy-round-trip-mismatch',
    });
  }
  return {
    document,
    renderedHtml,
    legacyHtmlOriginal,
    legacyHtmlSha256: sha256(legacyHtmlOriginal),
    contentSha256: sha256(stableJson(document)),
    report: {
      status: 'compatible',
      schemaVersion: STUDIO_SCHEMA_VERSION,
      registryVersion: STUDIO_REGISTRY_VERSION,
    },
  };
};
