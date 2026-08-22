import { beforeAll, describe, expect, it } from 'vitest'
import { HybridMatcher } from '@/lib/matcher'
import { isQuestionLike } from '@/lib/engine'
import { EmbeddingCache } from '@/lib/embeddings'
import type { Answer } from '@shared/types'
import seed from '@shared/seed.json'
import paraphrases from './fixtures/paraphrases.json'
import coverageFixture from './fixtures/coverage.json'
import { EMBED_MODEL, REAL, realEmbeddingProvider } from './helpers/realModel'

/**
 * Is a different encoder worth installing?
 *
 * Accuracy tables cannot answer that, and neither can "it feels better". Two
 * populations decide it: the things that SHOULD match, and the things that
 * should not. What matters is whether a threshold exists that separates them
 * — everything else is a consequence of where that threshold is put.
 *
 * So every number here is threshold-free. The suite sweeps for the best bar
 * each encoder could possibly have, and reports the accuracy it would reach
 * there, next to d′ (separation in units of the populations' own spread) and
 * pair-ordering (the chance a true pair outscores a false one). A candidate
 * that loses on these cannot be rescued by retuning; a candidate that wins
 * has just handed you the constants to retune to.
 *
 *   LIH_REAL_MODELS=1 LIH_MODELS_DIR=<dir> npx vitest run tests/encoder.real.test.ts
 *   …with LIH_EMBED_MODEL=Xenova/bge-small-en-v1.5 to score a candidate.
 */

const entries = seed.answers as unknown as Answer[]

interface Stats {
  n: number
  min: number
  max: number
  mean: number
  median: number
  sd: number
}

function stats(xs: number[]): Stats {
  const s = [...xs].sort((a, b) => a - b)
  const mean = s.reduce((a, b) => a + b, 0) / s.length
  const variance = s.reduce((a, b) => a + (b - mean) ** 2, 0) / s.length
  return {
    n: s.length,
    min: s[0],
    max: s[s.length - 1],
    mean,
    median: s[Math.floor(s.length / 2)],
    sd: Math.sqrt(variance)
  }
}

/** separation in units of the two populations' own spread */
function dPrime(a: Stats, b: Stats): number {
  const pooled = Math.sqrt((a.sd ** 2 + b.sd ** 2) / 2)
  return pooled === 0 ? Infinity : (a.mean - b.mean) / pooled
}

/** P(a random true scores above a random false) — rank-based, so a squashed
 *  score range costs nothing and only the ORDER counts */
function pairOrdering(trues: number[], falses: number[]): number {
  let wins = 0
  for (const t of trues) for (const f of falses) wins += t > f ? 1 : t === f ? 0.5 : 0
  return wins / (trues.length * falses.length)
}

/** the best bar this encoder could have, and what it would get there */
function bestThreshold(
  trues: number[],
  falses: number[]
): { at: number; accuracy: number; misses: number; falseHits: number } {
  const marks = [...new Set([...trues, ...falses])].sort((a, b) => a - b)
  let best = { at: 0, accuracy: 0, misses: trues.length, falseHits: 0 }
  for (const m of marks) {
    const at = m - 1e-9
    const misses = trues.filter((t) => t < at).length
    const falseHits = falses.filter((f) => f >= at).length
    const accuracy = 1 - (misses + falseHits) / (trues.length + falses.length)
    if (accuracy > best.accuracy) best = { at: m, accuracy, misses, falseHits }
  }
  return best
}

const pct = (x: number): string => `${(x * 100).toFixed(1)}%`
const row = (label: string, s: Stats): string =>
  `  ${label.padEnd(20)} n=${String(s.n).padEnd(4)} min ${s.min.toFixed(3)}  median ${s.median.toFixed(3)}  mean ${s.mean.toFixed(3)}  max ${s.max.toFixed(3)}  sd ${s.sd.toFixed(3)}`

describe.skipIf(!REAL)(`encoder report: ${EMBED_MODEL}`, () => {
  let cache: EmbeddingCache
  let matcher: HybridMatcher

  beforeAll(async () => {
    cache = new EmbeddingCache(await realEmbeddingProvider())
    matcher = new HybridMatcher(cache)
    await cache.ensure([
      ...entries.map((e) => e.question),
      ...entries.flatMap((e) => e.triggerPhrases),
      ...entries.flatMap((e) => e.points.map((p) => p.text)),
      ...paraphrases.paraphrases.map((p) => p.text),
      ...paraphrases.offBank.map((p) => p.text),
      ...paraphrases.mangled.map((m) => m.text),
      ...coverageFixture.deliveries.map((d) => d.text),
      ...coverageFixture.nearMisses.map((d) => d.text)
    ])
  }, 600_000)

  it('reports how separable matching is, without reference to any threshold', () => {
    const score = (text: string): number =>
      matcher.score(text, entries, undefined, isQuestionLike(text))[0]?.score ?? 0

    // "should match": a paraphrase of something in the bank
    const shouldMatch = paraphrases.paraphrases.map((p) => score(p.text))
    // "should not": a question this bank has no answer for
    const shouldNot = paraphrases.offBank.map((p) => score(p.text))

    const t = stats(shouldMatch)
    const f = stats(shouldNot)
    const best = bestThreshold(shouldMatch, shouldNot)

    // rank quality, independent of any bar at all
    const top1 = paraphrases.paraphrases.filter(
      (p) => matcher.score(p.text, entries, undefined, true)[0]?.entryId === p.entryId
    ).length
    const top3 = paraphrases.paraphrases.filter((p) =>
      matcher
        .score(p.text, entries, undefined, true)
        .slice(0, 3)
        .some((c) => c.entryId === p.entryId)
    ).length
    const mangledTop3 = paraphrases.mangled.filter((m) =>
      matcher
        .score(m.text, entries, undefined, isQuestionLike(m.text))
        .slice(0, 3)
        .some((c) => c.entryId === m.entryId)
    ).length

    console.log(
      [
        `\n  === MATCHING · ${EMBED_MODEL} ===`,
        row('paraphrase of a bank Q', t),
        row('not in the bank', f),
        `  ${'d′'.padEnd(20)} ${dPrime(t, f).toFixed(2)}   pair-ordering ${pct(pairOrdering(shouldMatch, shouldNot))}`,
        `  ${'best possible bar'.padEnd(20)} ${best.at.toFixed(3)} → ${pct(best.accuracy)} (${best.misses} missed, ${best.falseHits} false)`,
        `  ${'right entry top-1'.padEnd(20)} ${top1}/${paraphrases.paraphrases.length}   top-3 ${top3}/${paraphrases.paraphrases.length}`,
        `  ${'mangled top-3'.padEnd(20)} ${mangledTop3}/${paraphrases.mangled.length}`
      ].join('\n')
    )

    // The gate: the two populations have to be orderable. Below this the
    // encoder is guessing and no retune rescues it.
    expect(pairOrdering(shouldMatch, shouldNot)).toBeGreaterThan(0.9)
    expect(top3 / paraphrases.paraphrases.length).toBeGreaterThan(0.9)
  })

  it('reports the same for coverage, where a false strike is the costly error', () => {
    const sim = (a: string, b: string): number => cache.similarity(a, b) ?? 0
    const trues: number[] = []
    const falses: number[] = []
    const pointsOf = (id: string) => entries.find((e) => e.id === id)?.points ?? []

    for (const d of coverageFixture.deliveries) {
      for (const p of pointsOf(d.entryId)) {
        ;(p.id === d.pointId ? trues : falses).push(sim(d.text, p.text))
      }
    }
    for (const m of coverageFixture.nearMisses) {
      for (const p of pointsOf(m.entryId)) falses.push(sim(m.text, p.text))
    }

    const t = stats(trues)
    const f = stats(falses)
    const best = bestThreshold(trues, falses)

    console.log(
      [
        `\n  === COVERAGE · ${EMBED_MODEL} ===`,
        row('said it', t),
        row('did not say it', f),
        `  ${'d′'.padEnd(20)} ${dPrime(t, f).toFixed(2)}   pair-ordering ${pct(pairOrdering(trues, falses))}`,
        `  ${'best possible bar'.padEnd(20)} ${best.at.toFixed(3)} → ${pct(best.accuracy)} (${best.misses} missed, ${best.falseHits} false strikes)`,
        `  ${'headroom'.padEnd(20)} ${(t.min - f.max).toFixed(3)} between the weakest true and the strongest false\n`
      ].join('\n')
    )

    expect(pairOrdering(trues, falses)).toBeGreaterThan(0.95)
  })
})
