import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@cartographie/shared': fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url)),
    },
  },
  build: {
    rollupOptions: {
      output: {
        // Bibliothèques dans des fichiers à part : elles changent rarement et restent en cache entre deux déploiements.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          if (/\/(react|react-dom|scheduler|react-router|react-router-dom)\//.test(id)) return 'react'
          if (id.includes('@tanstack')) return 'query'
          if (/\/(motion|framer-motion|motion-dom|motion-utils)\//.test(id)) return 'motion'
          if (/\/zod\//.test(id)) return 'zod'
          return undefined
        },
      },
    },
  },
  server: {
    port: 5173,
    // Port occupé : erreur explicite plutôt qu’un passage discret sur 5174 (les liens et le README pointent sur 5173).
    strictPort: true,
    fs: { allow: ['../..'] },
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
        timeout: 0,
        proxyTimeout: 0,
      },
    },
  },
})
