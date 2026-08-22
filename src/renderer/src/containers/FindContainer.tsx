import { useEffect, useMemo } from 'react'
import type { Answer, Bank } from '@shared/types'
import FindOverlay from '../screens/find/FindOverlay'
import type { FindResultView } from '../screens/contracts'
import { useBankStore, answersForLoop, storyById } from '../state/bankStore'
import { usePanelStore } from '../state/panelStore'
import { useSessionStore } from '../state/sessionStore'
import { diceCoefficient, normalize } from '../lib/text'
import { api } from '../lib/api'
import { getEngine } from './runtime'

// ⌘K panic find: fuzzy across question text, key points, and story names.
// ↵ pins the selected entry into the live panel and suppresses auto-matching
// until the next detected question (engine.pinEntry sets state 'pinned').

const MAX_RESULTS = 8

/** what the session already knows when the overlay opens with nothing typed */
export interface FindContext {
  /** entries the matcher is currently torn between, in rank order */
  candidateIds: string[]
  /** entries already asked this session */
  askedIds: string[]
}

/**
 * The empty-query list is not a neutral moment: ⌘K under stress almost always
 * means the matcher was close but wrong, and the entry you want is usually
 * one it just shortlisted — or one that has not come up yet. Bank order put
 * both off the bottom of the list and made you type (REVIEW.md P3).
 * Deterministic, and only ever applied to the blank query.
 */
function contextOrder(entries: Answer[], ctx: FindContext): Answer[] {
  const rank = (a: Answer): number => {
    const candidateAt = ctx.candidateIds.indexOf(a.id)
    if (candidateAt >= 0) return candidateAt // 0..n — the shortlist, in order
    return ctx.askedIds.includes(a.id) ? 2000 : 1000 // fresh before already-asked
  }
  // a stable sort keeps bank order inside each band
  return entries
    .map((a, i) => ({ a, i, r: rank(a) }))
    .sort((x, y) => x.r - y.r || x.i - y.i)
    .map((x) => x.a)
}

export function searchBank(
  bank: Bank,
  entries: Answer[],
  query: string,
  ctx?: FindContext
): Answer[] {
  const q = normalize(query)
  if (!q) return (ctx ? contextOrder(entries, ctx) : entries).slice(0, MAX_RESULTS)
  const scored = entries.map((a) => {
    const story = storyById(bank, a.storyId)
    const haystacks = [a.question, ...a.points.map((p) => p.text), story?.title ?? '']
    let best = 0
    for (const h of haystacks) {
      const n = normalize(h)
      if (!n) continue
      let s = diceCoefficient(q, n)
      if (n.includes(q)) s = Math.max(s, 0.9)
      // any single query token appearing verbatim keeps the entry findable
      // while the query is still being typed
      else if (q.split(' ').some((t) => t.length >= 3 && n.includes(t))) s = Math.max(s, 0.5)
      best = Math.max(best, s)
    }
    return { a, best }
  })
  return scored
    .filter((s) => s.best >= 0.3)
    .sort((x, y) => y.best - x.best)
    .map((s) => s.a)
    .slice(0, MAX_RESULTS)
}

export default function FindContainer(): JSX.Element | null {
  const bank = useBankStore((s) => s.bank)
  const find = usePanelStore((s) => s.find)
  const loopId = useSessionStore((s) => s.loopId)

  // ⌘K stole focus so typing works (REVIEW.md C1); on close, hand it back
  useEffect(() => {
    if (!find.open) void api.windows.findClosed()
  }, [find.open])

  const entries = useMemo(() => {
    if (!bank) return []
    return answersForLoop(bank, loopId ?? bank.activeLoopId)
  }, [bank, loopId])

  // the shortlist the panel is showing right now, and what has already been
  // asked — the two things worth knowing when nothing is typed (REVIEW.md P3)
  const candidates = useSessionStore((s) => s.match.candidates)
  const questions = useSessionStore((s) => s.questions)
  const findContext = useMemo(
    () => ({
      candidateIds: candidates.map((c) => c.entryId),
      askedIds: questions.map((q) => q.entryId).filter((id): id is string => id != null)
    }),
    [candidates, questions]
  )

  const results = useMemo(
    () => (bank ? searchBank(bank, entries, find.query, findContext) : []),
    [bank, entries, find.query, findContext]
  )

  if (!bank || !find.open) return null

  const views: FindResultView[] = results.map((a, i) => {
    const story = storyById(bank, a.storyId)
    const selected = i === find.selectedIndex
    return {
      entryId: a.id,
      title: a.question,
      preview: selected ? a.points.map((p) => p.text) : null,
      sub: selected
        ? null
        : `${a.points.length} points · ${story ? story.title : 'no story yet'}`
    }
  })

  const panel = usePanelStore.getState()

  const pinEntry = (entryId: string): void => {
    getEngine()?.pinEntry(entryId)
    panel.closeFind()
  }

  const pin = (): void => {
    // the LIVE index, not this render's snapshot — reading the render-time
    // value pinned whatever was selected before the last move (REVIEW.md C5)
    const target = results[usePanelStore.getState().find.selectedIndex]
    if (target) pinEntry(target.id)
    else panel.closeFind()
  }

  return (
    <div className="find-layer">
      <FindOverlay
        query={find.query}
        matchCount={results.length}
        results={views}
        selectedIndex={find.selectedIndex}
        onQueryChange={(q) => panel.setFindQuery(q)}
        onPinEntry={pinEntry}
        onMove={(d) => panel.moveFind(d, results.length)}
        onPin={pin}
        onClose={() => panel.closeFind()}
      />
    </div>
  )
}
