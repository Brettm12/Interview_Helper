import { describe, expect, it } from 'vitest'
import { clauses, condense } from '@/lib/condense'
import { EmbeddingCache } from '@/lib/embeddings'
import { deriveRecap } from '@/lib/recap'
import type { Bank, SessionRecord } from '@shared/types'
import seed from '@shared/seed.json'

// Prep-time "help me write this", the extractive way. The contract that
// matters most is negative: nothing it returns may be a word the user did not
// say, and nothing the INTERVIEWER said may reach it at all.

const bank = seed as unknown as Bank

const RAMBLE = `so the hardest one was probably this case where we had two people came
forward about the same supervisor and honestly the site had a bit of a history of that
sort of thing being brushed under the carpet, um, so the first thing I did was I moved
people apart on the schedule rather than suspending anybody because suspension reads as
guilt before you know anything, and then I just worked through it, I think it was eleven
interviews over about five days and I wrote each one up as I went, and the decision held,
nobody grieved it, nobody appealed it.`

describe('cutting spoken rambling into sayable clauses', () => {
  it('breaks a run-on where the speaker actually turned the thought', () => {
    const out = clauses(RAMBLE)
    expect(out.length).toBeGreaterThan(3)
    for (const c of out) expect(c.split(' ').length).toBeLessThanOrEqual(24)
  })

  it('drops the filler people start and end with', () => {
    const out = clauses('so um I moved people apart on the schedule, you know')
    expect(out[0]).toBe('I moved people apart on the schedule')
  })

  it('throws away the clauses that carry nothing', () => {
    const out = clauses('I just worked through it. I opened eleven investigations that week.')
    expect(out.some((c) => /eleven investigations/.test(c))).toBe(true)
    expect(out.some((c) => /worked through it/.test(c))).toBe(false)
  })

  it('leaves a short answer alone rather than mangling it', () => {
    expect(clauses('I named the cost honestly on day one.')).toEqual([
      'I named the cost honestly on day one'
    ])
  })
})

describe('condensing to points', () => {
  async function warmCache(texts: string[]): Promise<EmbeddingCache> {
    // a stand-in encoder: each clause becomes a vector from its own content
    // words, so "similar" means "shares words" — enough to exercise the
    // centroid and the redundancy discount deterministically
    const vocab = [...new Set(texts.join(' ').toLowerCase().match(/[a-z]+/g) ?? [])]
    const cache = new EmbeddingCache({
      ready: true,
      embed: async (batch) =>
        batch.map((t) => {
          const words = new Set(t.toLowerCase().match(/[a-z]+/g) ?? [])
          const v = Float32Array.from(vocab.map((w) => (words.has(w) ? 1 : 0)))
          const n = Math.sqrt(v.reduce((a, b) => a + b * b, 0)) || 1
          return v.map((x) => x / n) as Float32Array
        })
    })
    await cache.ensure(texts)
    return cache
  }

  it('returns only words the person actually said', async () => {
    const cache = await warmCache(clauses(RAMBLE))
    const points = await condense(RAMBLE, cache)
    const saidWords = new Set((RAMBLE.toLowerCase().match(/[a-z']+/g) ?? []))
    for (const p of points) {
      for (const w of p.toLowerCase().match(/[a-z']+/g) ?? []) {
        expect(saidWords, `"${w}" was never said`).toContain(w)
      }
    }
  })

  it('gives back the asked-for number of points, in the order they were said', async () => {
    const all = clauses(RAMBLE)
    const cache = await warmCache(all)
    const points = await condense(RAMBLE, cache, 3)
    expect(points).toHaveLength(3)
    const positions = points.map((p) => all.indexOf(p))
    expect(positions).toEqual([...positions].sort((a, b) => a - b))
  })

  it('still answers with a cold encoder, on content density', async () => {
    const points = await condense(RAMBLE, null, 3)
    expect(points).toHaveLength(3)
    expect(points.join(' ')).toMatch(/interviews|supervisor|schedule/)
  })

  it('does not pad a short answer up to the count', async () => {
    const short = 'I named the cost honestly on day one.'
    expect(await condense(short, null, 3)).toHaveLength(1)
  })
})

// The structural half of the promise: the prep-time helper cannot receive the
// interviewer's speech, because the only thing that reaches it is an excerpt
// the recap has already filtered to the user's own lines. If that filter is
// ever removed, this fails.
describe('the interviewer never reaches the prep-time helper', () => {
  const INTERVIEWER =
    'Tell me about a time you handled a difficult employee relations case, and be specific.'

  const record: SessionRecord = {
    id: 's-1',
    loopId: 'loop-meridian',
    startedAt: Date.now(),
    endedAt: Date.now() + 120_000,
    transcriptKept: true,
    questions: [
      {
        id: 'q-1',
        askedAtSec: 12,
        question: INTERVIEWER,
        entryId: null,
        coveredPointIds: [],
        totalPoints: 0,
        micSeconds: 60,
        pinnedViaFind: false,
        transcript: [
          { speaker: 'them', text: INTERVIEWER },
          { speaker: 'you', text: 'Two complainants came forward about the same supervisor.' },
          { speaker: 'them', text: 'And what did you do first, in the first day or so?' },
          { speaker: 'you', text: 'I moved people apart on the schedule rather than suspending anybody.' }
        ]
      }
    ]
  }

  it('carries no interviewer line into what the editor is handed', () => {
    const draft = deriveRecap(record, bank).fixes.find((f) => f.kind === 'draft')!
    expect(draft.excerpt).toBeDefined()
    expect(draft.excerpt).not.toMatch(/Tell me about a time/i)
    expect(draft.excerpt).not.toMatch(/what did you do first/i)
    expect(draft.excerpt).toMatch(/Two complainants/)
  })

  it('condenses only the user’s own lines, whatever the interviewer said', async () => {
    const draft = deriveRecap(record, bank).fixes.find((f) => f.kind === 'draft')!
    const points = await condense(draft.excerpt!, null, 2)
    for (const p of points) {
      expect(p).not.toMatch(/Tell me about|what did you do first/i)
    }
    expect(points.join(' ')).toMatch(/complainants|schedule/)
  })
})
