import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Separate dep-optimizer caches let several dev servers run side by side.
  cacheDir: process.env.VITE_CACHE_DIR ?? 'node_modules/.vite',
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: { port: Number(process.env.PORT ?? 5173), strictPort: false },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 900,
  },
})
