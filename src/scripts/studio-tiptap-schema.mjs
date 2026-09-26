import { Node, mergeAttributes } from '@tiptap/core';
import Link from '@tiptap/extension-link';
import StarterKit from '@tiptap/starter-kit';

export const STUDIO_CONTENT_FORMAT = 'tiptap-json';
export const STUDIO_SCHEMA_VERSION = 1;
export const STUDIO_REGISTRY_VERSION = 'ai-91-v1';

let studioImageLoader = null;

export const configureStudioImageLoader = (loader) => {
  studioImageLoader = typeof loader === 'function' ? loader : null;
};

export const StudioCallout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,
  parseHTML: () => [{ tag: 'aside.studio-callout' }],
  renderHTML: ({ HTMLAttributes }) => [
    'aside',
    mergeAttributes({ class: 'studio-callout' }, HTMLAttributes),
    0,
  ],
});

export const StudioImage = Node.create({
  name: 'image',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes: () => ({
    assetId: { default: '' },
    alt: { default: '' },
    decorative: { default: false },
    caption: { default: '' },
  }),
  parseHTML: () => [{ tag: 'figure[data-studio-image]' }],
  renderHTML: ({ node }) => {
    const { assetId, alt, decorative, caption } = node.attrs;
    const children = [
      ['img', {
        src: `/content-assets/${encodeURIComponent(String(assetId))}`,
        alt: decorative ? '' : String(alt),
        loading: 'lazy',
        decoding: 'async',
      }],
    ];
    if (caption) children.push(['figcaption', {}, String(caption)]);
    return [
      'figure',
      {
        'data-studio-image': '',
        'data-asset-id': String(assetId),
        'data-decorative': decorative ? 'true' : 'false',
      },
      ...children,
    ];
  },
  addNodeView() {
    return ({ node }) => {
      const figure = document.createElement('figure');
      const image = document.createElement('img');
      const status = document.createElement('span');
      let objectUrl = '';
      let loadSequence = 0;

      figure.setAttribute('data-studio-image', '');
      status.className = 'studio-image-status';
      status.setAttribute('role', 'status');
      image.loading = 'lazy';
      image.decoding = 'async';
      figure.append(image, status);

      const revokeObjectUrl = () => {
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        objectUrl = '';
      };
      const renderNode = (nextNode) => {
        const { assetId, alt, decorative, caption } = nextNode.attrs;
        figure.dataset.assetId = String(assetId);
        figure.dataset.decorative = decorative ? 'true' : 'false';
        image.alt = decorative ? '' : String(alt);
        figure.querySelector('figcaption')?.remove();
        if (caption) {
          const figcaption = document.createElement('figcaption');
          figcaption.textContent = String(caption);
          figure.append(figcaption);
        }

        const sequence = ++loadSequence;
        status.textContent = 'Loading image…';
        figure.setAttribute('aria-busy', 'true');
        if (!studioImageLoader) {
          image.src = `/content-assets/${encodeURIComponent(String(assetId))}`;
          status.textContent = '';
          figure.removeAttribute('aria-busy');
          return;
        }
        studioImageLoader(String(assetId)).then(async (blob) => {
          if (sequence !== loadSequence) return;
          const nextUrl = URL.createObjectURL(blob);
          image.src = nextUrl;
          try {
            await image.decode();
          } catch (error) {
            URL.revokeObjectURL(nextUrl);
            throw error;
          }
          if (sequence !== loadSequence) {
            URL.revokeObjectURL(nextUrl);
            return;
          }
          revokeObjectUrl();
          objectUrl = nextUrl;
          status.textContent = '';
          figure.removeAttribute('aria-busy');
        }).catch(() => {
          if (sequence !== loadSequence) return;
          revokeObjectUrl();
          image.removeAttribute('src');
          status.textContent = 'This image could not be loaded. Try refreshing the article.';
          figure.removeAttribute('aria-busy');
        });
      };

      renderNode(node);
      return {
        dom: figure,
        update(nextNode) {
          if (nextNode.type.name !== 'image') return false;
          renderNode(nextNode);
          return true;
        },
        selectNode() { figure.classList.add('ProseMirror-selectednode'); },
        deselectNode() { figure.classList.remove('ProseMirror-selectednode'); },
        destroy() {
          loadSequence += 1;
          revokeObjectUrl();
        },
      };
    };
  },
});

export const studioTiptapExtensions = [
  StarterKit.configure({
    heading: { levels: [2, 3] },
    link: false,
    strike: false,
    underline: false,
    code: false,
    codeBlock: false,
  }),
  Link.configure({
    openOnClick: false,
    autolink: false,
    linkOnPaste: false,
    protocols: ['http', 'https', 'mailto'],
  }),
  StudioCallout,
  StudioImage,
];
