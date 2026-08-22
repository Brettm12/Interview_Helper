import { useEffect, useMemo, useState } from 'react'
import { TUNING } from '@shared/tuning'
import LivePanel from '../screens/live/LivePanel'
import type {
  LivePanelProps,
  MatchedBodyProps,
  PointView,
  TranscriptLineView,
  UnsureBodyProps
} from '../screens/contracts'
import { useSessionStore } from '../state/sessionStore'
import { useAudioStore } from '../state/audioStore'
import { useBankStore, answersForLoop, storyById } from '../state/bankStore'
import { usePanelStore } from '../state/panelStore'
import { useSettingsStore } from '../state/settingsStore'
import { formatClock, formatRan } from '../lib/recap'
import { isTypingTarget, unsureKeyAction } from '../lib/keys'
import { getEngine, setCollapsed } from './runtime'

// Binds the session/bank stores to the live panel. The panel itself is
// presentational; every behaviour routes through the engine's command surface.

export default function LiveContainer(): JSX.Element | null {
  const match = useSessionStore((s) => s.match)
  const coverage = useSessionStore((s) => s.coverage)
  const history = useSessionStore((s) => s.history)
  const transcript = useSessionStore((s) => s.transcript)
  const paused = useSessionStore((s) => s.status === 'paused')
  const stale = useSessionStore((s) => s.match.stale)
  const autoPickSec = useSettingsStore((s) => s.autoPickSec)
  const activeMicSec = useSessionStore((s) => s.activeMicSec)
  const bank = useBankStore((s) => s.bank)
  const loopId = useSessionStore((s) => s.loopId)
  const transcriptVisible = usePanelStore((s) => s.transcriptVisible)
  const toggleTranscript = usePanelStore((s) => s.toggleTranscript)
  const openFind = usePanelStore((s) => s.openFind)
  // pipeline problems must be visible where the user is actually looking
  // mid-interview, not only in ⌘⇧D (REVIEW.md H2/C4)
  const notice = useAudioStore((s) => s.pipelineNotice)

  // 10 Hz tick while the unsure countdown runs
  const [, setTick] = useState(0)
  const counting = match.state === 'ambiguous' && match.autoPickAt != null
  useEffect(() => {
    if (!counting) return
    const id = window.setInterval(() => setTick((t) => t + 1), 100)
    return () => window.clearInterval(id)
  }, [counting])

  const entries = useMemo(
    () => (bank && loopId ? answersForLoop(bank, loopId) : []),
    [bank, loopId]
  )

  // Choosing a candidate with the mouse costs most of the four seconds you
  // have, and your eyes belong on the interviewer. 1/2/3 pick, Esc dismisses
  // (REVIEW.md P1). Bound here because this container mounts only in the live
  // view; the guards keep bare digits inert everywhere else.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const s = useSessionStore.getState()
      const panel = usePanelStore.getState()
      const action = unsureKeyAction(e, {
        unsure: s.match.state === 'ambiguous',
        findOpen: panel.find.open,
        collapsed: panel.collapsed,
        typing: isTypingTarget(document.activeElement),
        candidateCount: s.match.candidates.length
      })
      if (!action) return
      e.preventDefault()
      const engine = getEngine()
      if (action.kind === 'none') engine?.dismissUnsure()
      else engine?.pickCandidate(s.match.candidates[action.index].entryId)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (!bank) return null

  const line: TranscriptLineView | null = (() => {
    const last = transcript[transcript.length - 1]
    if (!last) return null
    return {
      speaker: last.speaker,
      text: last.text,
      highlight: last.highlight,
      trailingWords: last.confirmed ? 0 : 2
    }
  })()

  let matched: MatchedBodyProps | null = null
  let unsure: UnsureBodyProps | null = null
  const mode: LivePanelProps['mode'] = match.state === 'ambiguous' ? 'unsure' : 'matched'

  if (mode === 'unsure') {
    const remaining = match.autoPickAt != null ? Math.max(0, match.autoPickAt - Date.now()) : 0
    const total = (autoPickSec ?? TUNING.autoPickSec) * 1000
    unsure = {
      heard: match.heard ?? '',
      candidates: match.candidates.map((c) => {
        const entry = entries.find((e) => e.id === c.entryId)
        const story = entry ? storyById(bank, entry.storyId) : null
        return {
          entryId: c.entryId,
          title: entry?.question ?? '',
          sub: `${entry?.points.length ?? 0} points · ${story ? `${story.title} story` : 'no story yet'}`,
          pct: Math.round(Math.min(1, c.score) * 100)
        }
      }),
      // no deadline at all when the setting says "never" (REVIEW.md P5)
      countdownSec: match.autoPickAt == null ? null : Math.ceil(remaining / 1000),
      countdownPct: match.autoPickAt != null ? Math.min(100, 100 * (1 - remaining / total)) : 0,
      onPick: (id) => getEngine()?.pickCandidate(id),
      onNone: () => getEngine()?.dismissUnsure(),
      onSearchBank: openFind
    }
  } else {
    const entry = match.entryId ? entries.find((e) => e.id === match.entryId) : null
    if (entry) {
      const coveredIds = new Set(coverage[entry.id] ?? [])
      const firstUncovered = entry.points.findIndex((p) => !coveredIds.has(p.id))
      const points: PointView[] = entry.points.map((p, i) => ({
        id: p.id,
        text: p.text,
        state: coveredIds.has(p.id) ? 'covered' : i === firstUncovered ? 'current' : 'upcoming'
      }))
      const story = storyById(bank, entry.storyId)
      matched = {
        question: entry.question,
        covered: coveredIds.size,
        total: entry.points.length,
        // the recap flags a long answer afterwards; this is the same fact
        // while you can still do something about it (REVIEW.md P9)
        pacing: activeMicSec > TUNING.longAnswerSec ? `${formatRan(activeMicSec)} on this one` : null,
        points,
        onTogglePoint: (pid) => getEngine()?.togglePoint(entry.id, pid),
        story: story ? { label: 'STORY TO TELL', body: story.body, metrics: story.metrics } : null,
        earlier: history
          .filter((h) => h.entryId !== entry.id)
          .slice(0, 4)
          .map((h) => ({
            // keyed on the history identity, not display text — two rows can
            // share question+minute after a merge (REVIEW.md L8)
            key: `${h.entryId}-${h.askedAt}`,
            question: entries.find((e) => e.id === h.entryId)?.question ?? '',
            time: formatClock(h.askedAt),
            // the way back from a wrong swap, without ⌘K stealing focus and
            // asking you to type while someone watches your face
            onResume: () => getEngine()?.resumeEntry(h.entryId)
          }))
      }
    }
  }

  return (
    <LivePanel
      mode={mode}
      matched={matched}
      unsure={unsure}
      transcript={line}
      paused={paused}
      stale={stale}
      notice={notice}
      transcriptVisible={transcriptVisible}
      onToggleTranscript={toggleTranscript}
      onFind={openFind}
      onCollapse={() => setCollapsed(true)}
      onSearchBank={openFind}
    />
  )
}
