import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 3113,
    strictPort: true,
    host: true,
    // Allow access through the hosted proxy in addition to localhost.
    allowedHosts: ['blendervalve.iocompute.ai', '.iocompute.ai', 'localhost'],
  },
  preview: {
    port: 3113,
    strictPort: true,
    allowedHosts: ['blendervalve.iocompute.ai', '.iocompute.ai', 'localhost'],
  },
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 1200,
  },
});
