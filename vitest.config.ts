import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src/renderer/src'),
      '@shared': resolve(__dirname, 'src/shared'),
      // the workers import the wasm runtime through this alias; vitest loads
      // one of them (tests/embeddings.test.ts) through the real vite pipeline
      '@ort-wasm': resolve(__dirname, 'node_modules/onnxruntime-web/dist'),
      // src/main modules (persistence, models) run under vitest against a
      // minimal stub — see tests/helpers/electronStub.ts
      electron: resolve(__dirname, 'tests/helpers/electronStub.ts')
    }
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node'
  }
})
