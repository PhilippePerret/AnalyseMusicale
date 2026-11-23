import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://www.analyse-musicale.fr',
  trailingSlash: 'always',
  integrations: [sitemap({ filter: (page) => !/\/contact\/(merci|erreur)\/$|\/admin\/|\/cours\/(admin|student)\//.test(page) })],
});
