import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://aispanda.com',
  output: 'static',
  trailingSlash: 'never',
  integrations: [sitemap()],
  redirects: {
    '/insights/open-the-ai': '/open-the-ai',
    '/insights/public-ai-switchboard': '/open-the-ai',
  },
});
