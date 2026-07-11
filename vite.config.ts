import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  // Salida en 'build' (no 'dist') para esquivar la caché de dist en Cloudflare.
  build: { outDir: 'build', emptyOutDir: true },
})
