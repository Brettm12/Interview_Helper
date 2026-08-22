import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    plugins: [react()],
    resolve: {
      alias: {
        '@': resolve('src/renderer/src'),
        '@shared': resolve('src/shared'),
        // onnxruntime-web 1.22 does not export its wasm files as package
        // subpaths, and the offline promise needs them in the build rather
        // than off a CDN (REVIEW.md C2) — so they are aliased by path.
        '@ort-wasm': resolve('node_modules/onnxruntime-web/dist')
      }
    },
    worker: {
      format: 'es'
    }
  }
})
