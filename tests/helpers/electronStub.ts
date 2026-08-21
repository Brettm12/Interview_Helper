import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Minimal `electron` stand-in so src/main modules (persistence, models) run
// under vitest. Wired via the `electron` alias in vitest.config.ts. Only the
// surface those modules actually touch is provided; anything else throwing is
// a feature — it means a test wandered into territory that needs the real app.

let userDataDir = mkdtempSync(join(tmpdir(), 'lih-test-'))

/** point app.getPath('userData') at a fresh directory (call per test) */
export function setUserDataDir(dir: string): void {
  userDataDir = dir
}

export function getUserDataDir(): string {
  return userDataDir
}

export const app = {
  getPath(name: string): string {
    if (name === 'userData') return userDataDir
    return join(userDataDir, name)
  },
  getName(): string {
    return 'Live Interview Helper'
  }
}
