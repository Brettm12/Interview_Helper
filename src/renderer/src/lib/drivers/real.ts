import type { AudioChunk, AudioSource, Segment, Transcriber } from '@shared/types'
import type { EmbeddingProvider } from '../embeddings'
import captureWorkletUrl from './capture.worklet.ts?worker&url'

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
  private errCb: ((e: Error) => void) | null = null
  private ctx: AudioContext | null = null
  private node: AudioWorkletNode | null = null
  private mediaStream: MediaStream | null = null
  private startedAt = 0
  private disposed = false

  constructor(private streamName: 'meeting' | 'mic') {}

  protected abstract acquire(): Promise<MediaStream>

  start(): void {
    // failures surface through onError — never as an unhandled rejection
    void this.wire().catch((err) => {
      this.errCb?.(err instanceof Error ? err : new Error(String(err)))
    })
  }

  private async wire(): Promise<void> {
    this.mediaStream = await this.acquire()
    if (this.disposed) {
      this.mediaStream.getTracks().forEach((t) => t.stop())
      return
    }
    this.startedAt = Date.now()
    this.ctx = new AudioContext()
    // capture runs on the audio thread; ScriptProcessorNode (deprecated,
    // main-thread) would jank the panel
    await this.ctx.audioWorklet.addModule(captureWorkletUrl)
    if (this.disposed) return
    const src = this.ctx.createMediaStreamSource(this.mediaStream)
    this.node = new AudioWorkletNode(this.ctx, 'capture', {
      numberOfInputs: 1,
      channelCount: 1
    })
    this.node.port.onmessage = (e: MessageEvent<Float32Array>) => {
      const inRate = this.ctx?.sampleRate ?? 48000
      this.cb?.({
        stream: this.streamName,
        samples: downsampleTo16k(e.data, inRate),
        sampleRate: TARGET_RATE,
        t: (Date.now() - this.startedAt) / 1000
      })
    }
    // zero-gain sink keeps the graph pulled without echoing the meeting (or
    // your own mic) out of the speakers
    const sink = this.ctx.createGain()
    sink.gain.value = 0
    src.connect(this.node)
    this.node.connect(sink)
    sink.connect(this.ctx.destination)
  }

  stop(): void {
    this.disposed = true
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

  onError(cb: (e: Error) => void): void {
    this.errCb = cb
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

/** system-audio loopback; main routes getDisplayMedia through
 *  setDisplayMediaRequestHandler with audio 'loopback' (Windows). On
 *  platforms without loopback the stream arrives with no audio track and the
 *  error below carries the fix. */
export class MeetingAudioSource extends MediaStreamSource {
  constructor() {
    super('meeting')
  }
  protected async acquire(): Promise<MediaStream> {
    const stream = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true })
    // the video track is only a capture-API requirement — drop it
    stream.getVideoTracks().forEach((t) => t.stop())
    if (stream.getAudioTracks().length === 0) {
      stream.getTracks().forEach((t) => t.stop())
      throw new Error(
        'no system-audio track — on this platform route the meeting through a loopback device (see README)'
      )
    }
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
