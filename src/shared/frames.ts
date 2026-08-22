import type { Settings } from './types'
import type { ViewName } from './ipc'

// Pure window-frame planning, split out of windows.ts so the (view ×
// placement) matrix is unit-testable. REVIEW.md C6 was exactly a hole in this
// matrix: live + strip placement fell into the ordinary-window branch, which
// dropped always-on-top, re-centered the hidden window, and stole focus at
// the first matched question.

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface FramePlan {
  bounds: Rect
  /** always-on-top + visible-on-all-workspaces + content protection */
  helper: boolean
  /** how (whether) to reveal the window after applying the frame */
  show: 'active' | 'inactive' | 'none'
}

export const VIEW_FRAMES: Record<ViewName, { width: number; height: number }> = {
  setup: { width: 880, height: 812 },
  armed: { width: 412, height: 400 },
  live: { width: 412, height: 836 },
  bank: { width: 1280, height: 812 },
  recap: { width: 880, height: 812 }
}

export function frameFor(
  view: ViewName,
  placement: Settings['placement'] | undefined,
  wa: Rect
): FramePlan {
  const frame = VIEW_FRAMES[view]

  if (view === 'live') {
    // docked right against the display edge — it resizes nothing else
    const bounds = { x: wa.x + wa.width - 412, y: wa.y, width: 412, height: wa.height }
    if (placement === 'strip') {
      // the strip window is the visible surface; the session window takes the
      // live frame but stays hidden until the user expands — showing it here
      // was the focus-steal at the first matched question (REVIEW.md C6)
      return { bounds, helper: true, show: 'none' }
    }
    return { bounds, helper: true, show: 'inactive' }
  }

  if (view === 'armed') {
    return {
      bounds: {
        x: wa.x + wa.width - frame.width - 14,
        y: wa.y + 14,
        width: frame.width,
        height: frame.height
      },
      helper: true,
      show: 'inactive'
    }
  }

  // setup / bank / recap are ordinary centered windows
  return {
    bounds: {
      x: wa.x + Math.round((wa.width - frame.width) / 2),
      y: wa.y + Math.round((wa.height - frame.height) / 2),
      width: frame.width,
      height: frame.height
    },
    helper: false,
    show: 'active'
  }
}

/** Saved strip position, clamped to reality: a position remembered on a
 *  monitor that is no longer connected must not open the strip off-screen
 *  while the main window hides behind it (REVIEW.md H14). `wa` is the work
 *  area of the display nearest the saved rect. */
export function clampStripPosition(
  saved: { x: number; y: number } | null,
  size: { width: number; height: number },
  wa: Rect,
  fallback: { x: number; y: number }
): { x: number; y: number } {
  if (!saved) return fallback
  // require a meaningful part of the strip inside the work area
  const left = Math.max(saved.x, wa.x)
  const right = Math.min(saved.x + size.width, wa.x + wa.width)
  const top = Math.max(saved.y, wa.y)
  const bottom = Math.min(saved.y + size.height, wa.y + wa.height)
  const visibleW = right - left
  const visibleH = bottom - top
  if (visibleW >= Math.min(120, size.width) && visibleH >= Math.min(20, size.height)) {
    return saved
  }
  return fallback
}
