export type StudioPreviewState = Readonly<{
  editVersion: number;
  updatedAt: string;
  revision: number;
  contentSha256: string;
}>;

export const captureStudioPreviewState: (state: StudioPreviewState) => StudioPreviewState;
export const isStudioPreviewStateCurrent: (
  captured: StudioPreviewState,
  current: StudioPreviewState & { hasUnsavedChanges: boolean },
) => boolean;
