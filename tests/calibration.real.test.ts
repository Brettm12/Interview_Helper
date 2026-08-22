import { beforeAll, describe, expect, it } from 'vitest'
import { HybridMatcher } from '@/lib/matcher'
import { isQuestionLike } from '@/lib/engine'
import { EmbeddingCache } from '@/lib/embeddings'
import { REAL, realEmbeddingProvider } from './helpers/realModel'
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

// the two entries deliberately sharing the "harassment complaint" trigger; the
// unsure card showing both is the designed outcome (DECISIONS.md)
const TWINS = new Set(['a-invest-run', 'a-informal'])

const entries = seed.answers as unknown as Answer[]

describe.skipIf(!REAL)('matching calibration against real MiniLM', () => {
  let matcher: HybridMatcher
  let cache: EmbeddingCache

  beforeAll(async () => {
    cache = new EmbeddingCache(await realEmbeddingProvider())
    matcher = new HybridMatcher(cache)
    const texts = [
      ...entries.map((e) => e.question),
      ...entries.flatMap((e) => e.triggerPhrases),
      ...fixture.paraphrases.map((p) => p.text),
      ...fixture.offBank.map((p) => p.text),
      ...fixture.triggerAbuse.map((p) => p.text),
      ...fixture.mangled.flatMap((m) => [m.clean, m.text])
    ]
    await cache.ensure(texts)
  }, 300_000)

  // single seam mirroring how the engine scores a segment: the matcher gets
  // the same question-likeness signal, which gates the trigger boost (C7)
  const scoreText = (text: string): Candidate[] =>
    matcher.score(text, entries, undefined, isQuestionLike(text))

  it.each(fixture.paraphrases)('paraphrase matches: $text', (p) => {
    const { text, entryId } = p
    const candidates = scoreText(text)
    const state = matcher.classify(candidates)
    const topIds = candidates.slice(0, 2).map((c) => c.entryId)
    expect(state, `classified none — top was ${candidates[0]?.entryId} @ ${candidates[0]?.score.toFixed(3)}`).not.toBe('none')
    if (TWINS.has(entryId)) {
      expect(topIds, 'twin entry must be in the top 2').toContain(entryId)
    } else if ('shortlisted' in p && p.shortlisted) {
      // cluster-adjacent paraphrases: the right entry appearing on the unsure
      // card (top 3 shortlist) is the designed outcome — the user taps it
      const shortlist = matcher.shortlist(candidates).map((c) => c.entryId)
      expect(shortlist, 'entry must be on the unsure shortlist').toContain(entryId)
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

  it.each(fixture.statements)('a topical statement never outranks its topic: $text', ({ text, entryId }) => {
    // an on-topic statement may legitimately surface a card early — but the
    // trigger boost must never pull a DIFFERENT entry above the topical one
    const candidates = scoreText(text)
    expect(candidates[0]?.entryId).toBe(entryId)
  })

  // ---- what the transcriber actually hands us ------------------------------
  // Every fixture above is clean prose. Whisper does not produce clean prose:
  // it drops the terminal question mark (which gates question-likeness, and
  // with it the trigger boost), runs two sentences together, leaves the
  // disfluencies in, and mishears the low-frequency words this bank is full
  // of. These are invariants against the clean wording in the same row —
  // relative, never absolute, so a red here means the transcript broke the
  // match rather than that the clean set needs retuning.

  it.each(fixture.mangled)('$kind — still shows something: $text', ({ clean, text }) => {
    const cleanState = matcher.classify(scoreText(clean))
    if (cleanState === 'none') return // nothing to preserve
    const mangled = scoreText(text)
    expect(
      matcher.classify(mangled),
      `clean was ${cleanState}; mangled fell to none (top ${mangled[0]?.entryId} @ ${mangled[0]?.score.toFixed(3)})`
    ).not.toBe('none')
  })

  it.each(fixture.mangled)('$kind — the right entry stays reachable: $text', ({ clean, text, entryId }) => {
    const cleanShortlist = matcher.shortlist(scoreText(clean)).map((c) => c.entryId)
    if (!cleanShortlist.includes(entryId)) return // it was not reachable clean either
    const shortlist = matcher.shortlist(scoreText(text)).map((c) => c.entryId)
    expect(shortlist, `shortlist became ${JSON.stringify(shortlist)}`).toContain(entryId)
  })

  it.each(fixture.mangled)('$kind — never confidently wrong: $text', ({ clean, text }) => {
    const mangled = scoreText(text)
    if (matcher.classify(mangled) !== 'confident') return
    // a mangled transcript may lose confidence; it must never GAIN it for a
    // different entry — that is a wrong answer on screen with a green dot
    expect(mangled[0]?.entryId).toBe(scoreText(clean)[0]?.entryId)
  })

  it('prints what the mangling costs', () => {
    for (const m of fixture.mangled) {
      const c = scoreText(m.clean)
      const g = scoreText(m.text)
      const delta = (g[0]?.score ?? 0) - (c[0]?.score ?? 0)
      console.log(
        `${m.kind.padEnd(19)} ${matcher.classify(c).padEnd(9)} ${c[0]?.score.toFixed(3)} → ${matcher.classify(g).padEnd(9)} ${g[0]?.score.toFixed(3)} (${delta >= 0 ? '+' : ''}${delta.toFixed(3)}) top ${g[0]?.entryId === m.entryId ? '✓' : `✗ ${g[0]?.entryId}`}  | ${m.text.slice(0, 52)}`
      )
    }
    expect(fixture.mangled.length).toBeGreaterThan(0)
  })

  it('prints the calibration table', () => {
    const rows = [
      ...fixture.paraphrases.map((p) => ({ kind: 'paraphrase', ...p })),
      ...fixture.offBank.map((p) => ({ kind: 'off-bank', entryId: '', ...p })),
      ...fixture.triggerAbuse.map((p) => ({ kind: 'abuse', entryId: '', ...p })),
      ...fixture.statements.map((p) => ({ kind: 'statement', ...p }))
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
