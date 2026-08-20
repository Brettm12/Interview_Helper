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
