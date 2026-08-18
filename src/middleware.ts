import { defineMiddleware } from 'astro:middleware';

export const onRequest = defineMiddleware((context, next) => {
  const path = context.url.pathname.replace(/\/+$/, '') || '/';
  if (path.startsWith('/community/') && path !== '/community') {
    return context.rewrite('/community');
  }
  return next();
});
