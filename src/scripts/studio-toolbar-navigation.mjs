export const nextToolbarControlIndex = (key, currentIndex, controlCount) => {
  if (!Number.isInteger(currentIndex) || !Number.isInteger(controlCount) || controlCount < 1) return -1;
  if (key === 'Home') return 0;
  if (key === 'End') return controlCount - 1;
  if (key === 'ArrowRight') return (currentIndex + 1) % controlCount;
  if (key === 'ArrowLeft') return (currentIndex - 1 + controlCount) % controlCount;
  return currentIndex;
};

export const closeToolbarMenuAndFocusSummary = (control) => {
  const menu = control?.closest?.('details');
  if (!menu) return false;
  menu.open = false;
  const summary = menu.querySelector?.('summary');
  summary?.focus?.();
  return Boolean(summary);
};

const unsupportedPasteTagPattern = /<\s*(table|thead|tbody|tfoot|tr|th|td|caption|colgroup|col|pre|code|img|picture|source|figure|figcaption|video|audio|canvas|svg|math|iframe|object|embed)\b/gi;

export const evaluateStudioPasteHtml = (html) => {
  const unsupportedTags = [...new Set(
    [...String(html).matchAll(unsupportedPasteTagPattern)].map((match) => match[1].toLowerCase()),
  )];
  if (unsupportedTags.length === 0) return { accepted: true, unsupportedTags: [], message: '' };

  const containsTable = unsupportedTags.some((tag) => ['table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'colgroup', 'col'].includes(tag));
  const containsCode = unsupportedTags.some((tag) => tag === 'pre' || tag === 'code');
  const labels = [
    containsTable ? 'tables' : '',
    containsCode ? 'code blocks' : '',
    unsupportedTags.some((tag) => !['table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'colgroup', 'col', 'pre', 'code'].includes(tag)) ? 'images or embedded media' : '',
  ].filter(Boolean);
  return {
    accepted: false,
    unsupportedTags,
    message: `This paste contains ${labels.join(', ')} that this editor does not support yet. Use Paste as plain text instead.`,
  };
};

export const evaluateStudioClipboardPaste = ({ html = '', items = [], files = [] } = {}) => {
  const containsFile = items.some((item) => item?.kind === 'file') || files.length > 0;
  if (containsFile) {
    return {
      accepted: false,
      unsupportedTags: ['clipboard-file'],
      message: 'Pasted files and images are not supported yet. Use Paste as plain text instead.',
    };
  }
  return evaluateStudioPasteHtml(html);
};
