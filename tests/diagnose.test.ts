import { describe, expect, it } from 'vitest'
import { diagnose, formatLevelDb } from '@/lib/diagnose'
import type { SourceStatus } from '@/state/audioStore'

// This is the code that has to be right precisely when the app "isn't
// working" and nothing else can explain why — so its reasoning is pinned.

const source = (over: Partial<SourceStatus> = {}): SourceStatus => ({
  state: 'live',
  level: 0.2,
  deviceLabel: null,
  error: null,
  segments: 3,
  floorDbfs: -70,
  ...over
})

const base = {
  meeting: source(),
  mic: source(),
  micPermission: true,
  screenPermission: true,
  missingModels: { speech: false, matching: false }
}

describe('diagnose', () => {
  it('reports all-clear when everything works', () => {
    expect(diagnose(base)).toMatch(/working/i)
  })

  it('puts missing mic permission above every other cause', () => {
    // even with other things broken, permission is the actionable root
    const out = diagnose({
      ...base,
      micPermission: false,
      mic: source({ state: 'no-track', error: 'boom' }),
      missingModels: { speech: true, matching: true }
    })
    expect(out).toMatch(/Microphone permission/i)
  })

  it('names the macOS loopback workaround when meeting audio has no track', () => {
    const out = diagnose({ ...base, meeting: source({ state: 'no-track', error: 'no system-audio track' }) })
    expect(out).toMatch(/loopback/i)
    expect(out).toMatch(/BlackHole/)
    expect(out).toMatch(/no system-audio track/)
  })

  it('calls out a mic that is live but far too quiet', () => {
    // -60dB: audible to the meter, useless to Whisper
    const out = diagnose({ ...base, mic: source({ level: 0.001 }) })
    expect(out).toMatch(/very quiet/i)
    expect(out).toMatch(/-60 dB/)
  })

  it('flags audio arriving but nothing being transcribed', () => {
    const out = diagnose({ ...base, mic: source({ segments: 0 }) })
    expect(out).toMatch(/nothing has been transcribed/i)
  })

  it('explains silence on both sources as expected, not broken', () => {
    const out = diagnose({
      ...base,
      mic: source({ state: 'silent', level: 0 }),
      meeting: source({ state: 'silent', level: 0 })
    })
    expect(out).toMatch(/expected/i)
  })

  it('mentions models only once the audio path is healthy', () => {
    expect(diagnose({ ...base, missingModels: { speech: true, matching: true } })).toMatch(/model/i)
    // a hard audio failure outranks it
    expect(
      diagnose({ ...base, missingModels: { speech: true, matching: true }, mic: source({ state: 'no-track' }) })
    ).toMatch(/microphone failed/i)
  })

  it('says which model is missing, because they fail differently', () => {
    // no speech model → a smaller one transcribes; no matching model →
    // matching drops to the lexical path. Same notice for both would send you
    // looking in the wrong place.
    const speech = diagnose({ ...base, missingModels: { speech: true, matching: false } })
    expect(speech).toMatch(/speech model/i)
    expect(speech).toMatch(/fallen back to the smaller one/i)

    const matching = diagnose({ ...base, missingModels: { speech: false, matching: true } })
    expect(matching).toMatch(/matching model/i)
    expect(matching).toMatch(/lexical/i)
  })
})

describe('formatLevelDb', () => {
  it('renders dB for live sources and a dash for dead ones', () => {
    expect(formatLevelDb(source({ level: 0.1 }))).toBe('-20 dB')
    expect(formatLevelDb(source({ state: 'no-track' }))).toBe('—')
    expect(formatLevelDb(source({ state: 'idle' }))).toBe('—')
    expect(formatLevelDb(source({ state: 'silent', level: 0 }))).toBe('silent')
  })
})
