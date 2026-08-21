import { describe, expect, it } from 'vitest'
import { NoiseFloor, VadSegmenter, normalizeForAsr } from '@/lib/dsp/vad'
import { rms } from '@/lib/dsp/level'
import { TUNING } from '@shared/tuning'

// Each test here maps to one of the three symptoms from real use:
//   "misses my speech"        → quiet-mic / adaptive-floor cases
//   "transcribes badly"       → silence retention and pre-roll
//   "cuts me off mid-sentence"→ pause handling and the soft cap

const RATE = TUNING.asrSampleRate

/** tone at a given dBFS, as a block of `ms` */
function tone(ms: number, dbfsLevel: number, freq = 200): Float32Array {
  const amp = Math.pow(10, dbfsLevel / 20) * Math.SQRT2
  const n = Math.round((RATE * ms) / 1000)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) out[i] = amp * Math.sin((2 * Math.PI * freq * i) / RATE)
  return out
}

/** speech-like audio: a tone with syllable-rate amplitude modulation. Real
 *  speech swings tens of dB between phonemes and pauses; a dead-flat tone is
 *  indistinguishable from a beep or a fan, and the segmenter now treats a
 *  cap-length flat segment as noise (REVIEW.md H7). */
function speechy(ms: number, dbfsLevel: number): Float32Array {
  const out = tone(ms, dbfsLevel)
  for (let i = 0; i < out.length; i++) {
    const mod = 0.55 + 0.45 * Math.sin((2 * Math.PI * 4 * i) / RATE) // 4Hz, ~20dB dips
    out[i] *= mod
  }
  return out
}

/** steady noise at a given dBFS */
function noise(ms: number, dbfsLevel: number): Float32Array {
  const amp = Math.pow(10, dbfsLevel / 20)
  const n = Math.round((RATE * ms) / 1000)
  const out = new Float32Array(n)
  let seed = 12345
  for (let i = 0; i < n; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    out[i] = ((seed / 0x7fffffff) * 2 - 1) * amp
  }
  return out
}

function feed(v: VadSegmenter, ...blocks: Float32Array[]) {
  const utterances = []
  for (const b of blocks) utterances.push(...v.push(b))
  return utterances
}

describe('NoiseFloor', () => {
  it('settles down to a quiet room quickly', () => {
    const f = new NoiseFloor()
    for (let i = 0; i < 100; i++) f.update(-70, false)
    expect(f.value).toBeLessThan(-65)
  })

  it('rises to meet a noisy room, but slowly', () => {
    const f = new NoiseFloor()
    for (let i = 0; i < 50; i++) f.update(-70, false)
    const before = f.value
    for (let i = 0; i < 25; i++) f.update(-40, false) // 500ms of louder room
    expect(f.value).toBeGreaterThan(before)
    expect(f.value).toBeLessThan(-55) // hasn't jumped straight there
  })

  it('freezes while speech is open, so a monologue cannot drag it up', () => {
    const f = new NoiseFloor()
    for (let i = 0; i < 100; i++) f.update(-70, false)
    const parked = f.value
    for (let i = 0; i < 500; i++) f.update(-20, true) // 10s of talking
    expect(f.value).toBeCloseTo(parked, 5)
  })
})

describe('VadSegmenter', () => {
  it('opens on sustained speech but not on a click', () => {
    const v = new VadSegmenter()
    feed(v, noise(500, -70))
    feed(v, tone(20, -25)) // one frame — a click
    expect(v.isOpen).toBe(false)
    feed(v, tone(200, -25))
    expect(v.isOpen).toBe(true)
  })

  it('keeps audio from before the onset so leading consonants survive', () => {
    const v = new VadSegmenter()
    feed(v, noise(600, -70))
    const done = feed(v, tone(500, -25), noise(1200, -70))
    expect(done).toHaveLength(1)
    // the utterance must be longer than the speech itself: pre-roll + tail pad
    const durationMs = (done[0].samples.length / RATE) * 1000
    expect(durationMs).toBeGreaterThan(500 + TUNING.vadPreRollMs * 0.5)
  })

  it('does NOT excise the gap between words', () => {
    // the bug that made transcription unintelligible: silence was dropped
    // before buffering, splicing words together with hard discontinuities
    const v = new VadSegmenter()
    feed(v, noise(500, -70))
    const done = feed(v, tone(400, -25), noise(300, -70), tone(400, -25), noise(1200, -70))
    expect(done).toHaveLength(1)
    const durationMs = (done[0].samples.length / RATE) * 1000
    // 400 + 300 + 400 = 1100ms of span must all be there
    expect(durationMs).toBeGreaterThan(1050)
  })

  it('rides through an ordinary pause instead of cutting mid-sentence', () => {
    const v = new VadSegmenter()
    feed(v, noise(500, -70))
    // 500ms pause is normal sentence-internal hesitation
    const mid = feed(v, tone(1500, -25), noise(500, -70), tone(600, -25))
    expect(mid).toHaveLength(0) // still going
    expect(v.isOpen).toBe(true)
  })

  it('closes after a real pause', () => {
    const v = new VadSegmenter()
    feed(v, noise(500, -70))
    const done = feed(v, tone(1500, -25), noise(TUNING.vadEndSilenceMs + 300, -70))
    expect(done).toHaveLength(1)
    expect(v.isOpen).toBe(false)
  })

  it('hears a quiet mic that the old fixed threshold missed', () => {
    // -52dBFS speech is well under the old 0.008 RMS (-41.9dBFS) constant,
    // which produced no transcript at all, silently
    const v = new VadSegmenter()
    feed(v, noise(800, -75))
    const done = feed(v, tone(800, -52), noise(1200, -75))
    expect(done).toHaveLength(1)
    expect(done[0].speechMs).toBeGreaterThan(300)
  })

  it('still segments in a noisy room', () => {
    // a room where the old code never accumulated silence at all, so every
    // utterance ran to the 12s cap
    const v = new VadSegmenter()
    feed(v, noise(1500, -45))
    const done = feed(v, tone(1200, -20), noise(1400, -45))
    expect(done).toHaveLength(1)
    const durationMs = (done[0].samples.length / RATE) * 1000
    expect(durationMs).toBeLessThan(3000) // not a run-on
  })

  it('does not open on room noise alone', () => {
    const v = new VadSegmenter()
    const done = feed(v, noise(4000, -55))
    expect(done).toHaveLength(0)
    expect(v.isOpen).toBe(false)
  })

  it('caps a monologue rather than buffering forever', () => {
    const v = new VadSegmenter()
    feed(v, noise(500, -70))
    const done = feed(v, speechy(TUNING.vadMaxSegmentSec * 1000 + 2000, -25))
    expect(done.length).toBeGreaterThanOrEqual(1)
    expect(done[0].truncated).toBe(true)
    const durationMs = (done[0].samples.length / RATE) * 1000
    expect(durationMs).toBeLessThanOrEqual(TUNING.vadMaxSegmentSec * 1000 + 50)
  })

  it('drops a cap-length flat segment as noise and adapts the floor at once (REVIEW.md H7)', () => {
    const v = new VadSegmenter()
    feed(v, noise(600, -70))
    const before = v.floorDbfs
    // a fan or AC compressor stepping on: loud enough to open the gate,
    // dead flat for the whole cap
    const out = feed(v, noise(TUNING.vadMaxSegmentSec * 1000 + 2000, -50))
    expect(out).toHaveLength(0) // nothing reaches Whisper
    expect(v.floorDbfs).toBeGreaterThan(before + 10) // adapted in ONE cap, not 0.36dB/cycle
    // the continuing noise no longer holds the gate open
    feed(v, noise(3000, -50))
    expect(v.isOpen).toBe(false)
  })

  it('speech still opens and segments over the noise-adapted floor', () => {
    const v = new VadSegmenter()
    feed(v, noise(600, -70))
    feed(v, noise(TUNING.vadMaxSegmentSec * 1000 + 2000, -50)) // fan adapts the floor
    const done = feed(v, speechy(1200, -25), noise(1500, -50))
    expect(done).toHaveLength(1)
    expect(done[0].truncated).toBe(false)
  })

  it('reset() re-zeros the clock so timestamps do not double after resume (REVIEW.md H5)', () => {
    const v = new VadSegmenter()
    feed(v, noise(1000, -70))
    feed(v, tone(700, -25), noise(1200, -70)) // a first run of ~3s
    v.reset()
    feed(v, noise(1000, -70))
    const done = feed(v, tone(700, -25), noise(1200, -70))
    expect(done).toHaveLength(1)
    // counted from the reset (~1s in), not from the stream's birth (~4s)
    expect(done[0].startT).toBeLessThan(1.1)
  })

  it('drops a blip without letting it stick to the next utterance', () => {
    // the old flush() early-returned on short buffers *without clearing them*,
    // so a "yes" glued itself onto whatever was said minutes later
    const v = new VadSegmenter()
    feed(v, noise(500, -70))
    const blip = feed(v, tone(80, -25), noise(1500, -70))
    expect(blip).toHaveLength(0)

    const real = feed(v, tone(900, -25), noise(1500, -70))
    expect(real).toHaveLength(1)
    const durationMs = (real[0].samples.length / RATE) * 1000
    expect(durationMs).toBeLessThan(2000) // the blip is not in here
  })

  it('emits an open segment on flush', () => {
    const v = new VadSegmenter()
    feed(v, noise(500, -70))
    feed(v, tone(900, -25))
    expect(v.isOpen).toBe(true)
    const tail = v.flush()
    expect(tail).not.toBeNull()
    expect(v.isOpen).toBe(false)
  })

  it('offers a bounded view of the segment in progress, for partials', () => {
    // the old worker re-transcribed the whole growing buffer every 1.6s, so
    // partials got steadily more expensive until real flushes were dropped
    const v = new VadSegmenter()
    feed(v, noise(500, -70))
    feed(v, tone(12000, -25)) // 12s of talking, still open
    expect(v.isOpen).toBe(true)
    const open = v.peekOpen(TUNING.asrPartialWindowSec)
    expect(open).not.toBeNull()
    const windowMs = (open!.samples.length / RATE) * 1000
    expect(windowMs).toBeLessThanOrEqual(TUNING.asrPartialWindowSec * 1000 + TUNING.vadFrameMs)
    expect(windowMs).toBeGreaterThan(TUNING.asrPartialWindowSec * 1000 - 200)
    // it is the *trailing* window, so its start is near the live edge
    expect(open!.startT).toBeGreaterThan(3)
  })

  it('offers nothing to peek at when no one is talking', () => {
    const v = new VadSegmenter()
    feed(v, noise(1000, -70))
    expect(v.peekOpen(8)).toBeNull()
  })

  it('timestamps utterances against the stream clock', () => {
    const v = new VadSegmenter()
    feed(v, noise(1000, -70))
    const done = feed(v, tone(700, -25), noise(1200, -70))
    expect(done).toHaveLength(1)
    // onset is ~1s in; pre-roll pulls startT slightly earlier
    expect(done[0].startT).toBeGreaterThan(0.5)
    expect(done[0].startT).toBeLessThan(1.1)
    expect(done[0].endT).toBeGreaterThan(done[0].startT)
  })
})

describe('normalizeForAsr', () => {
  it('lifts a quiet utterance toward the target', () => {
    const quiet = tone(500, -45)
    const { samples, gain } = normalizeForAsr(quiet)
    expect(gain).toBeGreaterThan(1)
    expect(rms(samples)).toBeGreaterThan(rms(quiet))
    expect(rms(samples)).toBeLessThanOrEqual(TUNING.asrTargetRms * 1.05)
  })

  it('attenuates a hot utterance rather than only ever boosting', () => {
    const hot = tone(500, -3)
    const { samples, gain } = normalizeForAsr(hot)
    expect(gain).toBeLessThan(1)
    expect(rms(samples)).toBeLessThan(rms(hot))
  })

  it('never clips', () => {
    const { samples } = normalizeForAsr(tone(500, -30))
    let peak = 0
    for (const v of samples) peak = Math.max(peak, Math.abs(v))
    expect(peak).toBeLessThanOrEqual(TUNING.asrPeakCeiling + 1e-6)
  })

  it('refuses to amplify what is really just noise', () => {
    const { gain } = normalizeForAsr(noise(300, -90))
    expect(gain).toBe(1)
  })

  it('removes a DC offset', () => {
    const x = tone(300, -20)
    for (let i = 0; i < x.length; i++) x[i] += 0.25
    const { samples } = normalizeForAsr(x)
    let mean = 0
    for (const v of samples) mean += v
    expect(Math.abs(mean / samples.length)).toBeLessThan(0.01)
  })
})
