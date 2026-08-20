// Whisper builds the app can transcribe with. The ids must exist in
// models.json, which is what both `npm run fetch-models` and the in-app
// downloader read.
//
// Accuracy is the whole product here — a missed question is a wrong panel —
// so the tiers are described by what they cost you, not by parameter count.

import manifest from './models.json'

export interface WhisperTier {
  id: string
  /** shown in the picker */
  label: string
  /** the trade-off, in words that mean something during an interview */
  detail: string
}

export const WHISPER_TIERS: WhisperTier[] = [
  {
    id: 'Xenova/whisper-base.en',
    label: 'Accurate (base.en)',
    detail: '~145 MB · the default — noticeably better, still real-time'
  },
  {
    id: 'Xenova/whisper-tiny.en',
    label: 'Fast (tiny.en)',
    detail: '~40 MB · lower latency on an older machine, misses more words'
  }
]

/** base.en, not tiny.en. Roughly 145MB against 40MB and still comfortably
 *  real-time on a modern machine, and accuracy is the whole product: a word
 *  Whisper drops is a question the matcher scores wrong, and a panel that
 *  swings to the wrong answer costs more than a hundred megabytes does.
 *  Kept in the manifest so `npm run fetch-models` and the in-app downloader
 *  can't disagree about which model that is. */
export const DEFAULT_WHISPER_MODEL: string = manifest.defaultTranscription

/** the tier to fall back on when the chosen model can't be loaded: the
 *  smallest, most likely to already be on disk */
export const FALLBACK_WHISPER_MODEL = 'Xenova/whisper-tiny.en'

export function whisperTier(id: string): WhisperTier {
  return (
    WHISPER_TIERS.find((t) => t.id === id) ??
    WHISPER_TIERS.find((t) => t.id === DEFAULT_WHISPER_MODEL) ??
    WHISPER_TIERS[0]
  )
}
