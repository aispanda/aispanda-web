const normalizedPreviewState = (state) => ({
  editVersion: state.editVersion,
  updatedAt: state.updatedAt,
  revision: state.revision,
  contentSha256: state.contentSha256,
});

export const captureStudioPreviewState = (state) => Object.freeze(normalizedPreviewState(state));

export const isStudioPreviewStateCurrent = (captured, current) => (
  current.hasUnsavedChanges !== true
  && captured.editVersion === current.editVersion
  && captured.updatedAt === current.updatedAt
  && captured.revision === current.revision
  && captured.contentSha256 === current.contentSha256
);
