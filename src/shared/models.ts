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
    detail: '75 MB · the default — comfortably real-time, and it keeps the words'
  }
]

/**
 * There is one tier, on purpose.
 *
 * tiny.en used to sit beside it as "Fast — lower latency on an older machine,
 * misses more words", which is an offer to make your own interview worse to
 * save 34 MB (the picker claimed the saving was 105 MB; the manifest says
 * base.en is 75 MB and tiny.en is 41 MB). A word Whisper drops is a question
 * the matcher scores wrong, and the round that measured this found a mangled
 * transcript costs more match score than the entire spread between three
 * different embedding models. Nobody should be invited to choose that.
 *
 * It remains in the manifest, still downloaded, still the automatic fallback
 * when base.en cannot be loaded — it just is not a choice on a screen.
 */
export const DEFAULT_WHISPER_MODEL: string = manifest.defaultTranscription

/** the tier to fall back on when the chosen model can't be loaded: the
 *  smallest, most likely to already be on disk */
export const FALLBACK_WHISPER_MODEL = 'Xenova/whisper-tiny.en'

/** not offered, but it can still be what is running — it is the fallback, and
 *  an older build may have written it into settings. Diagnostics has to be
 *  able to name it honestly rather than reporting the tier we wish were up. */
const FALLBACK_TIER: WhisperTier = {
  id: FALLBACK_WHISPER_MODEL,
  label: 'Fast (tiny.en)',
  detail: '41 MB · the fallback — lower latency, misses more words'
}

export function whisperTier(id: string): WhisperTier {
  return (
    WHISPER_TIERS.find((t) => t.id === id) ??
    (id === FALLBACK_WHISPER_MODEL ? FALLBACK_TIER : null) ??
    WHISPER_TIERS.find((t) => t.id === DEFAULT_WHISPER_MODEL) ??
    WHISPER_TIERS[0]
  )
}

/** ids the setup screen may offer. Anything else — the fallback, or a tier
 *  from a newer build — is still valid to RUN, just not to pick. */
export function isOfferedTier(id: string): boolean {
  return WHISPER_TIERS.some((t) => t.id === id)
}
