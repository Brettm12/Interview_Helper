import type { AudioChunk, Segment, Transcriber } from '@shared/types'
import type { Stream } from '../asrQueue'

// One Whisper worker serving both streams, presented to the rest of the app as
// two ordinary Transcribers. Two workers meant two full copies of base.en
// (~290MB) and two decodes competing for the same cores with no way to say
// which one mattered; the queue inside the worker now knows.

export type ModelState = 'loading' | 'warm' | 'failed'

export class TranscriptionService {
  private worker: Worker
  private subs: Record<Stream, ((s: Segment) => void)[]> = { them: [], you: [] }
  private stateCb: ((state: ModelState) => void) | null = null
  /** capture runs from the setup screen onward, but nothing is transcribed
   *  until a session arms (or the mic test asks for five seconds) — the model
   *  is warm, the pipeline is idle */
  private enabled = false
  private disposed = false

  state: ModelState = 'loading'
  /** why it failed, when it did */
  error: string | null = null

  constructor(modelPath: string, modelId?: string) {
    this.worker = new Worker(new URL('../../workers/transcriber.worker.ts', import.meta.url), {
      type: 'module'
    })
    this.worker.onmessage = (e) => {
      const msg = e.data
      if (msg.type === 'ready') this.setState('warm')
      else if (msg.type === 'segment') {
        const stream: Stream = msg.speaker === 'them' ? 'them' : 'you'
        const segment: Segment = {
          speaker: msg.speaker,
          text: msg.text,
          confirmed: msg.confirmed,
          t: msg.t
        }
        for (const cb of this.subs[stream]) cb(segment)
      } else if (msg.type === 'load-failed') {
        console.warn('[transcriber]', msg.message)
        this.error = msg.message
        this.setState('failed')
      } else if (msg.type === 'error') {
        console.warn('[transcriber]', msg.message)
      }
    }
    this.worker.onerror = () => this.setState('failed')
    this.worker.postMessage({ type: 'init', modelPath, modelId })
  }

  private setState(state: ModelState): void {
    this.state = state
    this.stateCb?.(state)
  }

  onStateChange(cb: (state: ModelState) => void): void {
    this.stateCb = cb
  }

  /** a Transcriber view over one stream; the engine can't tell it isn't a
   *  worker of its own */
  transcriberFor(stream: Stream): Transcriber {
    return {
      push: (chunk: AudioChunk) => this.push(stream, chunk),
      onSegment: (cb: (s: Segment) => void) => {
        this.subscribe(stream, cb)
      }
    }
  }

  /** listen to one stream, with a way to stop — the mic test needs to attach
   *  for five seconds and detach cleanly */
  subscribe(stream: Stream, cb: (s: Segment) => void): () => void {
    this.subs[stream].push(cb)
    return () => {
      this.subs[stream] = this.subs[stream].filter((x) => x !== cb)
    }
  }

  push(stream: Stream, chunk: AudioChunk): void {
    if (this.disposed) return
    // dropped here rather than in the worker, so idle capture costs one
    // comparison instead of a structured clone plus a VAD pass per block
    if (!this.enabled) return
    this.worker.postMessage({ type: 'audio', stream, samples: chunk.samples, t: chunk.t }, [
      chunk.samples.buffer
    ])
  }

  /** arm/disarm transcription without touching the loaded model */
  setEnabled(on: boolean): void {
    if (this.enabled === on) return
    this.enabled = on
    // flush rather than reset: whatever was mid-sentence still deserves to be
    // transcribed, and leaving it in the segmenter would glue it to whatever
    // is said when transcription resumes, minutes later
    if (!on) this.flush()
  }

  get isEnabled(): boolean {
    return this.enabled
  }

  /** end of capture: transcribe whatever is mid-sentence, then clear the
   *  segmenters. Anything already queued still decodes. */
  flush(): void {
    if (!this.disposed) this.worker.postMessage({ type: 'flush' })
  }

  /** throw away audio in progress *and* the queue, keeping the loaded model */
  reset(): void {
    if (!this.disposed) this.worker.postMessage({ type: 'reset' })
  }

  /** drop every subscriber but keep the worker (and the model) alive */
  clearSubscribers(): void {
    this.subs = { them: [], you: [] }
  }

  dispose(): void {
    this.disposed = true
    this.worker.terminate()
  }
}
