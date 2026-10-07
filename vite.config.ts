import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  base: './',
  build: {
    target: 'chrome120',
    rollupOptions: {
      input: { viewer: resolve('viewer.html'), print: resolve('print.html'), background: resolve('src/extension/background.ts') },
      output: { entryFileNames: (chunk) => chunk.name === 'background' ? 'background.js' : 'assets/[name]-[hash].js' },
    },
  },
  worker: { format: 'es' },
});
