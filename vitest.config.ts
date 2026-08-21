import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src/renderer/src'),
      '@shared': resolve(__dirname, 'src/shared'),
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
