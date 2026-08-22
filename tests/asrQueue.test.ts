import { describe, expect, it } from 'vitest'
import { AsrQueue, rank, type QueuedJob } from '@/lib/asrQueue'

// One worker now serves both streams, so the order it decodes in is a product
// decision, not an implementation detail: the interviewer's audio puts the
// card on screen, yours only ticks off points that are already there.

interface Job extends QueuedJob {
  id: string
}
const job = (id: string, stream: 'them' | 'you', confirmed = true): Job => ({ id, stream, confirmed })
const ids = (q: AsrQueue<Job>): string[] => q.peek().map((j) => j.id)

describe('rank', () => {
  it('puts the interviewer ahead of you, and confirmed ahead of partial', () => {
    expect(rank(job('a', 'them'))).toBeLessThan(rank(job('b', 'you')))
    expect(rank(job('b', 'you'))).toBeLessThan(rank(job('c', 'them', false)))
    expect(rank(job('c', 'them', false))).toBeLessThan(rank(job('d', 'you', false)))
  })
})

describe('AsrQueue', () => {
  it('decodes the interviewer first even when you spoke first', () => {
    // the failure this prevents: a long answer of yours sitting in front of
    // the question you actually need on screen
    const q = new AsrQueue<Job>(8)
    q.push(job('yours', 'you'))
    q.push(job('theirs', 'them'))
    expect(ids(q)).toEqual(['theirs', 'yours'])
  })

  it('keeps speech in order within one priority', () => {
    const q = new AsrQueue<Job>(8)
    q.push(job('1', 'them'))
    q.push(job('2', 'them'))
    q.push(job('3', 'them'))
    expect(ids(q)).toEqual(['1', '2', '3'])
  })

  it('drops a partial that would have to wait behind equal or better work', () => {
    const q = new AsrQueue<Job>(8)
    q.push(job('confirmed', 'them'))
    const r = q.push(job('partial', 'them', false))
    expect(r.queued).toBe(false)
    expect(ids(q)).toEqual(['confirmed'])
  })

  it('drops a partial while something at least as urgent is decoding', () => {
    const q = new AsrQueue<Job>(8)
    const r = q.push(job('partial', 'you', false), rank(job('x', 'them')))
    expect(r.queued).toBe(false)
  })

  it('still queues a partial that outranks what is waiting', () => {
    const q = new AsrQueue<Job>(8)
    q.push(job('yours', 'you', false))
    const r = q.push(job('theirs', 'them', false))
    expect(r.queued).toBe(true)
    expect(ids(q)).toEqual(['theirs', 'yours'])
  })

  it('supersedes a queued partial with the confirmed text of the same stream', () => {
    const q = new AsrQueue<Job>(8)
    q.push(job('partial', 'them', false))
    const r = q.push(job('confirmed', 'them'))
    expect(r.dropped.map((d) => d.id)).toEqual(['partial'])
    expect(ids(q)).toEqual(['confirmed'])
  })

  it('leaves the other stream’s partial alone', () => {
    const q = new AsrQueue<Job>(8)
    q.push(job('yours', 'you', false))
    q.push(job('theirs', 'them'))
    expect(ids(q)).toEqual(['theirs', 'yours'])
  })

  it('sheds the least urgent job when it overflows, not the plain oldest', () => {
    // the single-stream version dropped the plain oldest, which here would
    // throw away the interviewer's question to keep an answer of your own.
    // Within the least-urgent rank the OLDEST goes (see the next test).
    const q = new AsrQueue<Job>(2)
    q.push(job('theirs', 'them'))
    q.push(job('yours-1', 'you'))
    const r = q.push(job('yours-2', 'you'))
    expect(r.dropped.map((d) => d.id)).toEqual(['yours-1'])
    expect(ids(q)).toEqual(['theirs', 'yours-2'])
  })

  it('under a same-rank backlog, sheds the oldest and keeps the live edge (REVIEW.md H6)', () => {
    // decode slower than real time during an interviewer monologue: the queue
    // fills with confirmed-them jobs. Popping the newest meant the question
    // being asked RIGHT NOW was discarded to keep minute-old audio.
    const q = new AsrQueue<Job>(4)
    q.push(job('them-1', 'them'))
    q.push(job('them-2', 'them'))
    q.push(job('them-3', 'them'))
    q.push(job('them-4', 'them'))
    const r = q.push(job('them-5-current-question', 'them'))
    expect(r.queued).toBe(true)
    expect(r.dropped.map((d) => d.id)).toEqual(['them-1'])
    expect(ids(q)).toEqual(['them-2', 'them-3', 'them-4', 'them-5-current-question'])
  })

  it('shifts in priority order', () => {
    const q = new AsrQueue<Job>(8)
    q.push(job('yours', 'you'))
    q.push(job('theirs', 'them'))
    expect(q.shift()?.id).toBe('theirs')
    expect(q.shift()?.id).toBe('yours')
    expect(q.shift()).toBeUndefined()
  })

  it('clears one stream or all of them', () => {
    const q = new AsrQueue<Job>(8)
    q.push(job('theirs', 'them'))
    q.push(job('yours', 'you'))
    q.clear('you')
    expect(ids(q)).toEqual(['theirs'])
    q.clear()
    expect(q.length).toBe(0)
  })
})
