// Level measurement and meter ballistics. Pure and browser-free so the
// behaviour that actually went wrong — a status light that flickered several
// times per sentence — is unit-testable without audio hardware.

/** root-mean-square amplitude of a block, 0..1 */
export function rms(samples: Float32Array): number {
  if (samples.length === 0) return 0
  let sum = 0
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i]
  return Math.sqrt(sum / samples.length)
}

/** largest absolute sample in a block, 0..1 */
export function peak(samples: Float32Array): number {
  let max = 0
  for (let i = 0; i < samples.length; i++) {
    const a = Math.abs(samples[i])
    if (a > max) max = a
  }
  return max
}

/** amplitude → dBFS, floored so digital silence gives a number rather than
 *  -Infinity (which would poison every average downstream) */
export function dbfs(amplitude: number): number {
  if (!(amplitude > 0)) return -120
  return Math.max(-120, 20 * Math.log10(amplitude))
}

/**
 * Meter ballistics: instant attack, exponential release.
 *
 * Raw per-block RMS is far too twitchy to drive a UI — speech energy swings
 * wildly between phonemes, so a meter fed on it jitters and a threshold on it
 * chatters. Rising instantly keeps the meter feeling responsive; falling over
 * ~a third of a second is what makes it readable.
 */
export class MeterBallistics {
  private level = 0
  private lastMs: number | null = null

  constructor(private releasePerSec = 3) {}

  /** feed a raw block level; returns the smoothed value */
  push(raw: number, nowMs: number): number {
    if (this.lastMs === null) {
      this.lastMs = nowMs
      this.level = raw
      return this.level
    }
    const dt = Math.max(0, (nowMs - this.lastMs) / 1000)
    this.lastMs = nowMs
    if (raw >= this.level) {
      this.level = raw // attack: instant
    } else {
      // release: decay toward the new (lower) value
      const k = Math.exp(-dt * this.releasePerSec)
      this.level = raw + (this.level - raw) * k
    }
    return this.level
  }

  get value(): number {
    return this.level
  }

  reset(): void {
    this.level = 0
    this.lastMs = null
  }
}

/**
 * Is this source actually hearing anything?
 *
 * The bug this replaces: `level > 0.02` evaluated against a 42ms RMS window,
 * so every inter-word gap flipped the status dot. Two thresholds plus a hold
 * mean the answer changes on the timescale of "is someone talking", not on
 * the timescale of individual phonemes.
 */
export class LivenessGate {
  private live = false
  private lastLoudMs = -Infinity

  constructor(
    private opts: { openLevel: number; closeLevel: number; holdMs: number }
  ) {}

  update(level: number, nowMs: number): boolean {
    if (level >= this.opts.openLevel) {
      this.lastLoudMs = nowMs
      this.live = true
    } else if (this.live && level < this.opts.closeLevel) {
      // only give up after the hold expires — a pause is not silence
      if (nowMs - this.lastLoudMs >= this.opts.holdMs) this.live = false
    }
    return this.live
  }

  get value(): boolean {
    return this.live
  }

  reset(): void {
    this.live = false
    this.lastLoudMs = -Infinity
  }
}
