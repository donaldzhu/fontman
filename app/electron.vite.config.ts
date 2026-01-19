import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  main: {
    build: {
      outDir: 'dist/main',
      rollupOptions: {
        external: ['better-sqlite3'],
      },
      commonjsOptions: {
        dynamicRequireTargets: [
          'node_modules/better-sqlite3/build/**',
          'node_modules/better-sqlite3/lib/**',
        ],
        ignoreDynamicRequires: true,
      },
    },
  },
  preload: {
    build: {
      outDir: 'dist/preload',
      rollupOptions: {
        output: {
          format: 'cjs',
          entryFileNames: '[name].cjs',
          chunkFileNames: '[name].cjs',
          assetFileNames: '[name][extname]',
        },
      },
    },
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer'),
      },
    },
    plugins: [react()],
    build: {
      outDir: 'dist/renderer',
    },
  },
})
