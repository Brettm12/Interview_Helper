/// <reference lib="webworker" />
import { localWasmPaths } from '@/lib/ortWasm'

export {}

// all-MiniLM-L6-v2 embeddings in a worker so the panel never janks.
// Models are loaded from the local model directory only — no runtime
// downloads; a dead connection must not degrade the app.

type InMsg =
  | { type: 'init'; modelPath: string }
  | { type: 'embed'; id: number; texts: string[] }

type OutMsg =
  | { type: 'ready' }
  /** id present when the error belongs to one embed request — the caller
   *  rejects that request instead of leaving it pending forever */
  | { type: 'error'; id?: number; message: string }
  | { type: 'embedded'; id: number; vectors: Float32Array[] }

let extractor: ((texts: string[], opts: object) => Promise<{ tolist(): number[][] }>) | null = null

// onmessage is async, so an 'embed' posted right after 'init' (which warmBank
// does) used to run while init was still awaiting the model load, throw
// "not initialised", and poison every bank text for the whole session
// (REVIEW.md C8). Buffer embeds until init settles instead.
type InitState = 'idle' | 'loading' | 'ready' | 'failed'
let initState: InitState = 'idle'
const buffered: { id: number; texts: string[] }[] = []

async function init(modelPath: string): Promise<void> {
  const { pipeline, env } = await import('@xenova/transformers')
  env.allowRemoteModels = false
  env.localModelPath = modelPath
  // the onnx runtime's default wasmPaths is a CDN — point it at the bundled
  // binaries before the first pipeline() constructs a session (REVIEW.md C2)
  env.backends.onnx.wasm.wasmPaths = localWasmPaths()
  extractor = (await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2')) as never
  post({ type: 'ready' })
}

function post(msg: OutMsg): void {
  ;(self as unknown as Worker).postMessage(msg)
}

async function runEmbed(id: number, texts: string[]): Promise<void> {
  try {
    if (!extractor) throw new Error('embeddings worker not initialised')
    const out = await extractor(texts, { pooling: 'mean', normalize: true })
    const rows = out.tolist()
    post({ type: 'embedded', id, vectors: rows.map((r) => Float32Array.from(r)) })
  } catch (err) {
    post({ type: 'error', id, message: String(err) })
  }
}

self.onmessage = async (e: MessageEvent<InMsg>) => {
  const msg = e.data
  if (msg.type === 'init') {
    if (initState !== 'idle') return
    initState = 'loading'
    try {
      await init(msg.modelPath)
      initState = 'ready'
    } catch (err) {
      initState = 'failed'
      post({ type: 'error', message: String(err) })
    }
    // drain whatever queued while the model loaded; on a failed init each
    // buffered request is rejected WITH its id so the caller can retry later
    const queued = buffered.splice(0)
    for (const q of queued) {
      if (initState === 'ready') await runEmbed(q.id, q.texts)
      else post({ type: 'error', id: q.id, message: 'embeddings model failed to load' })
    }
  } else if (msg.type === 'embed') {
    if (initState === 'idle' || initState === 'loading') {
      buffered.push({ id: msg.id, texts: msg.texts })
      return
    }
    if (initState === 'failed') {
      post({ type: 'error', id: msg.id, message: 'embeddings model failed to load' })
      return
    }
    await runEmbed(msg.id, msg.texts)
  }
}
