import { describe, expect, it } from 'vitest'
import { cleanTranscript, isLikelyHallucination } from '@/lib/asrText'
import { TUNING } from '@shared/tuning'

// Whisper never declines. Handed room tone it produces caption boilerplate,
// and every one of those strings would otherwise be scored against the answer
// bank and could swing the panel to the wrong question mid-interview.

const REAL_SPEECH_MS = 2000
const BARELY_ANY_MS = 200

describe('cleanTranscript', () => {
  it('strips the leading space Whisper always emits', () => {
    expect(cleanTranscript(' Tell me about yourself.')).toBe('Tell me about yourself.')
  })

  it('collapses internal whitespace and newlines', () => {
    expect(cleanTranscript('so   what\n\nhappened')).toBe('so what happened')
  })
})

describe('isLikelyHallucination', () => {
  it('keeps ordinary speech', () => {
    expect(isLikelyHallucination('Tell me about a time you disagreed with a peer.', REAL_SPEECH_MS)).toBe(
      false
    )
  })

  it('drops empty output', () => {
    expect(isLikelyHallucination('   ', REAL_SPEECH_MS)).toBe(true)
  })

  it('drops caption annotations whatever the duration', () => {
    for (const s of ['[BLANK_AUDIO]', '(upbeat music)', '[ Silence ]']) {
      expect(isLikelyHallucination(s, REAL_SPEECH_MS)).toBe(true)
    }
  })

  it('drops output with no letters or digits at all', () => {
    for (const s of ['...', '♪♪♪', '- - -']) {
      expect(isLikelyHallucination(s, REAL_SPEECH_MS)).toBe(true)
    }
  })

  it('drops the decoder repetition loop', () => {
    expect(isLikelyHallucination('you you you you you you', REAL_SPEECH_MS)).toBe(true)
    // ...but not ordinary repetition inside a sentence
    expect(isLikelyHallucination('it was very very hard', REAL_SPEECH_MS)).toBe(false)
  })

  it('drops stock filler that came from almost no voice', () => {
    for (const s of ['Thank you.', 'you', 'Thanks for watching!', 'Bye.']) {
      expect(isLikelyHallucination(s, BARELY_ANY_MS)).toBe(true)
    }
  })

  it('keeps the same words when someone actually said them', () => {
    // a real "thank you" in an interview carries real voiced time — the filler
    // rule keys off that, not off the words alone
    expect(isLikelyHallucination('Thank you.', TUNING.asrHallucinationMaxSpeechMs + 100)).toBe(false)
  })

  it('keeps a short answer that is not boilerplate', () => {
    expect(isLikelyHallucination('Redis, mostly.', BARELY_ANY_MS)).toBe(false)
  })
})
