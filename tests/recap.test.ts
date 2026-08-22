import { describe, expect, it } from 'vitest'
import { deriveRecap, exportNotes } from '@/lib/recap'
import seed from '@shared/seed.json'
import type { Bank, SessionQuestion, SessionRecord } from '@shared/types'

const bank = seed as unknown as Bank

function q(partial: Partial<SessionQuestion> & { id: string }): SessionQuestion {
  return {
    askedAtSec: 60,
    question: 'Q',
    entryId: null,
    coveredPointIds: [],
    totalPoints: 0,
    micSeconds: 60,
    pinnedViaFind: false,
    ...partial
  }
}

function record(questions: SessionQuestion[], transcriptKept = true): SessionRecord {
  return {
    id: 's1',
    loopId: 'loop-meridian',
    startedAt: 0,
    endedAt: 42 * 60000,
    transcriptKept,
    questions
  }
}

describe('deriveRecap', () => {
  it('computes stats over matched questions only', () => {
    const r = deriveRecap(
      record([
        q({ id: 'q1', entryId: 'a-er-case', totalPoints: 4, coveredPointIds: ['p-erc-1', 'p-erc-2', 'p-erc-3'] }),
        q({ id: 'q2', entryId: 'a-coach', totalPoints: 3, coveredPointIds: ['p-cch-1', 'p-cch-2', 'p-cch-3'] }),
        q({ id: 'q3', question: 'Pay transparency?' })
      ]),
      bank
    )
    expect(r.stats).toEqual({ covered: 6, totalPoints: 7, matched: 2, unmatched: 1 })
    expect(r.eyebrow).toBe('SESSION ENDED · 42 MINUTES')
    expect(r.sub).toBe('3 questions heard · 2 matched to your bank')
  })

  it('writes the three sub-line shapes', () => {
    const r = deriveRecap(
      record([
        q({ id: 'q1', entryId: 'a-coach', totalPoints: 3, coveredPointIds: ['p-cch-1', 'p-cch-2', 'p-cch-3'] }),
        q({ id: 'q2', entryId: 'a-er-case', totalPoints: 4, coveredPointIds: ['p-erc-1'] }),
        q({ id: 'q3', question: 'Pay transparency?' })
      ]),
      bank
    )
    expect(r.rows[0].subLine).toBe('All 3 points covered')
    expect(r.rows[1].subLine).toMatch(/^Missed: /)
    expect(r.rows[1].subLine).toContain(' · ') // two missed points, dot-separated
    expect(r.rows[2].subLine).toBe('Not in your bank')
    expect(r.rows[2].coveredPct).toBeNull()
    expect(r.rows[0].counter).toBe('3/3')
    expect(r.rows[1].coveredPct).toBe(25)
  })

  it('appends "· transcript off" when the transcript was not kept', () => {
    const r = deriveRecap(
      record([q({ id: 'q1', entryId: 'a-coach', totalPoints: 3, coveredPointIds: [] })], false),
      bank
    )
    expect(r.rows[0].subLine).toMatch(/· transcript off$/)
    expect(r.rows[0].transcriptOff).toBe(true)
  })

  it('generates one fix of each kind and caps at four', () => {
    const r = deriveRecap(
      record([
        q({ id: 'q1', question: 'Pay transparency?', transcript: [{ speaker: 'you', text: 'range architecture' }] }),
        q({ id: 'q2', entryId: 'a-er-case', totalPoints: 4, coveredPointIds: ['p-erc-1'] }),
        q({ id: 'q3', entryId: 'a-coach', totalPoints: 3, coveredPointIds: ['p-cch-1', 'p-cch-2', 'p-cch-3'], micSeconds: 160 }),
        q({ id: 'q4', entryId: 'a-policy', totalPoints: 3, coveredPointIds: ['p-pol-1', 'p-pol-3'], pinnedViaFind: true }),
        q({ id: 'q5', question: 'Another unknown?' })
      ]),
      bank
    )
    expect(r.fixes.map((f) => f.kind)).toEqual(['draft', 'uncovered', 'long', 'override'])
    expect(r.fixes.length).toBe(4)
    const long = r.fixes.find((f) => f.kind === 'long')!
    expect(long.title).toMatch(/ran 2:40$/)
    const draft = r.fixes.find((f) => f.kind === 'draft')!
    expect(draft.question).toBe('Pay transparency?')
    expect(draft.excerpt).toContain('range architecture')
  })

  it('a perfect session produces no fixes and no practice entries', () => {
    const r = deriveRecap(
      record([q({ id: 'q1', entryId: 'a-coach', totalPoints: 3, coveredPointIds: ['p-cch-1', 'p-cch-2', 'p-cch-3'] })]),
      bank
    )
    expect(r.fixes).toEqual([])
    expect(r.practiceEntryIds).toEqual([])
  })

  it('practiceEntryIds lists matched entries with missed points, deduped', () => {
    const r = deriveRecap(
      record([
        q({ id: 'q1', entryId: 'a-er-case', totalPoints: 4, coveredPointIds: ['p-erc-1'] }),
        q({ id: 'q2', entryId: 'a-er-case', totalPoints: 4, coveredPointIds: ['p-erc-1'] }),
        q({ id: 'q3', entryId: 'a-policy', totalPoints: 3, coveredPointIds: [] })
      ]),
      bank
    )
    expect(r.practiceEntryIds).toEqual(['a-er-case', 'a-policy'])
  })
})

describe('exportNotes', () => {
  it('writes markdown with covered/missed checkboxes, the story, and the excerpt', () => {
    const md = exportNotes(
      record([
        q({
          id: 'q1',
          question: 'Tell me about a difficult ER case.',
          entryId: 'a-er-case',
          totalPoints: 4,
          coveredPointIds: ['p-erc-1'],
          transcript: [{ speaker: 'them', text: 'tell me about a difficult case' }]
        })
      ]),
      bank
    )
    expect(md).toContain('## 01:00 — Tell me about a difficult ER case.')
    expect(md).toContain('- [x] Start with the risk')
    expect(md).toContain('- [ ] The decision stood up — no grievance, no appeal')
    expect(md).toContain('**Story used:** Warehouse harassment investigation, Q2')
    expect(md).toContain('them: tell me about a difficult case')
  })
})

// "You have no answer for this" and "you have one and the matcher did not
// reach it" are different problems. Until now the recap said the first about
// both, and the second is much the cheaper fix.
describe('a question that nearly matched', () => {
  const near = (nearMissEntryId: string | null): SessionRecord => ({
    id: 's-near',
    loopId: 'loop-meridian',
    startedAt: Date.now(),
    endedAt: Date.now() + 60_000,
    transcriptKept: false,
    questions: [
      {
        id: 'q-1',
        askedAtSec: 30,
        question: 'What is your approach when a manager is running their team into the ground?',
        entryId: null,
        coveredPointIds: [],
        totalPoints: 0,
        micSeconds: 40,
        pinnedViaFind: false,
        nearMissEntryId
      }
    ]
  })

  it('names the answer that nearly came up instead of "not in your bank"', () => {
    const data = deriveRecap(near('a-coach'), bank)
    expect(data.rows[0].subLine).toMatch(/closest was/i)
    expect(data.rows[0].subLine).toMatch(/coach a manager/i)
    expect(data.rows[0].subLine).not.toMatch(/not in your bank/i)
  })

  it('still says "not in your bank" when nothing was close', () => {
    expect(deriveRecap(near(null), bank).rows[0].subLine).toBe('Not in your bank')
  })

  it('offers teaching the existing answer before writing a new one', () => {
    const fixes = deriveRecap(near('a-coach'), bank).fixes
    expect(fixes[0].kind).toBe('near-miss')
    expect(fixes[0].entryId).toBe('a-coach')
    // the heard wording travels as a suggestion for the trigger field; the
    // fix itself never writes a phrase
    expect(fixes[0].question).toMatch(/running their team into the ground/)
    expect(fixes.filter((f) => f.kind === 'draft')).toHaveLength(0)
  })

  it('shows no score anywhere — "missed by 0.02" is not a thing to publish', () => {
    const data = deriveRecap(near('a-coach'), bank)
    expect(JSON.stringify(data)).not.toMatch(/0\.\d\d/)
  })

  it('falls back to drafting when the near-miss entry has since been deleted', () => {
    const fixes = deriveRecap(near('a-deleted-entry'), bank).fixes
    expect(fixes[0].kind).toBe('draft')
    expect(deriveRecap(near('a-deleted-entry'), bank).rows[0].subLine).toBe('Not in your bank')
  })
})
