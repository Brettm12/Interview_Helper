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
