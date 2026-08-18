import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import sentry from '@sentry/astro';

export default defineConfig({
  site: 'https://aispanda.com',
  output: 'static',
  trailingSlash: 'never',
  integrations: [
    sentry({
      dsn: process.env.SENTRY_DSN,
      environment: process.env.SENTRY_ENVIRONMENT || 'production',
      tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE || '0.1'),
      release: 'ai-48-observability-pilot',
      enabled: process.env.ENABLE_OBSERVABILITY_PILOT === 'true',
    }),
    sitemap({ filter: (page) => !page.includes('/studio') }),
  ],
  vite: {
    server: {
      proxy: {
        '/__/auth': {
          target: 'https://aispanda.firebaseapp.com',
          changeOrigin: true,
          secure: true,
        },
      },
    },
  },
  redirects: {
    '/insights/open-the-ai': '/open-the-ai',
    '/insights/public-ai-switchboard': '/open-the-ai',
  },
});