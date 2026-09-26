// A working draft may have a new slug while its previous release is still live.
export const studioPublicUrl = ({ publicationStatus, publicationLiveUrl, archivedAt }, staticPath) => {
  if (archivedAt || !['published', 'published-with-changes'].includes(publicationStatus)) return undefined;
  if (!publicationLiveUrl) return staticPath;
  try {
    const url = new URL(publicationLiveUrl);
    return ['https:', 'http:'].includes(url.protocol) ? url.href : undefined;
  } catch {
    return undefined;
  }
};
