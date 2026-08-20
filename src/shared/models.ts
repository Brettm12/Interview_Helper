// Whisper builds the app can transcribe with. The ids must exist in
// models.json, which is what both `npm run fetch-models` and the in-app
// downloader read.
//
// Accuracy is the whole product here — a missed question is a wrong panel —
// so the tiers are described by what they cost you, not by parameter count.

export interface WhisperTier {
  id: string
  /** shown in the picker */
  label: string
  /** the trade-off, in words that mean something during an interview */
  detail: string
}

export const WHISPER_TIERS: WhisperTier[] = [
  {
    id: 'Xenova/whisper-tiny.en',
    label: 'Fast (tiny.en)',
    detail: '~40 MB · lowest latency, misses more words'
  },
  {
    id: 'Xenova/whisper-base.en',
    label: 'Accurate (base.en)',
    detail: '~145 MB · noticeably better, still real-time'
  }
]

export const DEFAULT_WHISPER_MODEL = 'Xenova/whisper-tiny.en'

export function whisperTier(id: string): WhisperTier {
  return WHISPER_TIERS.find((t) => t.id === id) ?? WHISPER_TIERS[0]
}
