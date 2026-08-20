import { cosineSimilarity } from './text'

// Embeddings are async (a worker owns the model), but the matcher and the
// coverage model need synchronous scoring. The cache bridges the two: vectors
// are precomputed for bank text when the session arms, utterances are embedded
// as they arrive, and scorers read whatever is already present. Until the
// model is warm the scorers fall back to lexical paths (see tuning.ts).

export interface EmbeddingProvider {
  readonly ready: boolean
  embed(texts: string[]): Promise<Float32Array[]>
}

export class EmbeddingCache {
  private vectors = new Map<string, Float32Array>()
  private pending = new Map<string, Promise<void>>()

  constructor(private provider: EmbeddingProvider | null) {}

  get ready(): boolean {
    return this.provider?.ready ?? false
  }

  /** false for the null cache — there is nothing to warm up */
  get hasProvider(): boolean {
    return this.provider != null
  }

  get(text: string): Float32Array | null {
    return this.vectors.get(text) ?? null
  }

  /** kick off embedding for any uncached texts; resolves when all present */
  async ensure(texts: string[]): Promise<void> {
    if (!this.provider) return
    const missing = texts.filter((t) => !this.vectors.has(t) && !this.pending.has(t))
    if (missing.length > 0) {
      const p = this.provider.embed(missing).then((vecs) => {
        missing.forEach((t, i) => this.vectors.set(t, vecs[i]))
        missing.forEach((t) => this.pending.delete(t))
      })
      missing.forEach((t) => this.pending.set(t, p))
    }
    await Promise.all(texts.map((t) => this.pending.get(t)).filter(Boolean))
  }

  /** cosine similarity if both vectors are cached, else null */
  similarity(a: string, b: string): number | null {
    const va = this.vectors.get(a)
    const vb = this.vectors.get(b)
    if (!va || !vb) return null
    return cosineSimilarity(va, vb)
  }
}

/** cache with no provider: always cold, scorers use their lexical fallback */
export function nullEmbeddings(): EmbeddingCache {
  return new EmbeddingCache(null)
}
