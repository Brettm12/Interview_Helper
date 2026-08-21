// Which utterance Whisper decodes next.
//
// There used to be one worker per stream, each holding its own copy of the
// model and competing blindly for CPU. There is now one, which means the
// order matters: the interviewer's audio drives the panel and is on the
// critical path, your own drives coverage and can be a beat late without
// anyone noticing. A plain FIFO would let a long answer of yours sit in front
// of the question you actually need on screen.

export type Stream = 'them' | 'you'

export interface QueuedJob {
  stream: Stream
  /** false for an in-flight partial, which the confirmed text supersedes */
  confirmed: boolean
}

/** lower runs sooner: confirmed-them, confirmed-you, partial-them, partial-you */
export function rank(job: QueuedJob): number {
  return (job.confirmed ? 0 : 2) + (job.stream === 'them' ? 0 : 1)
}

export interface PushResult<T> {
  /** true when the job was accepted */
  queued: boolean
  /** jobs evicted to make room, or superseded by this one */
  dropped: T[]
}

/**
 * A bounded priority queue with the eviction rules the old single-stream code
 * had, generalised to two streams.
 *
 * Pure and worker-free so the ordering is testable — the previous version's
 * behaviour under load lived entirely inside a Web Worker and could only be
 * checked by reasoning about it.
 */
export class AsrQueue<T extends QueuedJob> {
  private items: T[] = []

  constructor(private capacity: number) {}

  get length(): number {
    return this.items.length
  }

  /** what's waiting, highest priority first — for diagnostics */
  peek(): readonly T[] {
    return this.items
  }

  /**
   * @param runningRank rank of the job currently decoding, or null when idle
   */
  push(job: T, runningRank: number | null = null): PushResult<T> {
    const r = rank(job)
    const dropped: T[] = []

    if (!job.confirmed) {
      // A partial is only worth decoding if it can start almost immediately —
      // one that waits is stale before it runs, and the confirmed text for the
      // same speech is right behind it. Under sustained load partials simply
      // stop, which is the correct thing to lose first.
      if (runningRank !== null && runningRank <= r) return { queued: false, dropped: [job] }
      if (this.items.some((i) => rank(i) <= r)) return { queued: false, dropped: [job] }
    } else {
      // confirmed text supersedes any queued partial of the same speech
      for (let i = this.items.length - 1; i >= 0; i--) {
        if (!this.items[i].confirmed && this.items[i].stream === job.stream) {
          dropped.push(...this.items.splice(i, 1))
        }
      }
    }

    this.items.push(job)
    this.sort()

    // over capacity: shed the lowest-priority job, oldest first. Dropping the
    // plain oldest — which is what the single-stream version did — could throw
    // away the interviewer's question to keep a partial of your own answer.
    while (this.items.length > this.capacity) {
      dropped.push(this.items.pop() as T)
    }
    return { queued: true, dropped }
  }

  shift(): T | undefined {
    return this.items.shift()
  }

  /** stable sort: equal ranks keep insertion order, so speech stays in sequence */
  private sort(): void {
    const order = new Map<T, number>()
    this.items.forEach((item, i) => order.set(item, i))
    this.items.sort((a, b) => rank(a) - rank(b) || (order.get(a) ?? 0) - (order.get(b) ?? 0))
  }

  clear(stream?: Stream): void {
    this.items = stream ? this.items.filter((i) => i.stream !== stream) : []
  }
}
