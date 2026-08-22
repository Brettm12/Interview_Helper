import type { EmbeddingProvider } from '@/lib/embeddings'

// The one place the real-model suites reach for an actual embedder. Both the
// matching calibration and the coverage calibration go through here, so
// swapping the encoder is a single edit (or one env var) rather than a hunt
// through two test files — which is exactly what a swap has to be measured
// with, not around.

export const REAL = process.env.LIH_REAL_MODELS === '1'
export const MODELS_DIR = process.env.LIH_MODELS_DIR
/** override to score the same fixtures against a candidate encoder */
export const EMBED_MODEL = process.env.LIH_EMBED_MODEL ?? 'Xenova/all-MiniLM-L6-v2'

export async function realEmbeddingProvider(): Promise<EmbeddingProvider> {
  if (!MODELS_DIR) throw new Error('LIH_MODELS_DIR is required with LIH_REAL_MODELS=1')
  const { pipeline, env } = await import('@xenova/transformers')
  env.localModelPath = MODELS_DIR
  env.allowRemoteModels = false
  const extractor = await pipeline('feature-extraction', EMBED_MODEL)
  return {
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
}
