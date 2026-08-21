import { create } from 'zustand'

// Save failures used to be pure silent loss: every store mutation set state
// first and fired the write with no .catch — edits looked saved on screen and
// were gone on relaunch (REVIEW.md H9). Every persisting store routes its
// writes through here; the bank and setup surfaces render `problem` as a
// persistent banner until a save of the same file succeeds again.

interface PersistHealthState {
  /** "Changes are NOT being saved — <reason>", or null when writes are landing */
  problem: string | null
  /** which file the problem is about, so an unrelated success doesn't clear it */
  failedKey: string | null
  noteFailure(key: string, err: unknown): void
  noteSuccess(key: string): void
}

export const usePersistHealth = create<PersistHealthState>((set, get) => ({
  problem: null,
  failedKey: null,
  noteFailure: (key, err) =>
    set({
      failedKey: key,
      problem: `Changes are NOT being saved — ${err instanceof Error ? err.message : String(err)}`
    }),
  noteSuccess: (key) => {
    if (get().failedKey === key) set({ problem: null, failedKey: null })
  }
}))
