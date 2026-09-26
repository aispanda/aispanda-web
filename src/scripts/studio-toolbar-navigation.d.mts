export function nextToolbarControlIndex(
  key: string,
  currentIndex: number,
  controlCount: number,
): number;

export function closeToolbarMenuAndFocusSummary(control: HTMLElement): boolean;

export function evaluateStudioPasteHtml(html: string): {
  accepted: boolean;
  unsupportedTags: string[];
  message: string;
};

export function evaluateStudioClipboardPaste(input?: {
  html?: string;
  items?: Array<{ kind?: string; type?: string }>;
  files?: Array<{ type?: string }>;
}): {
  accepted: boolean;
  unsupportedTags: string[];
  message: string;
};
