export const studioPublicUrl: (
  draft: { publicationStatus: string; publicationLiveUrl?: string; archivedAt?: string },
  staticPath?: string,
) => string | undefined;
