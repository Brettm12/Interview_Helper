import { create } from 'zustand'
import type { Settings } from '@shared/types'
import { DEFAULT_WHISPER_MODEL } from '@shared/models'
import { TUNING } from '@shared/tuning'
import { api } from '../lib/api'
import { usePersistHealth } from './persistHealth'

interface SettingsState extends Settings {
  loaded: boolean
  load(): Promise<void>
  update(patch: Partial<Settings>): Promise<void>
}

export const useSettingsStore = create<SettingsState>((set) => ({
  contentProtection: true,
  keepTranscript: false,
  placement: 'docked',
  stripPosition: null,
  micDeviceId: null,
  meetingDeviceId: null,
  whisperModel: DEFAULT_WHISPER_MODEL,
  autoPickSec: TUNING.autoPickSec,
  loaded: false,

  load: async () => {
    const s = await api.settings.load()
    set({ ...s, loaded: true })
    void api.windows.setContentProtection(s.contentProtection)
  },

  update: async (patch) => {
    set(patch) // optimistic — the merged truth from disk lands just below
    try {
      // patch semantics via main's read-merge-write: full-object saves used to
      // race main's strip-drag writes and silently revert them (REVIEW.md L10)
      const merged = await api.settings.update(patch)
      set(merged)
      usePersistHealth.getState().noteSuccess('settings')
    } catch (err) {
      // the change is live in memory but NOT on disk — say so (REVIEW.md H9)
      usePersistHealth.getState().noteFailure('settings', err)
    }
    if ('contentProtection' in patch) {
      void api.windows.setContentProtection(patch.contentProtection!)
    }
  }
}))

// another writer changed settings.json (main's strip-drag persistence, or a
// second window) — refresh so this window doesn't overwrite it with stale state
let subscribed = false
export function startSettingsSync(): () => void {
  if (subscribed) return () => {}
  subscribed = true
  const off = api.settings.onDidChange((s) => useSettingsStore.setState(s))
  return () => {
    subscribed = false
    off()
  }
}
