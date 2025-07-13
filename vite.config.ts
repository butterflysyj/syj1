import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      plugins: [react()],
      define: {
        'import.meta.env.VITE_GOOGLE_API_KEY': JSON.stringify(env.VITE_GOOGLE_API_KEY),
        global: 'globalThis',
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      },
      optimizeDeps: {
        exclude: ['pdf-parse']
      },
      build: {
        rollupOptions: {
          external: ['fs', 'path', 'util', 'crypto', 'stream', 'events', 'buffer', 'assert', 'zlib'],
          output: {
            globals: {
              fs: 'fs',
              path: 'path',
              util: 'util',
              crypto: 'crypto',
              stream: 'stream',
              events: 'events',
              buffer: 'buffer',
              assert: 'assert',
              zlib: 'zlib'
            }
          }
        }
      }
    };
});
