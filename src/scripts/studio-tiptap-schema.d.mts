import type { Extensions } from '@tiptap/core';

export const STUDIO_CONTENT_FORMAT: 'tiptap-json';
export const STUDIO_SCHEMA_VERSION: 1;
export const STUDIO_REGISTRY_VERSION: 'ai-91-v1';
export const configureStudioImageLoader: (loader?: ((assetId: string) => Promise<Blob>) | null) => void;
export const studioTiptapExtensions: Extensions;
