import { create } from 'zustand'
import type { PermissionsInfo } from '@shared/ipc'
import { api } from '../lib/api'

// Audio source + permission state driving the setup screen's status dots.
// The dots are a live signal: green only when permission is granted AND the
// source reports a level.

interface AudioState {
  permissions: PermissionsInfo
  /** 0..1 rolling RMS levels */
  meetingLevel: number
  micLevel: number
  meetingLabel: string
  micLabel: string
  /** capture failures, surfaced as the setup rows' why-lines */
  meetingError: string | null
  micError: string | null

  refreshPermissions(): Promise<void>
  setLevel(stream: 'meeting' | 'mic', level: number): void
  setLabels(labels: { meeting?: string; mic?: string }): void
  setError(stream: 'meeting' | 'mic', message: string | null): void
}

export const useAudioStore = create<AudioState>((set) => ({
  permissions: { microphone: 'unknown', screen: 'unknown' },
  meetingLevel: 0,
  micLevel: 0,
  meetingLabel: 'Meeting audio · system loopback',
  micLabel: 'Your mic',
  meetingError: null,
  micError: null,

  refreshPermissions: async () => {
    const permissions = await api.permissions.status()
    set({ permissions })
  },

  setLevel: (stream, level) =>
    set(stream === 'meeting' ? { meetingLevel: level } : { micLevel: level }),

  setLabels: (labels) =>
    set((s) => ({
      meetingLabel: labels.meeting ?? s.meetingLabel,
      micLabel: labels.mic ?? s.micLabel
    })),

  setError: (stream, message) =>
    set(stream === 'meeting' ? { meetingError: message } : { micError: message })
}))
