import { useRef } from 'react'
import Strip from '../screens/strip/Strip'
import type { StripProps } from '../screens/contracts'
import { useBankStore, answersForLoop } from '../state/bankStore'
import { useSessionStore } from '../state/sessionStore'
import { useSettingsStore } from '../state/settingsStore'
import { setCollapsed } from './runtime'

// Share-safe strip: shows only the current point. When a new question is
// heard while collapsed it nudges (border/dot/"New: …") but never auto-expands.

export default function StripContainer({ overlay = true }: { overlay?: boolean }): JSX.Element | null {
  const match = useSessionStore((s) => s.match)
  const coverage = useSessionStore((s) => s.coverage)
  const loopId = useSessionStore((s) => s.loopId)
  const bank = useBankStore((s) => s.bank)
  const protectionOn = useSettingsStore((s) => s.contentProtection)

  // the entry that was showing when the strip collapsed (= when this mounted) —
  // a different one (or an unsure state) arriving afterwards is a "new question"
  const entryAtCollapse = useRef<string | null>(match.entryId)

  if (!bank) return null
  const entries = answersForLoop(bank, loopId ?? bank.activeLoopId)
  const entry = match.entryId ? entries.find((e) => e.id === match.entryId) : null

  let props: StripProps
  const isNew =
    match.state === 'ambiguous' ||
    (entry != null && entryAtCollapse.current != null && entry.id !== entryAtCollapse.current)

  if (isNew) {
    const question = match.state === 'ambiguous' ? (match.heard ?? '') : (entry?.question ?? '')
    props = {
      variant: 'new-question',
      text: `New: ${question}`,
      counter: null,
      overlay,
      protectionOn,
      onExpand: () => setCollapsed(false)
    }
  } else if (entry) {
    const coveredIds = new Set(coverage[entry.id] ?? [])
    const total = entry.points.length
    const idx = entry.points.findIndex((p) => !coveredIds.has(p.id))
    const shown = idx === -1 ? total - 1 : idx
    const text = entry.points[shown]?.text ?? ''
    // counter is the position of the shown point; the last one reads N/N
    // ("next point queued" in the design)
    props = {
      variant: shown === total - 1 ? 'queued' : 'current',
      text,
      counter: `${shown + 1}/${total}`,
      overlay,
      protectionOn,
      onExpand: () => setCollapsed(false)
    }
  } else {
    props = {
      variant: 'current',
      text: 'Listening — nothing matched yet',
      counter: null,
      overlay,
      protectionOn,
      onExpand: () => setCollapsed(false)
    }
  }

  return <Strip {...props} />
}
