import { describe, expect, it } from 'vitest'
import { Biquad, Resampler, resampleBuffer } from '@/lib/dsp/resample'

// The headline test is `aliasing`: it reproduces the old naive decimator and
// shows the fold-back it produced, then shows the new resampler suppressing
// it. That fold-back is a direct cause of "it transcribes badly" — everything
// from 8–24kHz was landing on top of the speech band.

const RATE = 48000

function sine(freq: number, seconds: number, rate = RATE): Float32Array {
  const out = new Float32Array(Math.round(rate * seconds))
  for (let i = 0; i < out.length; i++) out[i] = Math.sin((2 * Math.PI * freq * i) / rate)
  return out
}

/** energy at one frequency, via a Goertzel-style projection, as a fraction of
 *  a full-scale sine (1.0 == full amplitude at that frequency) */
function amplitudeAt(x: Float32Array, freq: number, rate: number): number {
  let re = 0
  let im = 0
  for (let i = 0; i < x.length; i++) {
    const p = (2 * Math.PI * freq * i) / rate
    re += x[i] * Math.cos(p)
    im += x[i] * Math.sin(p)
  }
  return (2 * Math.sqrt(re * re + im * im)) / x.length
}

const db = (a: number): number => 20 * Math.log10(Math.max(a, 1e-12))

/** exactly what real.ts used to do, kept here so the regression is visible */
function naiveDecimate(input: Float32Array, inRate: number, outRate: number): Float32Array {
  const ratio = inRate / outRate
  const out = new Float32Array(Math.floor(input.length / ratio))
  for (let i = 0; i < out.length; i++) out[i] = input[Math.floor(i * ratio)]
  return out
}

describe('Resampler', () => {
  it('is a pass-through when the rates already match', () => {
    const r = new Resampler(16000, 16000)
    expect(r.passthrough).toBe(true)
    const x = sine(1000, 0.01, 16000)
    expect(r.process(x)).toBe(x)
  })

  it('produces the right number of samples for the rate change', () => {
    const out = resampleBuffer(sine(1000, 1), RATE, 16000)
    // 1 second in → ~1 second out, within a few samples of filter tail
    expect(Math.abs(out.length - 16000)).toBeLessThan(600)
  })

  it('preserves in-band tones', () => {
    for (const freq of [300, 1000, 3000]) {
      const out = resampleBuffer(sine(freq, 0.5), RATE, 16000)
      const body = out.subarray(400, out.length - 400) // skip filter edges
      expect(db(amplitudeAt(body, freq, 16000))).toBeGreaterThan(-1.5)
    }
  })

  it('rejects out-of-band content instead of folding it into speech', () => {
    // 15kHz at 48k decimated 3:1 aliases to |15000 - 48000/3| = 1000Hz,
    // landing squarely on speech
    const input = sine(15000, 0.5)

    const naive = naiveDecimate(input, RATE, 16000)
    const naiveFold = db(amplitudeAt(naive.subarray(400, naive.length - 400), 1000, 16000))

    const clean = resampleBuffer(input, RATE, 16000)
    const cleanFold = db(amplitudeAt(clean.subarray(400, clean.length - 400), 1000, 16000))

    // the old path folded it back at essentially full strength...
    expect(naiveFold).toBeGreaterThan(-6)
    // ...the new one buries it
    expect(cleanFold).toBeLessThan(-50)
    expect(naiveFold - cleanFold).toBeGreaterThan(40)
  })

  it('also rejects a second alias pair (20kHz → 4kHz)', () => {
    const input = sine(20000, 0.5)
    const clean = resampleBuffer(input, RATE, 16000)
    const folded = db(amplitudeAt(clean.subarray(400, clean.length - 400), 4000, 16000))
    expect(folded).toBeLessThan(-50)
  })

  it('is seamless across block boundaries', () => {
    // the old decimator restarted its phase every block and dropped samples
    const input = sine(1000, 0.25)
    const oneShot = new Resampler(RATE, 16000).process(input)

    const blocked = new Resampler(RATE, 16000)
    const parts: Float32Array[] = []
    for (let i = 0; i < input.length; i += 2048) {
      parts.push(blocked.process(input.subarray(i, Math.min(i + 2048, input.length))))
    }
    const joined = new Float32Array(parts.reduce((n, p) => n + p.length, 0))
    let o = 0
    for (const p of parts) {
      joined.set(p, o)
      o += p.length
    }

    expect(joined.length).toBe(oneShot.length)
    let maxDiff = 0
    for (let i = 0; i < joined.length; i++) {
      maxDiff = Math.max(maxDiff, Math.abs(joined[i] - oneShot[i]))
    }
    expect(maxDiff).toBeLessThan(1e-6)
  })

  it('consumes every input sample exactly once', () => {
    const r = new Resampler(RATE, 16000)
    for (let i = 0; i < 20; i++) r.process(new Float32Array(2048))
    expect(r.consumed).toBe(20 * 2048)
    // and produces the matching output count, without the old 2-per-block loss
    expect(Math.abs(r.produced - (20 * 2048) / 3)).toBeLessThan(60)
  })

  it('handles 44.1kHz, where the ratio is not an integer', () => {
    const out = resampleBuffer(sine(1000, 0.5, 44100), 44100, 16000)
    expect(Math.abs(out.length - 8000)).toBeLessThan(400)
    const body = out.subarray(400, out.length - 400)
    expect(db(amplitudeAt(body, 1000, 16000))).toBeGreaterThan(-1.5)
  })

  it('passes DC through at unity, so the kernel is normalised', () => {
    const flat = new Float32Array(RATE * 0.2).fill(0.5)
    const out = resampleBuffer(flat, RATE, 16000)
    const mid = out.subarray(600, out.length - 600)
    let sum = 0
    for (const v of mid) sum += v
    expect(sum / mid.length).toBeCloseTo(0.5, 2)
  })
})

describe('Biquad.highpass', () => {
  it('removes DC offset while passing speech', () => {
    const f = Biquad.highpass(16000, 75)
    const x = new Float32Array(16000)
    for (let i = 0; i < x.length; i++) x[i] = 0.3 + Math.sin((2 * Math.PI * 1000 * i) / 16000)
    const y = f.process(x.slice())
    const tail = y.subarray(2000)
    let mean = 0
    for (const v of tail) mean += v
    mean /= tail.length
    expect(Math.abs(mean)).toBeLessThan(0.01) // the 0.3 bias is gone
    expect(db(amplitudeAt(tail, 1000, 16000))).toBeGreaterThan(-1) // speech intact
  })

  it('attenuates low-frequency rumble', () => {
    const f = Biquad.highpass(16000, 75)
    const rumble = new Float32Array(16000)
    for (let i = 0; i < rumble.length; i++) rumble[i] = Math.sin((2 * Math.PI * 30 * i) / 16000)
    const y = f.process(rumble)
    const tail = y.subarray(4000)
    expect(db(amplitudeAt(tail, 30, 16000))).toBeLessThan(-14)
  })
})
