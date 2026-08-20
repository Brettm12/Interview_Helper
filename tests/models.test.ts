import { describe, expect, it } from 'vitest'
import {
  DEFAULT_WHISPER_MODEL,
  FALLBACK_WHISPER_MODEL,
  WHISPER_TIERS,
  whisperTier
} from '@shared/models'
import manifest from '@shared/models.json'

// The tier list and the download manifest have to agree. A tier whose id has
// no manifest entry is a model the app will try to load and can never fetch —
// which reads to the user as "transcription just doesn't work", with nothing
// on screen explaining why.

const transcription = manifest.models.filter((m) => m.use === 'transcription').map((m) => m.id)

describe('whisper tiers', () => {
  it('every offered tier is downloadable', () => {
    for (const tier of WHISPER_TIERS) expect(transcription).toContain(tier.id)
  })

  it('the default and the fallback are both offered tiers', () => {
    const ids = WHISPER_TIERS.map((t) => t.id)
    expect(ids).toContain(DEFAULT_WHISPER_MODEL)
    expect(ids).toContain(FALLBACK_WHISPER_MODEL)
  })

  it('takes its default from the manifest, so the CLI and the app agree', () => {
    expect(DEFAULT_WHISPER_MODEL).toBe(manifest.defaultTranscription)
  })

  it('falls back to something smaller than the default', () => {
    expect(FALLBACK_WHISPER_MODEL).not.toBe(DEFAULT_WHISPER_MODEL)
  })

  it('resolves an unknown id to the default rather than throwing', () => {
    // a settings file from a future version, or a hand-edited one
    expect(whisperTier('Xenova/whisper-does-not-exist').id).toBe(DEFAULT_WHISPER_MODEL)
  })

  it('describes each tier in terms of the trade-off, with a size', () => {
    for (const tier of WHISPER_TIERS) {
      expect(tier.detail).toMatch(/MB/)
      expect(tier.label.length).toBeGreaterThan(0)
    }
  })
})
