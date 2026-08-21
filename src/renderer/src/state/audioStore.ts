import { create } from 'zustand'
import type { PermissionsInfo } from '@shared/ipc'
import { api } from '../lib/api'
import { listInputDevices, type AudioDevice } from '../lib/devices'

// Audio source state driving the setup screen's status dots and meters.
//
// The dots are a live signal and must be *honest*: green only when the source
// is genuinely hearing something. Three distinct states, because "no audio
// track at all" and "a track that is silent" are different problems with
// different fixes, and the old single boolean conflated them into a dot that
// flickered and looked like activity.

export type SourceState =
  /** haven't tried to open this source yet */
  | 'idle'
  /** capture failed, or the stream arrived with no audio track */
  | 'no-track'
  /** a real track, but nothing audible on it */
  | 'silent'
  /** hearing sound */
  | 'live'

export interface SourceStatus {
  state: SourceState
  /** smoothed 0..1, drives the meter */
  level: number
  /** device name from the MediaStreamTrack, when we have one */
  deviceLabel: string | null
  /** capture error message, when state is 'no-track' */
  error: string | null
  /** rolling count of confirmed transcript segments, for diagnostics */
  segments: number
  /** estimated room-noise floor in dBFS, or null before enough audio has
   *  arrived to estimate one. This is the number that makes "my mic is too
   *  quiet" a fact rather than a guess: speech has to clear it by vadOpenDb. */
  floorDbfs: number | null
}

const EMPTY: SourceStatus = {
  state: 'idle',
  level: 0,
  deviceLabel: null,
  error: null,
  segments: 0,
  floorDbfs: null
}

/**
 * The pre-interview microphone check.
 *
 * "Test" used to call requestMicrophone() and then do nothing at all when
 * permission was already granted — the normal case by the time you're looking
 * at that screen. A test that can't fail tells you nothing, so this one runs
 * real audio through the real pipeline and shows you the words back.
 */
export interface MicTest {
  state: 'idle' | 'recording' | 'thinking' | 'done' | 'failed'
  /** what the model heard, once it's done */
  text: string | null
  /** why it couldn't, when it failed */
  error: string | null
}

const NO_TEST: MicTest = { state: 'idle', text: null, error: null }

interface AudioState {
  permissions: PermissionsInfo
  meeting: SourceStatus
  mic: SourceStatus
  meetingLabel: string
  micLabel: string
  /** every audio input, for the two device pickers */
  inputDevices: AudioDevice[]
  micTest: MicTest
  /** one-line transcription-pipeline problem (model failed, falling behind,
   *  capture stalled) — rendered in the live panel and the setup notice, so a
   *  dead pipeline is never only visible in ⌘⇧D (REVIEW.md H2/C4) */
  pipelineNotice: string | null

  refreshPermissions(): Promise<void>
  refreshDevices(): Promise<void>
  setMicTest(patch: Partial<MicTest>): void
  resetMicTest(): void
  /** publish a smoothed level + liveness for one source (throttled upstream) */
  publish(stream: 'meeting' | 'mic', patch: Partial<SourceStatus>): void
  setLabels(labels: { meeting?: string; mic?: string }): void
  setError(stream: 'meeting' | 'mic', message: string | null): void
  setPipelineNotice(notice: string | null): void
  countSegment(stream: 'meeting' | 'mic'): void
  reset(stream: 'meeting' | 'mic'): void
}

export const useAudioStore = create<AudioState>((set) => ({
  permissions: { microphone: 'unknown', screen: 'unknown' },
  meeting: EMPTY,
  mic: EMPTY,
  meetingLabel: 'Meeting audio · system loopback',
  micLabel: 'Your mic',
  inputDevices: [],
  micTest: NO_TEST,
  pipelineNotice: null,

  refreshPermissions: async () => {
    const permissions = await api.permissions.status()
    set({ permissions })
  },

  refreshDevices: async () => {
    set({ inputDevices: await listInputDevices() })
  },

  setMicTest: (patch) => set((s) => ({ micTest: { ...s.micTest, ...patch } })),

  resetMicTest: () => set({ micTest: NO_TEST }),

  publish: (stream, patch) =>
    set((s) => ({ [stream]: { ...s[stream], ...patch } }) as Partial<AudioState>),

  setLabels: (labels) =>
    set((s) => ({
      meetingLabel: labels.meeting ?? s.meetingLabel,
      micLabel: labels.mic ?? s.micLabel
    })),

  setError: (stream, message) =>
    set((s) => ({
      [stream]: {
        ...s[stream],
        error: message,
        // clearing an error un-sticks 'no-track' (recovered source starts
        // over as silent until sound actually arrives)
        state: message ? 'no-track' : s[stream].state === 'no-track' ? 'silent' : s[stream].state,
        level: message ? 0 : s[stream].level
      }
    }) as Partial<AudioState>),

  setPipelineNotice: (pipelineNotice) => set({ pipelineNotice }),

  countSegment: (stream) =>
    set((s) => ({ [stream]: { ...s[stream], segments: s[stream].segments + 1 } }) as Partial<AudioState>),

  reset: (stream) => set(() => ({ [stream]: EMPTY }) as Partial<AudioState>)
}))
