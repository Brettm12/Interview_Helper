import type { Answer } from '@shared/types'
import type { StripState } from '@shared/ipc'
import type { MatchSlice } from '../state/sessionStore'

// Pure derivation of the share-safe strip's one-line state, shared by the
// in-window strip (web/mock) and the IPC publisher that feeds the Electron
// strip window. Kept store-free so it is directly testable.

export function deriveStripState(args: {
  entries: Answer[]
  match: MatchSlice
  coverage: Record<string, string[]>
  /** entry showing when the strip collapsed — a different one arriving
   *  afterwards (or an unsure state) is a "new question" nudge */
  entryAtCollapse: string | null
  protectionOn: boolean
}): StripState {
  const { entries, match, coverage, entryAtCollapse, protectionOn } = args
  const entry = match.entryId ? entries.find((e) => e.id === match.entryId) : null

  const isNew =
    match.state === 'ambiguous' ||
    (entry != null && entryAtCollapse != null && entry.id !== entryAtCollapse)

  if (isNew) {
    const question = match.state === 'ambiguous' ? (match.heard ?? '') : (entry?.question ?? '')
    return { variant: 'new-question', text: `New: ${question}`, counter: null, protectionOn }
  }

  if (entry) {
    const coveredIds = new Set(coverage[entry.id] ?? [])
    const total = entry.points.length
    const idx = entry.points.findIndex((p) => !coveredIds.has(p.id))
    const shown = idx === -1 ? total - 1 : idx
    return {
      // counter is the position of the shown point; the last one reads N/N
      // ("next point queued" in the design)
      variant: shown === total - 1 ? 'queued' : 'current',
      text: entry.points[shown]?.text ?? '',
      counter: `${shown + 1}/${total}`,
      protectionOn
    }
  }

  return {
    variant: 'current',
    text: 'Listening — nothing matched yet',
    counter: null,
    protectionOn
  }
}

export function stripStatesEqual(a: StripState | null, b: StripState | null): boolean {
  if (a === null || b === null) return a === b
  return (
    a.variant === b.variant &&
    a.text === b.text &&
    a.counter === b.counter &&
    a.protectionOn === b.protectionOn
  )
}

/** Leading+trailing throttle over material changes: identical states never
 *  send; a changed state sends immediately when the window is clear, else one
 *  trailing timer delivers the latest offered state. */
export function createStripPublisher(opts: {
  send: (s: StripState) => void
  minIntervalMs: number
  now?: () => number
}): { offer(s: StripState): void; dispose(): void } {
  const now = opts.now ?? Date.now
  let lastSent: StripState | null = null
  let lastSentAt = -Infinity
  let pending: StripState | null = null
  let timer: ReturnType<typeof setTimeout> | null = null

  const flush = (): void => {
    timer = null
    if (pending && !stripStatesEqual(pending, lastSent)) {
      lastSent = pending
      lastSentAt = now()
      opts.send(pending)
    }
    pending = null
  }

  return {
    offer: (s) => {
      if (stripStatesEqual(s, timer ? pending : lastSent)) return
      const since = now() - lastSentAt
      if (!timer && since >= opts.minIntervalMs) {
        lastSent = s
        lastSentAt = now()
        opts.send(s)
        return
      }
      pending = s
      if (!timer) timer = setTimeout(flush, Math.max(0, opts.minIntervalMs - since))
    },
    dispose: () => {
      if (timer) clearTimeout(timer)
      timer = null
      pending = null
    }
  }
}
