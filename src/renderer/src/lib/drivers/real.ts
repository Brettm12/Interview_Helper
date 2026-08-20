import type { AudioChunk, AudioSource, Segment, Transcriber } from '@shared/types'
import type { EmbeddingProvider } from '../embeddings'

// Real capture path. Speaker attribution comes from stream identity:
// system/meeting audio is `them`, the microphone is `you` — two transcriber
// instances, one per stream. All processing stays on this machine.

const TARGET_RATE = 16000

function downsampleTo16k(input: Float32Array, inputRate: number): Float32Array {
  if (inputRate === TARGET_RATE) return input
  const ratio = inputRate / TARGET_RATE
  const outLength = Math.floor(input.length / ratio)
  const out = new Float32Array(outLength)
  for (let i = 0; i < outLength; i++) {
    out[i] = input[Math.floor(i * ratio)]
  }
  return out
}

abstract class MediaStreamSource implements AudioSource {
  private cb: ((c: AudioChunk) => void) | null = null
  private ctx: AudioContext | null = null
  private node: ScriptProcessorNode | null = null
  private mediaStream: MediaStream | null = null
  private startedAt = 0

  constructor(private streamName: 'meeting' | 'mic') {}

  protected abstract acquire(): Promise<MediaStream>

  start(): void {
    void (async () => {
      this.mediaStream = await this.acquire()
      this.startedAt = Date.now()
      this.ctx = new AudioContext()
      const src = this.ctx.createMediaStreamSource(this.mediaStream)
      this.node = this.ctx.createScriptProcessor(4096, 1, 1)
      this.node.onaudioprocess = (e) => {
        const inRate = this.ctx?.sampleRate ?? 48000
        const samples = downsampleTo16k(e.inputBuffer.getChannelData(0).slice(), inRate)
        this.cb?.({
          stream: this.streamName,
          samples,
          sampleRate: TARGET_RATE,
          t: (Date.now() - this.startedAt) / 1000
        })
      }
      src.connect(this.node)
      this.node.connect(this.ctx.destination)
    })()
  }

  stop(): void {
    this.node?.disconnect()
    this.mediaStream?.getTracks().forEach((t) => t.stop())
    void this.ctx?.close()
    this.node = null
    this.ctx = null
    this.mediaStream = null
  }

  onChunk(cb: (c: AudioChunk) => void): void {
    this.cb = cb
  }
}

export class MicAudioSource extends MediaStreamSource {
  constructor() {
    super('mic')
  }
  protected acquire(): Promise<MediaStream> {
    return navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true }, video: false })
  }
}

/** system-audio loopback; main process routes getDisplayMedia through
 *  setDisplayMediaRequestHandler with audio loopback */
export class MeetingAudioSource extends MediaStreamSource {
  constructor() {
    super('meeting')
  }
  protected async acquire(): Promise<MediaStream> {
    const stream = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true })
    // the video track is only a capture-API requirement — drop it
    stream.getVideoTracks().forEach((t) => t.stop())
    return stream
  }
}

/** Whisper in a worker, one per stream */
export class WhisperTranscriber implements Transcriber {
  private worker: Worker
  private cb: ((s: Segment) => void) | null = null
  ready = false

  constructor(speaker: 'you' | 'them', modelPath: string) {
    this.worker = new Worker(new URL('../../workers/transcriber.worker.ts', import.meta.url), {
      type: 'module'
    })
    this.worker.onmessage = (e) => {
      const msg = e.data
      if (msg.type === 'ready') this.ready = true
      else if (msg.type === 'segment') {
        this.cb?.({ speaker: msg.speaker, text: msg.text, confirmed: msg.confirmed, t: msg.t })
      } else if (msg.type === 'error') {
        console.warn('[transcriber]', msg.message)
      }
    }
    this.worker.postMessage({ type: 'init', modelPath, speaker })
  }

  push(chunk: AudioChunk): void {
    this.worker.postMessage({ type: 'audio', samples: chunk.samples, t: chunk.t }, [
      chunk.samples.buffer
    ])
  }

  onSegment(cb: (s: Segment) => void): void {
    this.cb = cb
  }

  dispose(): void {
    this.worker.terminate()
  }
}

/** MiniLM embeddings behind the EmbeddingProvider interface */
export class WorkerEmbeddings implements EmbeddingProvider {
  private worker: Worker
  private seq = 0
  private pending = new Map<number, (v: Float32Array[]) => void>()
  ready = false

  constructor(modelPath: string) {
    this.worker = new Worker(new URL('../../workers/embeddings.worker.ts', import.meta.url), {
      type: 'module'
    })
    this.worker.onmessage = (e) => {
      const msg = e.data
      if (msg.type === 'ready') this.ready = true
      else if (msg.type === 'embedded') {
        this.pending.get(msg.id)?.(msg.vectors)
        this.pending.delete(msg.id)
      } else if (msg.type === 'error') {
        console.warn('[embeddings]', msg.message)
      }
    }
    this.worker.postMessage({ type: 'init', modelPath })
  }

  embed(texts: string[]): Promise<Float32Array[]> {
    const id = this.seq++
    return new Promise((resolve) => {
      this.pending.set(id, resolve)
      this.worker.postMessage({ type: 'embed', id, texts })
    })
  }

  dispose(): void {
    this.worker.terminate()
  }
}
