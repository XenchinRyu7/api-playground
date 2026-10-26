import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import vercel from '@astrojs/vercel/serverless';

// SSR: halaman publik membaca project dari storage (Vercel Blob) saat request, admin butuh endpoint server.
export default defineConfig({
  output: 'server',
  adapter: vercel(),
  integrations: [tailwind({ applyBaseStyles: false })],
  compressHTML: true,
  build: { inlineStylesheets: 'auto' },
  security: { checkOrigin: true },
});
