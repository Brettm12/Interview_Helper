/// <reference lib="webworker" />
export {}

// all-MiniLM-L6-v2 embeddings in a worker so the panel never janks.
// Models are loaded from the local model directory only — no runtime
// downloads; a dead connection must not degrade the app.

type InMsg =
  | { type: 'init'; modelPath: string }
  | { type: 'embed'; id: number; texts: string[] }

type OutMsg =
  | { type: 'ready' }
  | { type: 'error'; message: string }
  | { type: 'embedded'; id: number; vectors: Float32Array[] }

let extractor: ((texts: string[], opts: object) => Promise<{ tolist(): number[][] }>) | null = null

async function init(modelPath: string): Promise<void> {
  const { pipeline, env } = await import('@xenova/transformers')
  env.allowRemoteModels = false
  env.localModelPath = modelPath
  extractor = (await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2')) as never
  post({ type: 'ready' })
}

function post(msg: OutMsg): void {
  ;(self as unknown as Worker).postMessage(msg)
}

self.onmessage = async (e: MessageEvent<InMsg>) => {
  const msg = e.data
  try {
    if (msg.type === 'init') {
      await init(msg.modelPath)
    } else if (msg.type === 'embed') {
      if (!extractor) throw new Error('embeddings worker not initialised')
      const out = await extractor(msg.texts, { pooling: 'mean', normalize: true })
      const rows = out.tolist()
      post({ type: 'embedded', id: msg.id, vectors: rows.map((r) => Float32Array.from(r)) })
    }
  } catch (err) {
    post({ type: 'error', message: String(err) })
  }
}
