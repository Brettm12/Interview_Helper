// Sample-rate conversion for the ASR path.
//
// What this replaces: `out[i] = input[floor(i * ratio)]` — nearest-sample
// decimation with no filtering. At 48k→16k that throws away two of every
// three samples and folds the entire 8–24kHz band back into the speech band,
// so sibilants, fricatives and room hiss alias on top of the vowels Whisper
// needs. It also reset its phase every block and silently dropped samples at
// each block boundary.
//
// This is a windowed-sinc (polyphase) resampler: a proper low-pass and the
// interpolation are the same operation. It is one long-lived instance per
// source that carries its history and fractional read position across blocks,
// so every input sample is consumed exactly once and there are no seams.

export interface KernelOptions {
  /** sinc zero crossings each side — more taps, steeper stopband */
  zeroCrossings: number
  /** cutoff as a fraction of the lower Nyquist; <1 leaves transition room */
  rolloff: number
  /** sub-sample phases precomputed; the fractional position picks one */
  phases: number
}

export interface Kernel {
  /** filter half-width, in input samples */
  halfWidth: number
  /** taps per phase */
  taps: number
  /** phases × taps, flattened */
  table: Float32Array
  phases: number
  /** index of the tap at offset 0 within each phase row */
  centerTap: number
}

function blackmanHarris(x: number): number {
  // x in [-1, 1]; ~ -92dB sidelobes, which is what buys the stopband
  const t = Math.PI * (x + 1)
  return (
    0.35875 -
    0.48829 * Math.cos(t) +
    0.14128 * Math.cos(2 * t) -
    0.01168 * Math.cos(3 * t)
  )
}

function sinc(x: number): number {
  if (x === 0) return 1
  const p = Math.PI * x
  return Math.sin(p) / p
}

/**
 * Build the filter for a given rate conversion.
 * `cutoff` is in cycles per input sample: for downsampling it must sit at the
 * *output* Nyquist so nothing above it survives to fold.
 */
export function designSincKernel(
  inRate: number,
  outRate: number,
  opts: KernelOptions
): Kernel {
  const cutoff = 0.5 * Math.min(1, outRate / inRate) * opts.rolloff
  const halfWidth = opts.zeroCrossings / (2 * cutoff)
  const taps = 2 * Math.ceil(halfWidth) + 1
  const centerTap = Math.ceil(halfWidth)
  const table = new Float32Array(opts.phases * taps)

  for (let p = 0; p < opts.phases; p++) {
    const frac = p / opts.phases
    let sum = 0
    const row = p * taps
    for (let t = 0; t < taps; t++) {
      // distance from the (fractional) centre to this input sample
      const d = t - centerTap - frac
      const w = Math.abs(d) <= halfWidth ? blackmanHarris(d / halfWidth) : 0
      const v = 2 * cutoff * sinc(2 * cutoff * d) * w
      table[row + t] = v
      sum += v
    }
    // normalise each phase to unity DC gain, so a constant input comes out
    // at the same level regardless of which phase lands on it
    if (sum !== 0) {
      for (let t = 0; t < taps; t++) table[row + t] /= sum
    }
  }

  return { halfWidth, taps, table, phases: opts.phases, centerTap }
}

export class Resampler {
  private kernel: Kernel | null
  private history: Float32Array
  private historyLength = 0
  /** absolute input-sample index of history[0] */
  private historyStart = 0
  /** absolute input-sample position of the next output sample */
  private nextOutputPos: number
  private ratio: number
  consumed = 0
  produced = 0

  constructor(
    private inRate: number,
    private outRate: number,
    opts: KernelOptions = { zeroCrossings: 16, rolloff: 0.92, phases: 128 }
  ) {
    this.ratio = inRate / outRate
    // same rate in and out: nothing to do, stay a pass-through
    this.kernel = inRate === outRate ? null : designSincKernel(inRate, outRate, opts)
    const span = this.kernel ? this.kernel.taps + 2 : 0
    this.history = new Float32Array(Math.max(span * 4, 4096))
    // start far enough in that the first output has full history behind it
    this.nextOutputPos = this.kernel ? this.kernel.halfWidth : 0
  }

  get passthrough(): boolean {
    return this.kernel === null
  }

  /** feed one input block, get however many output samples are now complete */
  process(input: Float32Array): Float32Array {
    this.consumed += input.length
    if (!this.kernel) {
      this.produced += input.length
      return input
    }
    const k = this.kernel

    // append to history, growing/compacting as needed
    if (this.historyLength + input.length > this.history.length) {
      const keep = Math.min(this.historyLength, k.taps + 2)
      const drop = this.historyLength - keep
      this.history.copyWithin(0, drop, this.historyLength)
      this.historyStart += drop
      this.historyLength = keep
      if (keep + input.length > this.history.length) {
        const bigger = new Float32Array((keep + input.length) * 2)
        bigger.set(this.history.subarray(0, keep))
        this.history = bigger
      }
    }
    this.history.set(input, this.historyLength)
    this.historyLength += input.length

    const availableEnd = this.historyStart + this.historyLength // exclusive
    // an output at position p needs input up to p + halfWidth
    const maxPos = availableEnd - 1 - k.halfWidth
    const count = Math.max(0, Math.floor((maxPos - this.nextOutputPos) / this.ratio) + 1)
    const out = new Float32Array(count)

    for (let i = 0; i < count; i++) {
      const pos = this.nextOutputPos + i * this.ratio
      const base = Math.floor(pos)
      const frac = pos - base
      const phase = Math.min(k.phases - 1, Math.floor(frac * k.phases))
      const row = phase * k.taps
      let acc = 0
      // tap t corresponds to input index base - centerTap + t
      const firstIdx = base - k.centerTap - this.historyStart
      for (let t = 0; t < k.taps; t++) {
        const idx = firstIdx + t
        if (idx < 0 || idx >= this.historyLength) continue
        acc += this.history[idx] * k.table[row + t]
      }
      out[i] = acc
    }

    this.nextOutputPos += count * this.ratio
    this.produced += count

    // keep only what future outputs still need behind them
    const needFrom = Math.floor(this.nextOutputPos - k.halfWidth) - k.centerTap - 1
    const drop = Math.max(0, needFrom - this.historyStart)
    if (drop > 0) {
      this.history.copyWithin(0, drop, this.historyLength)
      this.historyStart += drop
      this.historyLength -= drop
    }
    return out
  }

  reset(): void {
    this.historyLength = 0
    this.historyStart = 0
    this.nextOutputPos = this.kernel ? this.kernel.halfWidth : 0
    this.consumed = 0
    this.produced = 0
  }
}

/** one-shot convenience for tests and offline use */
export function resampleBuffer(
  input: Float32Array,
  inRate: number,
  outRate: number,
  opts?: KernelOptions
): Float32Array {
  const r = new Resampler(inRate, outRate, opts)
  const a = r.process(input)
  // flush: feed silence so the tail of the signal makes it out
  const tailLen = Math.ceil((r.passthrough ? 0 : inRate / 100) + 1)
  const b = r.process(new Float32Array(tailLen))
  const out = new Float32Array(a.length + b.length)
  out.set(a)
  out.set(b, a.length)
  return out
}

/** 2nd-order Butterworth high-pass, used to strip desk rumble and HVAC before
 *  anything measures the level. Those sit at 40–80Hz, well under the ~85Hz
 *  bottom of voiced speech, but they dominate RMS and poison a noise floor. */
export class Biquad {
  private b0 = 1
  private b1 = 0
  private b2 = 0
  private a1 = 0
  private a2 = 0
  private x1 = 0
  private x2 = 0
  private y1 = 0
  private y2 = 0

  static highpass(sampleRate: number, freq: number, q = Math.SQRT1_2): Biquad {
    const f = new Biquad()
    const w0 = (2 * Math.PI * freq) / sampleRate
    const cos = Math.cos(w0)
    const alpha = Math.sin(w0) / (2 * q)
    const a0 = 1 + alpha
    f.b0 = ((1 + cos) / 2) / a0
    f.b1 = (-(1 + cos)) / a0
    f.b2 = ((1 + cos) / 2) / a0
    f.a1 = (-2 * cos) / a0
    f.a2 = (1 - alpha) / a0
    return f
  }

  /** filter in place and return the same array */
  process(samples: Float32Array): Float32Array {
    for (let i = 0; i < samples.length; i++) {
      const x = samples[i]
      const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2
      this.x2 = this.x1
      this.x1 = x
      this.y2 = this.y1
      this.y1 = y
      samples[i] = y
    }
    return samples
  }

  reset(): void {
    this.x1 = this.x2 = this.y1 = this.y2 = 0
  }
}
