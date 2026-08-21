import { describe, expect, it } from 'vitest'
import { EmbeddingCoverage } from '@/lib/coverage'
import { EmbeddingCache } from '@/lib/embeddings'
import { TUNING } from '@shared/tuning'
import seed from '@shared/seed.json'
import type { Bank, Point } from '@shared/types'

const bank = seed as unknown as Bank
const points = (answerId: string) => bank.answers.find((a) => a.id === answerId)!.points

describe('lexical coverage fallback (model cold)', () => {
  const coverage = new EmbeddingCoverage()

  it('marks a point covered when its substance is spoken (fixture Q1 lines)', () => {
    const pts = points('a-er-case')
    expect(
      coverage.score(
        'Sure — the riskiest one was two complainants against one long-tenured supervisor, at a site that was used to silence.',
        pts
      )
    ).toEqual(['p-erc-1'])
    expect(
      coverage.score('First move was to separate the people, not the payroll — schedule changes, no suspensions.', pts)
    ).toEqual(['p-erc-2'])
    expect(coverage.score('I ran eleven interviews in five days and documented as I went,', pts)).toEqual(['p-erc-3'])
  })

  it('does not cover a point that was never said', () => {
    const pts = points('a-er-case')
    expect(coverage.score('and in the end the supervisor left the business.', pts)).toEqual([])
  })

  it('covers the coaching answer point-by-point (fixture Q4 lines)', () => {
    const pts = points('a-coach')
    expect(
      coverage.score(
        "I'd show them their own attrition and overtime numbers first — those tell the story better than I can.",
        pts
      )
    ).toEqual(['p-cch-1'])
    expect(
      coverage.score('Then coach the behaviour, not the intention — almost none of them mean to do it.', pts)
    ).toEqual(['p-cch-2'])
    expect(
      coverage.score('And set a review date, because coaching without a checkpoint is a hope, not a plan.', pts)
    ).toEqual(['p-cch-3'])
  })

  it('fixture Q5 lines cover exactly points 1 and 3, never 2', () => {
    const pts = points('a-policy')
    expect(coverage.score('First, name the cost honestly on day one — people smell spin.', pts)).toEqual(['p-pol-1'])
    expect(coverage.score('And publish the exception path, because pressure needs a valve.', pts)).toEqual(['p-pol-3'])
  })

  it('unrelated speech covers nothing', () => {
    expect(coverage.score('The weather has been strange this week, hasn’t it?', points('a-er-case'))).toEqual([])
  })
})

describe('embedding coverage (model warm)', () => {
  async function warmCache(vectors: Record<string, number[]>): Promise<EmbeddingCache> {
    const cache = new EmbeddingCache({
      ready: true,
      embed: async (texts) => texts.map((t) => Float32Array.from(vectors[t] ?? [0, 0, 1]))
    })
    await cache.ensure(Object.keys(vectors))
    return cache
  }

  it('cosine ≥ threshold covers; below does not; lexical path is bypassed', async () => {
    const said = 'I owned the mistake in one sentence'
    const near = { id: 'p1', text: 'Own it in one sentence — no wind-up' } // cos ≈ .8
    const far = { id: 'p2', text: 'Own it in one sentence eventually' } // cos ≈ .3 despite lexical overlap
    const cache = await warmCache({
      [said]: [1, 0, 0],
      [near.text]: [0.8, 0.6, 0],
      [far.text]: [0.3, 0.954, 0]
    })
    const coverage = new EmbeddingCoverage(cache)
    expect(coverage.score(said, [near, far])).toEqual(['p1'])
  })
})

describe('a point delivered across two breaths', () => {
  // The bug: coverage was scored one confirmed segment at a time, so a point
  // made in two halves could clear the bar in neither and stayed un-struck
  // while the candidate had in fact made it.
  const points: Point[] = [
    {
      id: 'p1',
      text: 'Framed the disagreement around data, proposed a two-week test, and said out loud that I was partly wrong'
    }
  ]
  const halves = ['I framed it as a disagreement about the data', 'and proposed a two-week test']

  it('is missed by either half alone but caught by the window', () => {
    const model = new EmbeddingCoverage()
    for (const half of halves) expect(model.score(half, points)).toHaveLength(0)
    expect(model.score(halves.join(' '), points, TUNING.coverageWindowMargin)).toEqual(['p1'])
  })

  it('holds the window to a higher bar than a single segment', () => {
    // more text is easier to match by accident, so the margin has to bite
    const model = new EmbeddingCoverage()
    const joined = halves.join(' ')
    expect(model.score(joined, points)).toEqual(['p1'])
    expect(model.score(joined, points, 0.2)).toHaveLength(0)
  })
})
