import { useMemo } from 'react'
import type { Answer, Bank } from '@shared/types'
import FindOverlay from '../screens/find/FindOverlay'
import type { FindResultView } from '../screens/contracts'
import { useBankStore, answersForLoop, storyById } from '../state/bankStore'
import { usePanelStore } from '../state/panelStore'
import { useSessionStore } from '../state/sessionStore'
import { diceCoefficient, normalize } from '../lib/text'
import { getEngine } from './runtime'

// ⌘K panic find: fuzzy across question text, key points, and story names.
// ↵ pins the selected entry into the live panel and suppresses auto-matching
// until the next detected question (engine.pinEntry sets state 'pinned').

const MAX_RESULTS = 8

export function searchBank(bank: Bank, entries: Answer[], query: string): Answer[] {
  const q = normalize(query)
  if (!q) return entries.slice(0, MAX_RESULTS)
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

  const entries = useMemo(() => {
    if (!bank) return []
    return answersForLoop(bank, loopId ?? bank.activeLoopId)
  }, [bank, loopId])

  const results = useMemo(
    () => (bank ? searchBank(bank, entries, find.query) : []),
    [bank, entries, find.query]
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

  const pin = (): void => {
    const target = results[find.selectedIndex]
    if (target) getEngine()?.pinEntry(target.id)
    panel.closeFind()
  }

  return (
    <div className="find-layer">
      <FindOverlay
        query={find.query}
        matchCount={results.length}
        results={views}
        selectedIndex={find.selectedIndex}
        onQueryChange={(q) => panel.setFindQuery(q)}
        onMove={(d) => panel.moveFind(d, results.length)}
        onPin={pin}
        onClose={() => panel.closeFind()}
      />
    </div>
  )
}
