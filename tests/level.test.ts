import { describe, expect, it } from 'vitest'
import { LivenessGate, MeterBallistics, dbfs, peak, rms } from '@/lib/dsp/level'
import { TUNING } from '@shared/tuning'

// The regression these pin: the setup screen's status dot was a bare
// threshold test against a ~42ms RMS window, so it flipped green→amber→green
// several times per sentence — and read as activity for a source that may
// never have worked at all.

describe('level measurement', () => {
  const filled = (v: number, n = 128): Float32Array => new Float32Array(n).fill(v)

  it('measures rms and peak', () => {
    expect(rms(filled(0.5))).toBeCloseTo(0.5, 6)
    expect(peak(new Float32Array([0.1, -0.9, 0.3]))).toBeCloseTo(0.9, 6)
    expect(rms(new Float32Array(0))).toBe(0)
  })

  it('floors dbfs instead of returning -Infinity on digital silence', () => {
    expect(dbfs(0)).toBe(-120)
    expect(dbfs(1)).toBeCloseTo(0, 6)
    expect(dbfs(0.1)).toBeCloseTo(-20, 3)
    expect(Number.isFinite(dbfs(0))).toBe(true)
  })
})

describe('MeterBallistics', () => {
  it('rises instantly and falls gradually', () => {
    const m = new MeterBallistics(3)
    m.push(0, 0)
    expect(m.push(0.8, 100)).toBeCloseTo(0.8, 6) // attack is instant
    const after = m.push(0, 200) // ~100ms of decay at 3/sec
    expect(after).toBeGreaterThan(0.5)
    expect(after).toBeLessThan(0.8)
  })

  it('settles toward the quiet value given enough time', () => {
    const m = new MeterBallistics(3)
    m.push(1, 0)
    let t = 0
    for (let i = 0; i < 30; i++) m.push(0, (t += 100))
    expect(m.value).toBeLessThan(0.06)
  })
})

describe('LivenessGate', () => {
  const gate = (): LivenessGate =>
    new LivenessGate({
      openLevel: TUNING.levelOpen,
      closeLevel: TUNING.levelClose,
      holdMs: TUNING.levelHoldMs
    })

  it('opens above the open level and holds through a pause', () => {
    const g = gate()
    expect(g.update(0.001, 0)).toBe(false)
    expect(g.update(0.2, 100)).toBe(true)
    // a 400ms gap between words must not drop the signal
    expect(g.update(0, 500)).toBe(true)
  })

  it('drops only after the hold expires', () => {
    const g = gate()
    g.update(0.2, 0)
    expect(g.update(0, TUNING.levelHoldMs - 1)).toBe(true)
    expect(g.update(0, TUNING.levelHoldMs + 1)).toBe(false)
  })

  it('does not flap across a realistic sentence of speech and pauses', () => {
    // the actual bug: ~23 frames/sec, energy dipping to zero in every
    // inter-word gap. Count how many times the answer changes.
    const g = gate()
    const m = new MeterBallistics(TUNING.levelReleasePerSec)
    let flips = 0
    let last: boolean | null = null
    let t = 0
    // 6 seconds: bursts of speech separated by 150–300ms gaps
    for (let word = 0; word < 12; word++) {
      for (let i = 0; i < 6; i++) {
        const live = g.update(m.push(0.25, (t += 43)), t)
        if (live !== last) flips++, (last = live)
      }
      const gapFrames = word % 2 === 0 ? 4 : 7 // ~170ms and ~300ms
      for (let i = 0; i < gapFrames; i++) {
        const live = g.update(m.push(0, (t += 43)), t)
        if (live !== last) flips++, (last = live)
      }
    }
    // exactly one transition: not-live → live, and it stays there
    expect(flips).toBe(1)
    expect(last).toBe(true)
  })

  it('still reports silence for a source that never makes a sound', () => {
    const g = gate()
    const m = new MeterBallistics(TUNING.levelReleasePerSec)
    let t = 0
    for (let i = 0; i < 200; i++) g.update(m.push(0, (t += 43)), t)
    expect(g.value).toBe(false)
  })

  it('has hysteresis: a level between close and open keeps an open gate open', () => {
    const g = gate()
    g.update(0.2, 0)
    const between = (TUNING.levelOpen + TUNING.levelClose) / 2
    expect(g.update(between, 5000)).toBe(true)
  })
})
