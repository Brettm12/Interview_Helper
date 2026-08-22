import { describe, expect, it } from 'vitest'
import { clampStripPosition, frameFor } from '@shared/frames'

// The (view × placement) frame matrix, pure and pinned — REVIEW.md C6 was a
// hole in exactly this matrix, and it needed an xvfb probe to find.

const WA = { x: 0, y: 0, width: 1600, height: 1000 }

describe('frameFor', () => {
  it('docked live: right-edge panel, helper behaviour, shown without focus', () => {
    const p = frameFor('live', 'docked', WA)
    expect(p.bounds).toEqual({ x: 1600 - 412, y: 0, width: 412, height: 1000 })
    expect(p.helper).toBe(true)
    expect(p.show).toBe('inactive')
  })

  it('live + strip placement keeps helper behaviour and stays hidden (C6)', () => {
    // the strip window is the visible surface; showing (and centering) the
    // session window here was the focus-steal at the first matched question
    const p = frameFor('live', 'strip', WA)
    expect(p.helper).toBe(true)
    expect(p.show).toBe('none')
    expect(p.bounds.width).toBe(412) // live frame, ready for expand
  })

  it('armed: top-right card, helper, no focus steal', () => {
    const p = frameFor('armed', 'docked', WA)
    expect(p.bounds).toEqual({ x: 1600 - 412 - 14, y: 14, width: 412, height: 400 })
    expect(p.helper).toBe(true)
    expect(p.show).toBe('inactive')
  })

  it.each(['setup', 'bank', 'recap'] as const)('%s: ordinary centered focused window', (view) => {
    const p = frameFor(view, 'docked', WA)
    expect(p.helper).toBe(false)
    expect(p.show).toBe('active')
    expect(p.bounds.x).toBeGreaterThan(0)
    expect(p.bounds.x + p.bounds.width).toBeLessThanOrEqual(WA.width)
  })

  it('second-screen placement behaves like docked for the session window', () => {
    const p = frameFor('live', 'second-screen', WA)
    expect(p.helper).toBe(true)
    expect(p.show).toBe('inactive')
  })
})

describe('clampStripPosition (H14)', () => {
  const SIZE = { width: 366, height: 39 }
  const FALLBACK = { x: 1600 - 366 - 14, y: 14 }

  it('keeps a position that is on-screen', () => {
    expect(clampStripPosition({ x: 100, y: 100 }, SIZE, WA, FALLBACK)).toEqual({ x: 100, y: 100 })
  })

  it('falls back when the saved position is on a monitor that is gone', () => {
    // saved at x:4000 on a disconnected external display
    expect(clampStripPosition({ x: 4000, y: 4000 }, SIZE, WA, FALLBACK)).toEqual(FALLBACK)
  })

  it('falls back when only a sliver would remain visible', () => {
    expect(clampStripPosition({ x: 1590, y: 100 }, SIZE, WA, FALLBACK)).toEqual(FALLBACK)
    expect(clampStripPosition({ x: 100, y: -35 }, SIZE, WA, FALLBACK)).toEqual(FALLBACK)
  })

  it('keeps a position that is mostly visible at an edge', () => {
    expect(clampStripPosition({ x: 1600 - 200, y: 10 }, SIZE, WA, FALLBACK)).toEqual({
      x: 1400,
      y: 10
    })
  })

  it('no saved position → fallback', () => {
    expect(clampStripPosition(null, SIZE, WA, FALLBACK)).toEqual(FALLBACK)
  })
})
