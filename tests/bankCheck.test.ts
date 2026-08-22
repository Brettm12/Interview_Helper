import { describe, expect, it } from 'vitest'
import { checkQuestion, findCollisions } from '@/lib/bankCheck'
import { HybridMatcher } from '@/lib/matcher'
import { EmbeddingCache } from '@/lib/embeddings'
import type { Answer } from '@shared/types'

// The prep-time rehearsal of the live decision. These run the matcher on the
// lexical path (no embeddings) with hand-built entries, so the logic is
// pinned independently of the encoder; the real-model behaviour is the
// calibration suite's job.

const answer = (id: string, question: string, over: Partial<Answer> = {}): Answer => ({
  id,
  question,
  sectionId: 'sec',
  loopIds: ['loop'],
  storyId: null,
  triggerPhrases: [],
  lastUsed: null,
  points: [{ id: `${id}-p1`, text: 'a point' }],
  ...over
})

const matcher = (): HybridMatcher => new HybridMatcher()

describe('what would this match?', () => {
  const entries = [
    answer('a-mistake', 'Tell me about a mistake that had real consequences.'),
    answer('a-why', 'Why this team?'),
    answer('a-pressure', 'How do you handle several urgent cases at once?')
  ]

  it('names the entry that would come up, and no score', () => {
    const res = checkQuestion('Tell me about a mistake that had real consequences.', entries, matcher())!
    expect(res.state).toBe('confident')
    expect(res.rows[0]).toEqual({
      entryId: 'a-mistake',
      question: 'Tell me about a mistake that had real consequences.'
    })
    // the shape carries no numbers at all — a score on a prep surface invites
    // tuning a bank against a threshold
    expect(JSON.stringify(res)).not.toMatch(/score/)
  })

  it('says nothing would come up when nothing does', () => {
    const res = checkQuestion('What is your current notice period?', entries, matcher())!
    expect(res.state).toBe('none')
    expect(res.rows).toEqual([])
  })

  it('shows the shortlist when the panel would ask you to pick', () => {
    const twins = [
      answer('a-1', 'How do you run a harassment investigation from a complaint?'),
      answer('a-2', 'How do you run a harassment investigation into a manager?')
    ]
    const res = checkQuestion('How do you run a harassment investigation', twins, matcher())!
    expect(res.state).toBe('ambiguous')
    expect(res.rows.map((r) => r.entryId).sort()).toEqual(['a-1', 'a-2'])
  })

  it('is null on an empty question and on an empty loop', () => {
    expect(checkQuestion('   ', entries, matcher())).toBeNull()
    expect(checkQuestion('anything', [], matcher())).toBeNull()
  })
})

describe('which answers will the matcher confuse?', () => {
  it('finds nothing when every entry wins its own question outright', () => {
    const entries = [
      answer('a-why', 'Why this team?'),
      answer('a-term', 'Tell me about a termination that did not go to plan.'),
      answer('a-multi', 'How do you keep managers compliant across provinces?')
    ]
    expect(findCollisions(entries, matcher())).toEqual([])
  })

  it('reports a pair once, not once per direction', () => {
    const entries = [
      answer('a-1', 'Walk me through how you run a harassment investigation.'),
      answer('a-2', 'Walk me through how you run a harassment investigation now.'),
      answer('a-why', 'Why this team?')
    ]
    const found = findCollisions(entries, matcher())
    expect(found).toHaveLength(1)
    expect([found[0].entryId, found[0].withId].sort()).toEqual(['a-1', 'a-2'])
    expect(found[0].detail).toMatch(/harassment investigation/)
  })

  it('orders by what actually happens live: takeover, then phrase, then tie', () => {
    const entries = [
      answer('a-1', 'Tell me about a difficult employee relations case.', {
        triggerPhrases: ['harassment complaint']
      }),
      answer('a-2', 'How do you run a harassment investigation?', {
        triggerPhrases: ['harassment complaint']
      }),
      answer('a-3', 'How do you handle several urgent cases at once?'),
      answer('a-4', 'What is your approach when three escalations land in one week?'),
      answer('a-5', 'How do you handle a difficult stakeholder?'),
      answer('a-6', 'Tell me about a difficult stakeholder you worked with.')
    ]
    const found = findCollisions(entries, matcher())
    expect(found.map((f) => f.kind)).toEqual(['wrong-top', 'shared-phrase', 'close-rival'])
    expect(found[1].phrase).toBe('harassment complaint')
    expect(found[1].detail).toMatch(/never tell them apart/)
  })

  it('matches a shared phrase regardless of case and spacing', () => {
    const entries = [
      answer('a-1', 'Why this team?', { triggerPhrases: [' Why Us '] }),
      answer('a-2', 'Where do you want to take your career?', { triggerPhrases: ['why us'] })
    ]
    expect(findCollisions(entries, matcher())[0]?.kind).toBe('shared-phrase')
  })

  it('caps the report — three findings with remedies beat twenty without', () => {
    const entries = Array.from({ length: 10 }, (_, i) =>
      answer(`a-${i}`, `Tell me about a time you handled a difficult situation number ${i}.`)
    )
    expect(findCollisions(entries, matcher()).length).toBeLessThanOrEqual(3)
    expect(findCollisions(entries, matcher(), 5).length).toBeLessThanOrEqual(5)
  })

  it('calls out an answer another entry could take outright', () => {
    // the same question twice: either one can take the panel on the day, and
    // nothing about the wording will ever decide between them
    const entries = [
      answer('a-1', 'Tell me about working with a difficult stakeholder.'),
      answer('a-2', 'Tell me about working with a difficult stakeholder.'),
      answer('a-why', 'Why this team?')
    ]
    const found = findCollisions(entries, matcher())
    expect(found[0].kind).toBe('wrong-top')
    expect(found[0].detail).toMatch(/come up instead/)
  })

  it('says nothing about a single entry with nothing to collide with', () => {
    expect(findCollisions([answer('a-1', 'Why this team?')], matcher())).toEqual([])
  })

  it('uses the encoder when one is warm, not just word overlap', async () => {
    // two questions sharing no words that the encoder puts on top of each
    // other: word overlap alone sees nothing here
    const entries = [
      answer('a-1', 'Why this team?'),
      answer('a-2', 'What draws you here?'),
      answer('a-3', 'Talk me through your notice period and start date.')
    ]
    const vectors: Record<string, number[]> = {
      'Why this team?': [1, 0, 0],
      'What draws you here?': [0.999, 0.045, 0],
      'Talk me through your notice period and start date.': [0, 0, 1]
    }
    const cache = new EmbeddingCache({
      ready: true,
      embed: async (texts) => texts.map((t) => Float32Array.from(vectors[t] ?? [0, 1, 0]))
    })
    await cache.ensure(Object.keys(vectors))
    const found = findCollisions(entries, new HybridMatcher(cache))
    expect(found).toHaveLength(1)
    expect([found[0].entryId, found[0].withId].sort()).toEqual(['a-1', 'a-2'])
  })
})
