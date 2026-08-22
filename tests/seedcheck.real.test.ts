import { beforeAll, describe, expect, it } from 'vitest'
import { findCollisions } from '@/lib/bankCheck'
import { HybridMatcher } from '@/lib/matcher'
import { EmbeddingCache } from '@/lib/embeddings'
import type { Answer } from '@shared/types'
import seed from '@shared/seed.json'
import { REAL, realEmbeddingProvider } from './helpers/realModel'

// The bank check, pointed at the bank we ship. Anyone who opens the app and
// runs the check sees this output, so it is worth knowing what it says — and
// worth failing the build if editing the seed quietly introduces a pair the
// matcher cannot separate.

const entries = seed.answers as unknown as Answer[]

// deliberate twins: two different answers to the same complaint arriving.
// The unsure card showing both is the designed outcome (DECISIONS.md), so the
// check is expected to name them — it is telling the truth about them.
const TWINS = ['a-informal', 'a-invest-run']

describe.skipIf(!REAL)('the bank check, run over the bank we ship', () => {
  let matcher: HybridMatcher

  beforeAll(async () => {
    const cache = new EmbeddingCache(await realEmbeddingProvider())
    await cache.ensure([
      ...entries.map((e) => e.question),
      ...entries.flatMap((e) => e.triggerPhrases)
    ])
    matcher = new HybridMatcher(cache)
  }, 300_000)

  it('finds only the documented twin pair strong enough to take the panel', () => {
    const all = findCollisions(entries, matcher, 50)
    for (const f of all) {
      console.log(`  ${f.kind.padEnd(13)} ${f.entryId.padEnd(14)} vs ${f.withId}`)
    }
    const takeovers = all.filter((f) => f.kind === 'wrong-top')
    expect(takeovers).toHaveLength(1)
    expect([takeovers[0].entryId, takeovers[0].withId].sort()).toEqual(TWINS)
  })

  it('ships no answer that answers to another answer’s trigger phrase', () => {
    expect(findCollisions(entries, matcher, 50).filter((f) => f.kind === 'shared-phrase')).toEqual([])
  })

  it('puts the worst pair first, so three findings are the three that matter', () => {
    const top = findCollisions(entries, matcher)[0]
    expect(top.kind).toBe('wrong-top')
    expect(TWINS).toContain(top.entryId)
  })
})
