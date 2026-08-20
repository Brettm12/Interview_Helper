// Browser-only build of the renderer, used for design verification and for
// demoing the screens without an Electron binary (window.api is shimmed).
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  root: resolve('src/renderer'),
  plugins: [react()],
  resolve: {
    alias: {
      '@': resolve('src/renderer/src'),
      '@shared': resolve('src/shared')
    }
  },
  build: {
    outDir: resolve('dist-web'),
    emptyOutDir: true
  },
  server: {
    port: 5199,
    strictPort: true
  }
})
