import { resolve, sep } from 'node:path';

export const isInternalArticleShellFile = (file, distRoot) => {
  const internalRoot = resolve(distRoot, 'article-shell-internal');
  const candidate = resolve(file);
  return candidate === internalRoot || candidate.startsWith(`${internalRoot}${sep}`);
};
