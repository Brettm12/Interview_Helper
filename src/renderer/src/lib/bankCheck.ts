import type { Answer } from '@shared/types'
import type { HybridMatcher, MatchState } from './matcher'
import { TUNING, type Tuning } from '@shared/tuning'

// Rehearsing the live decision at prep time. Two questions the bank cannot
// answer for you today:
//
//   "if they ask me THIS, what comes up?"          — the paste box
//   "which of my answers will the matcher confuse?" — the collision report
//
// Both run the real matcher over the real embeddings, because a check that
// scores differently from the interview is worse than no check at all.
//
// The report is capped at three, and every finding carries something to do
// about it. A ranked list of every confusable pair is homework, not help —
// and homework the night before an interview does not get done.

export interface CheckRow {
  entryId: string
  question: string
}

export interface CheckResult {
  /** what the panel would do with this question */
  state: MatchState
  /** the entries that would be involved, best first — never any numbers: a
   *  score on screen invites tuning a bank against a threshold, and the
   *  number means nothing without the distribution behind it */
  rows: CheckRow[]
}

/** what would happen if the interviewer asked this */
export function checkQuestion(
  text: string,
  entries: Answer[],
  matcher: HybridMatcher
): CheckResult | null {
  if (text.trim() === '' || entries.length === 0) return null
  const candidates = matcher.score(text, entries, undefined, true)
  const state = matcher.classify(candidates)
  const shown = state === 'confident' ? candidates.slice(0, 1) : matcher.shortlist(candidates)
  return {
    state,
    rows: shown.map((c) => ({
      entryId: c.entryId,
      question: entries.find((e) => e.id === c.entryId)?.question ?? ''
    }))
  }
}

export type CollisionKind = 'wrong-top' | 'close-rival' | 'shared-phrase'

export interface Collision {
  /** the entry that loses: asking IT is what goes wrong */
  entryId: string
  /** the entry it collides with */
  withId: string
  kind: CollisionKind
  /** one sentence, in the user's terms, about what happens live */
  detail: string
  /** the phrase both entries answer to, for 'shared-phrase' */
  phrase?: string
}

/**
 * The entries that will confuse the matcher, worst first.
 *
 * Each entry is probed with its OWN wording against the REST of the bank.
 * An entry always wins its own question, so ranking it against the field says
 * nothing useful; what matters is how strong the runner-up is without it. The
 * interviewer will paraphrase, and a paraphrase only ever scores lower — so a
 * rival already at the confident bar on the exact wording is a rival that can
 * take the panel on the day.
 *
 * Severity, in the order that matters live:
 *  1. wrong-top     - another answer clears the confidence bar on this
 *                     question, so it can come up instead.
 *  2. shared-phrase - two entries answer to the same trigger phrase, so the
 *                     phrase can never decide between them.
 *  3. close-rival   - another answer is already plausible on the exact
 *                     wording, so a paraphrase will land between them.
 */
export function findCollisions(
  entries: Answer[],
  matcher: HybridMatcher,
  limit = 3,
  tuning: Tuning = TUNING
): Collision[] {
  const found: (Collision & { rank: number })[] = []
  const byId = new Map(entries.map((e) => [e.id, e]))
  const quoted = (id: string, fallback: string): string =>
    `“${byId.get(id)?.question ?? fallback}”`

  for (const entry of entries) {
    // Score the entry's own wording against everything EXCEPT itself. An
    // entry always wins its own question outright, so comparing it to the
    // field says nothing; what matters is how the rest of the bank does on
    // it, judged by the same two bars the live panel uses.
    const others = entries.filter((e) => e.id !== entry.id)
    if (others.length === 0) continue
    const rival = matcher.score(entry.question, others, undefined, true)[0]
    if (!rival) continue
    if (rival.score >= tuning.confident) {
      found.push({
        entryId: entry.id,
        withId: rival.entryId,
        kind: 'wrong-top',
        detail: `${quoted(rival.entryId, rival.entryId)} is strong enough on this exact wording to come up instead.`,
        rank: 0
      })
      // The ambiguous bar is too generous for a report: in a bank of "tell me
      // about a time you…" questions, most entries have SOME rival above it,
      // and three findings drawn from nine are noise. A rival within one
      // confidence margin of the bar is the one that can still take the panel
      // once the interviewer's paraphrase has cost the right answer a tenth.
    } else if (rival.score >= tuning.confident - tuning.confidentMargin) {
      found.push({
        entryId: entry.id,
        withId: rival.entryId,
        kind: 'close-rival',
        detail: `${quoted(rival.entryId, rival.entryId)} is nearly as good an answer to this - reworded, they will arrive as the pick-one card.`,
        // strongest rival first: that is the pair most likely to fight
        rank: 2 + (1 - rival.score)
      })
    }
  }

  // exact phrase clashes are certain rather than probable, so they rank above
  // the margin cases whatever the geometry says
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const a = entries[i]
      const b = entries[j]
      const shared = a.triggerPhrases.find((p) =>
        b.triggerPhrases.some((q) => q.toLowerCase().trim() === p.toLowerCase().trim())
      )
      if (!shared) continue
      found.push({
        entryId: a.id,
        withId: b.id,
        kind: 'shared-phrase',
        detail: `Both answer to “${shared}”, so the phrase can never tell them apart.`,
        phrase: shared,
        rank: 1
      })
    }
  }

  // one finding per pair - the same two entries colliding in both directions
  // is one thing to fix, not two
  const seen = new Set<string>()
  return found
    .sort((x, y) => x.rank - y.rank)
    .filter((c) => {
      const key = [c.entryId, c.withId].sort().join(' ')
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, limit)
    .map(({ rank: _rank, ...c }) => c)
}
