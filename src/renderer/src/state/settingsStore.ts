import { create } from 'zustand'
import type { Settings } from '@shared/types'
import { api } from '../lib/api'

interface SettingsState extends Settings {
  loaded: boolean
  load(): Promise<void>
  update(patch: Partial<Settings>): Promise<void>
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  contentProtection: true,
  keepTranscript: false,
  placement: 'docked',
  stripPosition: null,
  loaded: false,

  load: async () => {
    const s = await api.settings.load()
    set({ ...s, loaded: true })
    void api.windows.setContentProtection(s.contentProtection)
  },

  update: async (patch) => {
    set(patch)
    const { contentProtection, keepTranscript, placement, stripPosition } = get()
    await api.settings.save({ contentProtection, keepTranscript, placement, stripPosition })
    if ('contentProtection' in patch) {
      void api.windows.setContentProtection(patch.contentProtection!)
    }
  }
}))
