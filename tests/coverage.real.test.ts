import { beforeAll, describe, expect, it } from 'vitest'
import { EmbeddingCoverage } from '@/lib/coverage'
import { EmbeddingCache } from '@/lib/embeddings'
import { TUNING } from '@shared/tuning'
import type { Answer, Point } from '@shared/types'
import seed from '@shared/seed.json'
import fixture from './fixtures/coverage.json'
import { EMBED_MODEL, REAL, realEmbeddingProvider } from './helpers/realModel'

// Coverage calibration against the REAL embedder. The matching thresholds
// have had `calibration.real.test.ts` since the review; the coverage
// thresholds had nothing at all — and they are the ones that decide whether a
// point gets struck through on screen while someone is mid-sentence.
//
// Two failure directions, and they are not symmetric:
//   a MISSED point leaves something on the card you have already said — mild;
//   a FALSE strike-through hides something you have NOT said, and you walk
//   out of the interview having skipped it. So the fixtures assert exactly
//   which points a delivery may cover, not merely that it covers its own.
//
// Gated exactly like the matching suite:
//   LIH_REAL_MODELS=1 LIH_MODELS_DIR=/path/to/models npx vitest run tests/coverage.real.test.ts
// LIH_EMBED_MODEL swaps the encoder, so a candidate can be scored against
// these same fixtures before anything ships.

const entries = seed.answers as unknown as Answer[]
const pointsOf = (entryId: string): Point[] =>
  entries.find((e) => e.id === entryId)?.points ?? []

describe.skipIf(!REAL)(`coverage calibration against ${EMBED_MODEL}`, () => {
  let coverage: EmbeddingCoverage
  let cache: EmbeddingCache

  beforeAll(async () => {
    cache = new EmbeddingCache(await realEmbeddingProvider())
    const texts = [
      ...entries.flatMap((e) => e.points.map((p) => p.text)),
      ...fixture.deliveries.map((d) => d.text),
      ...fixture.nearMisses.map((d) => d.text),
      ...fixture.windows.flatMap((w) => [...w.parts, w.parts.join(' ')])
    ]
    await cache.ensure(texts)
    coverage = new EmbeddingCoverage(cache)
  }, 300_000)

  it.each(fixture.deliveries)('covers its point, said aloud: $text', ({ entryId, pointId, text }) => {
    const covered = coverage.score(text, pointsOf(entryId))
    expect(covered, `covered ${JSON.stringify(covered)}`).toContain(pointId)
  })

  it.each(fixture.deliveries)('strikes nothing else on the card: $text', ({ entryId, pointId, text }) => {
    const covered = coverage.score(text, pointsOf(entryId))
    const extra = covered.filter((id) => id !== pointId)
    expect(extra, `also struck ${JSON.stringify(extra)}`).toEqual([])
  })

  it.each(fixture.deliveries)('strikes nothing on another answer entirely: $text', ({ entryId, text }) => {
    for (const other of entries) {
      if (other.id === entryId) continue
      const covered = coverage.score(text, other.points)
      expect(covered, `${other.id} struck ${JSON.stringify(covered)}`).toEqual([])
    }
  })

  it.each(fixture.nearMisses)('on-topic filler covers nothing: $text', ({ entryId, text }) => {
    const covered = coverage.score(text, pointsOf(entryId))
    expect(covered, `struck ${JSON.stringify(covered)}`).toEqual([])
  })

  // A point delivered across two breaths clears neither segment on its own.
  // The engine re-scores a rolling window for exactly this, at a higher bar
  // (more text is easier to match by accident).
  it.each(fixture.windows)('two breaths together cover $pointId', ({ entryId, pointId, parts }) => {
    const points = pointsOf(entryId)
    for (const part of parts) {
      expect(coverage.score(part, points), `"${part}" covered it alone`).not.toContain(pointId)
    }
    const joined = parts.join(' ')
    expect(coverage.score(joined, points, TUNING.coverageWindowMargin)).toContain(pointId)
  })

  // The check that decides whether a different encoder can work AT ALL. If
  // the deliveries and the near-misses overlap in cosine, no threshold
  // separates them and the feature is guesswork whatever number we pick.
  it('keeps real deliveries separable from what was never said', () => {
    const sim = (a: string, b: string): number => cache.similarity(a, b) ?? 0
    const trueScores: { score: number; text: string }[] = []
    const falseScores: { score: number; text: string }[] = []

    for (const d of fixture.deliveries) {
      for (const p of pointsOf(d.entryId)) {
        const row = { score: sim(d.text, p.text), text: `${p.id} ← ${d.text.slice(0, 46)}` }
        if (p.id === d.pointId) trueScores.push(row)
        else falseScores.push(row)
      }
    }
    for (const m of fixture.nearMisses) {
      for (const p of pointsOf(m.entryId)) {
        falseScores.push({ score: sim(m.text, p.text), text: `${p.id} ← ${m.text.slice(0, 46)}` })
      }
    }

    const byScore = (a: { score: number }, b: { score: number }): number => a.score - b.score
    trueScores.sort(byScore)
    falseScores.sort(byScore)
    const weakestTrue = trueScores[0]
    const strongestFalse = falseScores[falseScores.length - 1]
    const median = (xs: number[]): number => xs[Math.floor(xs.length / 2)]

    console.log(
      [
        `\n  encoder            ${EMBED_MODEL}`,
        `  coverage threshold ${TUNING.coverage}   (lexical fallback ${TUNING.coverageLexical})`,
        `  said it            n=${trueScores.length}  min ${weakestTrue.score.toFixed(3)}  median ${median(trueScores.map((t) => t.score)).toFixed(3)}  max ${trueScores[trueScores.length - 1].score.toFixed(3)}`,
        `  did not say it     n=${falseScores.length}  max ${strongestFalse.score.toFixed(3)}  median ${median(falseScores.map((t) => t.score)).toFixed(3)}`,
        `  weakest true       ${weakestTrue.score.toFixed(3)}  ${weakestTrue.text}`,
        `  strongest false    ${strongestFalse.score.toFixed(3)}  ${strongestFalse.text}`,
        `  separation         ${(weakestTrue.score - strongestFalse.score).toFixed(3)}`
      ].join('\n')
    )

    // the two populations have to be separable at all — if the weakest thing
    // someone really said scores below the strongest thing they did not, no
    // threshold works and the feature is guesswork whatever number we pick
    expect(
      weakestTrue.score,
      `weakest true delivery (${weakestTrue.text}) scores under the strongest false one (${strongestFalse.text})`
    ).toBeGreaterThan(strongestFalse.score)
    // nothing unsaid may clear the embedding bar: a false strike-through
    // hides a point the user then never makes
    expect(TUNING.coverage).toBeGreaterThan(strongestFalse.score)

    // The bar sits above a few genuine deliveries on purpose — the lexical
    // fallback is what catches those (an aphoristic point can be delivered
    // with its own words and still score under the cosine bar). That tail has
    // to stay a tail: if most deliveries need the fallback, the encoder is
    // not doing the work and the thresholds are meaningless.
    const onFallback = trueScores.filter((t) => t.score < TUNING.coverage)
    for (const t of onFallback) console.log(`  on the fallback    ${t.score.toFixed(3)}  ${t.text}`)
    expect(onFallback.length / trueScores.length).toBeLessThan(0.25)
  })
})
