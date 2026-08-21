import { beforeAll, describe, expect, it } from 'vitest'
import { HybridMatcher } from '@/lib/matcher'
import { EmbeddingCache, type EmbeddingProvider } from '@/lib/embeddings'
import type { Answer, Candidate } from '@shared/types'
import seed from '@shared/seed.json'
import fixture from './fixtures/paraphrases.json'

// Calibration against the REAL MiniLM model — the thresholds in tuning.ts are
// only meaningful relative to actual embedding geometry, and symbolic tests
// cannot catch them being consistently wrong (REVIEW.md H1).
//
// Gated: needs the model on disk and a couple of minutes.
//   LIH_REAL_MODELS=1 LIH_MODELS_DIR=/path/to/models npx vitest run tests/calibration.real.test.ts
// LIH_MODELS_DIR must contain Xenova/all-MiniLM-L6-v2/{config.json,tokenizer.json,
// tokenizer_config.json,onnx/model_quantized.onnx} — the layout `npm run
// fetch-models -- --dest <dir>` produces.
//
// Three contracts:
//  - an honest paraphrase of a bank question puts the right entry on top (or
//    top-2 for the deliberately-twinned harassment entries) at ambiguous or
//    better — the panel must show *something right* when the interviewer uses
//    their own words;
//  - an off-bank question classifies none — no confidently-wrong card;
//  - trigger-adjacent statements and wrong-topic questions never classify
//    confident — the trigger boost must not conjure matches (REVIEW.md C7/H13).

const REAL = process.env.LIH_REAL_MODELS === '1'
const MODELS_DIR = process.env.LIH_MODELS_DIR

// the two entries deliberately sharing the "harassment complaint" trigger; the
// unsure card showing both is the designed outcome (DECISIONS.md)
const TWINS = new Set(['a-invest-run', 'a-informal'])

const entries = seed.answers as unknown as Answer[]

describe.skipIf(!REAL)('matching calibration against real MiniLM', () => {
  let matcher: HybridMatcher
  let cache: EmbeddingCache

  beforeAll(async () => {
    if (!MODELS_DIR) throw new Error('LIH_MODELS_DIR is required with LIH_REAL_MODELS=1')
    const { pipeline, env } = await import('@xenova/transformers')
    env.localModelPath = MODELS_DIR
    env.allowRemoteModels = false
    const extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2')
    const provider: EmbeddingProvider = {
      ready: true,
      async embed(texts: string[]): Promise<Float32Array[]> {
        const out: Float32Array[] = []
        for (const t of texts) {
          const r = (await extractor(t, { pooling: 'mean', normalize: true })) as {
            data: Float32Array
          }
          out.push(Float32Array.from(r.data))
        }
        return out
      }
    }
    cache = new EmbeddingCache(provider)
    matcher = new HybridMatcher(cache)
    const texts = [
      ...entries.map((e) => e.question),
      ...entries.flatMap((e) => e.triggerPhrases),
      ...fixture.paraphrases.map((p) => p.text),
      ...fixture.offBank.map((p) => p.text),
      ...fixture.triggerAbuse.map((p) => p.text)
    ]
    await cache.ensure(texts)
  }, 300_000)

  // single seam the recalibration (and any matcher signature change) updates
  const scoreText = (text: string): Candidate[] => matcher.score(text, entries)

  it.each(fixture.paraphrases)('paraphrase matches: $text', ({ text, entryId }) => {
    const candidates = scoreText(text)
    const state = matcher.classify(candidates)
    const topIds = candidates.slice(0, 2).map((c) => c.entryId)
    expect(state, `classified none — top was ${candidates[0]?.entryId} @ ${candidates[0]?.score.toFixed(3)}`).not.toBe('none')
    if (TWINS.has(entryId)) {
      expect(topIds, 'twin entry must be in the top 2').toContain(entryId)
    } else {
      expect(candidates[0]?.entryId, `top-1 mismatch @ ${candidates[0]?.score.toFixed(3)}`).toBe(entryId)
    }
  })

  it.each(fixture.offBank)('off-bank stays none: $text', ({ text }) => {
    const candidates = scoreText(text)
    expect(
      matcher.classify(candidates),
      `top was ${candidates[0]?.entryId} @ ${candidates[0]?.score.toFixed(3)}`
    ).toBe('none')
  })

  it.each(fixture.triggerAbuse)('never confident on: $text', ({ text }) => {
    const candidates = scoreText(text)
    expect(
      matcher.classify(candidates),
      `top was ${candidates[0]?.entryId} @ ${candidates[0]?.score.toFixed(3)}`
    ).not.toBe('confident')
  })

  it('prints the calibration table', () => {
    const rows = [
      ...fixture.paraphrases.map((p) => ({ kind: 'paraphrase', ...p })),
      ...fixture.offBank.map((p) => ({ kind: 'off-bank', entryId: '', ...p })),
      ...fixture.triggerAbuse.map((p) => ({ kind: 'abuse', entryId: '', ...p }))
    ]
    for (const row of rows) {
      const c = scoreText(row.text)
      const state = matcher.classify(c)
      console.log(
        `${row.kind.padEnd(10)} ${state.padEnd(9)} top ${c[0]?.entryId.padEnd(13)} ${c[0]?.score.toFixed(3)}  2nd ${c[1]?.entryId.padEnd(13)} ${c[1]?.score.toFixed(3)}  | ${row.text.slice(0, 60)}`
      )
    }
    expect(rows.length).toBeGreaterThan(0)
  })
})
