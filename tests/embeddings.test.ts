import { describe, expect, it } from 'vitest'
import { EmbeddingCache, type EmbeddingProvider } from '@/lib/embeddings'
import { loadWorker } from './helpers/workerHarness'

// REVIEW.md C8: one failed embed batch used to kill semantic matching for the
// whole session — the worker error carried no request id, the pending promise
// never settled, and the cache never retried the texts. Three layers, three
// pins.

describe('embeddings.worker message protocol', () => {
  it('buffers an embed that arrives before init, and rejects it WITH its id when init fails', async () => {
    const w = await loadWorker(() => import('@/workers/embeddings.worker'))

    // warmBank posts this immediately after construction — before init settles
    const early = w.send({ type: 'embed', id: 7, texts: ['hello'] })
    expect(w.posted).toHaveLength(0) // buffered, not an error

    // a model path that cannot load → init fails → the buffered request must
    // come back as an error carrying id 7, not vanish
    await w.send({ type: 'init', modelPath: '/nonexistent-model-dir' })
    await early
    const withId = await w.waitFor<{ type: string; id?: number }>(
      (m) => m.type === 'error' && m.id === 7
    )
    expect(withId).toBeTruthy()
  }, 60_000)

  it('fails fast with the id once init has failed', async () => {
    const w = await loadWorker(() => import('@/workers/embeddings.worker'))
    await w.send({ type: 'init', modelPath: '/nonexistent-model-dir' })
    await w.send({ type: 'embed', id: 3, texts: ['x'] })
    const err = await w.waitFor<{ type: string; id?: number }>(
      (m) => m.type === 'error' && m.id === 3
    )
    expect(err).toBeTruthy()
  }, 60_000)
})

describe('EmbeddingCache under provider failure', () => {
  it('ensure() never rejects, and a failed batch is retried on the next ensure', async () => {
    let calls = 0
    const provider: EmbeddingProvider = {
      ready: true,
      embed: async (texts: string[]) => {
        calls++
        if (calls === 1) throw new Error('worker hiccup')
        return texts.map(() => new Float32Array([1, 0, 0]))
      }
    }
    const cache = new EmbeddingCache(provider)

    await expect(cache.ensure(['the question'])).resolves.toBeUndefined()
    expect(cache.get('the question')).toBeNull() // failed batch cached nothing

    // the poisoning bug: the text stayed 'pending' forever and was never
    // re-requested. It must be retried now.
    await cache.ensure(['the question'])
    expect(calls).toBe(2)
    expect(cache.get('the question')).not.toBeNull()
  })

  it('concurrent ensures of the same text still dedupe to one request', async () => {
    let calls = 0
    const provider: EmbeddingProvider = {
      ready: true,
      embed: async (texts: string[]) => {
        calls++
        await new Promise((r) => setTimeout(r, 20))
        return texts.map(() => new Float32Array([0, 1]))
      }
    }
    const cache = new EmbeddingCache(provider)
    await Promise.all([cache.ensure(['q']), cache.ensure(['q'])])
    expect(calls).toBe(1)
    expect(cache.get('q')).not.toBeNull()
  })
})

// The encoder failing is the quietest bad outcome the app has: everything
// keeps running and every question for the rest of the interview is matched
// on word overlap. It used to reach a console.warn and stop there.
describe('WorkerEmbeddings failure reporting', () => {
  class FakeWorker {
    static last: FakeWorker | null = null
    onmessage: ((e: { data: unknown }) => void) | null = null
    onerror: ((e: { message: string }) => void) | null = null
    posted: unknown[] = []
    constructor() {
      FakeWorker.last = this
    }
    postMessage(msg: unknown): void {
      this.posted.push(msg)
    }
    terminate(): void {}
    deliver(data: unknown): void {
      this.onmessage?.({ data })
    }
  }

  async function make(): Promise<{
    embeddings: import('@/lib/drivers/real').WorkerEmbeddings
    worker: FakeWorker
    failures: string[]
  }> {
    const g = globalThis as unknown as { Worker?: unknown }
    const had = 'Worker' in g
    const prev = g.Worker
    g.Worker = FakeWorker as unknown
    const { WorkerEmbeddings } = await import('@/lib/drivers/real')
    const embeddings = new WorkerEmbeddings('models')
    if (had) g.Worker = prev
    else delete g.Worker
    const failures: string[] = []
    embeddings.onFailure((m) => failures.push(m))
    return { embeddings, worker: FakeWorker.last!, failures }
  }

  it('reports a model-load failure, so it can reach a surface someone watches', async () => {
    const { embeddings, worker, failures } = await make()
    worker.deliver({ type: 'error', message: 'model file missing' })
    expect(failures).toEqual(['model file missing'])
    expect(embeddings.failed).toBe('model file missing')
    expect(embeddings.ready).toBe(false)
  })

  it('says it once, however many times the worker complains', async () => {
    const { worker, failures } = await make()
    worker.deliver({ type: 'error', message: 'model file missing' })
    worker.deliver({ type: 'error', message: 'model file missing again' })
    worker.onerror?.({ message: 'and now it crashed' })
    expect(failures).toHaveLength(1)
  })

  it('does not cry failure over one bad batch — that one is retried', async () => {
    const { embeddings, worker, failures } = await make()
    const pending = embeddings.embed(['x'])
    const id = (worker.posted.at(-1) as { id: number }).id
    worker.deliver({ type: 'error', id, message: 'one batch went wrong' })
    await expect(pending).rejects.toThrow('one batch went wrong')
    expect(failures).toEqual([])
    expect(embeddings.failed).toBeNull()
  })

  it('tells a late listener what it already missed', async () => {
    const { embeddings, worker } = await make()
    worker.deliver({ type: 'error', message: 'gone before anyone looked' })
    const seen: string[] = []
    embeddings.onFailure((m) => seen.push(m))
    expect(seen).toEqual(['gone before anyone looked'])
  })
})
