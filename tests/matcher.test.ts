import { describe, expect, it } from 'vitest'
import { HybridMatcher } from '@/lib/matcher'
import { EmbeddingCache } from '@/lib/embeddings'
import { TUNING } from '@shared/tuning'
import seed from '@shared/seed.json'
import type { Answer, Bank } from '@shared/types'

const bank = seed as unknown as Bank
const entries: Answer[] = bank.answers

describe('HybridMatcher scoring', () => {
  const matcher = new HybridMatcher()

  it('near-verbatim question wording scores confident for its entry', () => {
    const utterance =
      'So to start — tell me about a time you handled a really difficult employee relations case.'
    const candidates = matcher.score(utterance, entries)
    expect(candidates[0].entryId).toBe('a-er-case')
    expect(matcher.classify(candidates)).toBe('confident')
  })

  it('a trigger-phrase hit adds the boost', () => {
    const entry = entries.find((e) => e.id === 'a-er-case')!
    const withTrigger = matcher.score('a really difficult employee relations case, tell me', [entry])[0]
    const without = matcher.score('a really tough situation with a person, tell me', [entry])[0]
    expect(withTrigger.score - without.score).toBeGreaterThanOrEqual(TUNING.triggerBoost * 0.9)
  })

  it('trigger matching is fuzzy against small transcription errors', () => {
    const entry = entries.find((e) => e.id === 'a-er-case')!
    const c = matcher.score('tell me about a dificult employee relatons case you handled', [entry])[0]
    expect(c.score).toBeGreaterThanOrEqual(TUNING.triggerBoost)
  })

  it('unrelated speech matches nothing', () => {
    const candidates = matcher.score(
      "What's your approach to pay transparency conversations, when someone finds out a peer earns more?",
      entries
    )
    expect(matcher.classify(candidates)).toBe('none')
  })

  it('the fixture ambiguous question lands in the ambiguous band with both harassment candidates', () => {
    const candidates = matcher.score(
      'Say a harassment complaint lands on your desk — how do you run the investigation?',
      entries
    )
    expect(matcher.classify(candidates)).toBe('ambiguous')
    const shortlist = matcher.shortlist(candidates).map((c) => c.entryId)
    expect(shortlist.length).toBeGreaterThanOrEqual(2)
    expect(shortlist[0]).toBe('a-invest-run') // the leader the countdown auto-picks
    expect(shortlist).toContain('a-informal')
  })

  it('the fixture coaching question is a confident match', () => {
    const candidates = matcher.score(
      "I've got a manager who's burning their team out — how do you coach a manager in that spot?",
      entries
    )
    expect(candidates[0].entryId).toBe('a-coach')
    expect(matcher.classify(candidates)).toBe('confident')
  })
})

describe('classification thresholds', () => {
  const matcher = new HybridMatcher()
  const c = (scores: number[]) => scores.map((score, i) => ({ entryId: `e${i}`, score }))

  it('confident needs top ≥ confident AND margin ≥ confidentMargin', () => {
    expect(matcher.classify(c([TUNING.confident, TUNING.confident - TUNING.confidentMargin]))).toBe('confident')
    expect(matcher.classify(c([TUNING.confident, TUNING.confident - TUNING.confidentMargin + 0.01]))).toBe('ambiguous')
    expect(matcher.classify(c([TUNING.confident - 0.01, 0.1]))).toBe('ambiguous')
  })

  it('ambiguous needs top ≥ ambiguous', () => {
    expect(matcher.classify(c([TUNING.ambiguous]))).toBe('ambiguous')
    expect(matcher.classify(c([TUNING.ambiguous - 0.01]))).toBe('none')
    expect(matcher.classify([])).toBe('none')
  })

  it('shortlist caps at maxCandidates', () => {
    const list = c([0.9, 0.8, 0.7, 0.6, 0.5])
    expect(matcher.shortlist(list).length).toBe(TUNING.maxCandidates)
  })
})

describe('trigger phrases are recognised semantically, not just literally', () => {
  // The bug: trigger phrases only ever reached the score through fuzzy edit
  // distance, so "hardest investigation" matched "the hardest investigation"
  // and missed "the case that gave you the most trouble" completely — which is
  // precisely the job a trigger phrase exists to do.
  function cacheOf(vectors: Record<string, number[]>): EmbeddingCache {
    return new EmbeddingCache({
      ready: true,
      embed: async (texts) => texts.map((t) => Float32Array.from(vectors[t] ?? [0, 0, 1]))
    })
  }

  const entry: Answer = {
    id: 'A',
    question: 'Tell me about a difficult employee relations case.',
    sectionId: 's',
    loopIds: [],
    points: [],
    storyId: null,
    triggerPhrases: ['hardest investigation'],
    lastUsed: null
  }
  const other: Answer = { ...entry, id: 'B', question: 'Why this team?', triggerPhrases: [] }
  // a paraphrase that shares no wording with either the question or the phrase
  const asked = 'the case that gave you the most trouble'

  it('matches on a paraphrase of the trigger phrase', async () => {
    const cache = cacheOf({
      [asked]: [1, 0, 0],
      'hardest investigation': [1, 0, 0], // the phrase means the same thing…
      [entry.question]: [0, 1, 0], // …while the canonical question does not
      [other.question]: [0, 0, 1]
    })
    await cache.ensure([asked, 'hardest investigation', entry.question, other.question])
    const [top] = new HybridMatcher(cache).score(asked, [entry, other])
    expect(top.entryId).toBe('A')
    expect(top.score).toBeGreaterThan(TUNING.confident)
  })

  it('lets the canonical question win a tie against a phrase', async () => {
    const cache = cacheOf({
      [asked]: [1, 0, 0],
      'hardest investigation': [1, 0, 0],
      [entry.question]: [1, 0, 0], // both perfect…
      [other.question]: [1, 0, 0]
    })
    await cache.ensure([asked, 'hardest investigation', entry.question, other.question])
    const scores = new HybridMatcher(cache).score(asked, [entry, other])
    // …so the discount must not lift the phrase above its own question
    const a = scores.find((c) => c.entryId === 'A')!
    const b = scores.find((c) => c.entryId === 'B')!
    expect(a.score).toBeCloseTo(b.score, 5)
  })
})

describe('the repeat prior', () => {
  const matcher = new HybridMatcher()
  const asked = 'Tell me about a time you handled a difficult employee relations case.'

  it('demotes an entry already answered this session', () => {
    const before = matcher.score(asked, entries)
    const after = matcher.score(asked, entries, (id) =>
      id === 'a-er-case' ? -TUNING.repeatPenalty : 0
    )
    const b = before.find((c) => c.entryId === 'a-er-case')!
    const a = after.find((c) => c.entryId === 'a-er-case')!
    expect(b.score - a.score).toBeCloseTo(TUNING.repeatPenalty, 5)
  })

  it('is small enough not to unseat a genuine re-ask on its own', () => {
    const after = matcher.score(asked, entries, (id) =>
      id === 'a-er-case' ? -TUNING.repeatPenaltyMax : 0
    )
    expect(after[0].entryId).toBe('a-er-case')
  })

  it('never drives a score below zero', () => {
    const scores = matcher.score('completely unrelated chatter about lunch', entries, () => -1)
    expect(Math.min(...scores.map((c) => c.score))).toBeGreaterThanOrEqual(0)
  })
})

describe('embedding blend once the model is warm', () => {
  function fakeCache(vectors: Record<string, number[]>): EmbeddingCache {
    const cache = new EmbeddingCache({
      ready: true,
      embed: async (texts) => texts.map((t) => Float32Array.from(vectors[t] ?? [0, 0, 1]))
    })
    return cache
  }

  it('cosine similarity dominates the score when vectors are cached', async () => {
    const q = 'Tell me about handling conflict at work'
    const entryA: Answer = {
      id: 'A',
      question: 'Describe a conflict you resolved',
      sectionId: 's',
      loopIds: [],
      points: [],
      storyId: null,
      triggerPhrases: [],
      lastUsed: null
    }
    const entryB: Answer = { ...entryA, id: 'B', question: 'Where do you want your career to go?' }
    const cache = fakeCache({
      [q]: [1, 0, 0],
      [entryA.question]: [1, 0, 0], // identical direction → cos 1
      [entryB.question]: [0, 1, 0] // orthogonal → cos 0
    })
    await cache.ensure([q, entryA.question, entryB.question])
    const matcher = new HybridMatcher(cache)
    const [top, bottom] = matcher.score(q, [entryA, entryB])
    expect(top.entryId).toBe('A')
    expect(top.score).toBeGreaterThanOrEqual(TUNING.embeddingWeight)
    expect(bottom.score).toBeLessThan(0.2)
  })
})

// ---- trigger-phrase guardrails (REVIEW.md H13) ------------------------------

describe('fuzzyPhraseHit guardrails', async () => {
  const { fuzzyPhraseHit } = await import('@/lib/text')
  const { TUNING } = await import('@shared/tuning')
  const hit = (phrase: string, utterance: string) =>
    fuzzyPhraseHit(phrase, utterance, TUNING.triggerFuzz)

  it('a short phrase must appear verbatim — no fuzz headroom', () => {
    expect(hit('why us', 'so tell me, why us specifically?')).toBe(true)
    expect(hit('why us', 'and why is this role open?')).toBe(false)
    expect(hit('five years', 'where do you see yourself in five years')).toBe(true)
    expect(hit('five years', 'five tears in this job would break anyone')).toBe(false)
  })

  it('no sorted-token matching for 2-word phrases', () => {
    expect(hit('why us', 'tell us why you left your last role')).toBe(false)
  })

  it('longer reordered phrases still hit via sorted tokens', () => {
    expect(hit('burning out their team', "a manager who's burning their team out")).toBe(true)
  })

  it('a window without any exact content word cannot hit', () => {
    expect(hit('why this role', 'why this rule matters to us')).toBe(false)
    expect(hit('why this role', 'why this role appeals to you')).toBe(true)
  })
})

// ---- question-likeness (REVIEW.md M12) --------------------------------------

describe('isQuestionLike', async () => {
  const { isQuestionLike } = await import('@/lib/engine')

  it('hears requests phrased without a question mark', () => {
    expect(isQuestionLike("I'd love to hear about a time you disagreed with a leader")).toBe(true)
    expect(isQuestionLike('Talk about a mistake that had real consequences')).toBe(true)
    expect(isQuestionLike('Can you share an example of coaching a manager')).toBe(true)
    expect(isQuestionLike('Give us a sense of how you run investigations')).toBe(true)
    expect(isQuestionLike('Could you take me through your first week')).toBe(true)
    expect(isQuestionLike('Suppose leadership asked you to bend a policy')).toBe(true)
    expect(isQuestionLike('Have you ever changed a leader’s mind')).toBe(true)
  })

  it('does not fire on a bare interrogative mid-statement', () => {
    expect(isQuestionLike("that's why we moved the interview online")).toBe(false)
    expect(isQuestionLike('we know what is at stake for the team here')).toBe(false)
  })

  it('still fires on an interrogative opening a clause', () => {
    expect(isQuestionLike('Why this team')).toBe(true)
    expect(isQuestionLike('Right. What would you change first')).toBe(true)
  })
})
