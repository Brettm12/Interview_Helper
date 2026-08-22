import type { AudioChunk, Segment, Transcriber } from '@shared/types'
import type { Stream } from '../asrQueue'

// One Whisper worker serving both streams, presented to the rest of the app as
// two ordinary Transcribers. Two workers meant two full copies of base.en
// (~290MB) and two decodes competing for the same cores with no way to say
// which one mattered; the queue inside the worker now knows.

export type ModelState = 'loading' | 'warm' | 'failed'

export class TranscriptionService {
  private worker!: Worker
  private subs: Record<Stream, ((s: Segment) => void)[]> = { them: [], you: [] }
  private stateCb: ((state: ModelState) => void) | null = null
  private errorCb: ((message: string) => void) | null = null
  /** capture runs from the setup screen onward, but nothing is transcribed
   *  until a session arms (or the mic test asks for five seconds) — the model
   *  is warm, the pipeline is idle. Per-stream, so the mic test can open only
   *  its own stream without decoding meeting audio (REVIEW.md L4). */
  private enabled = new Set<Stream>()
  private disposed = false
  /** crash-loop guard for restart() */
  private restarts = 0

  state: ModelState = 'loading'
  /** why it failed, when it did */
  error: string | null = null

  constructor(
    private modelPath: string,
    private modelId?: string
  ) {
    this.spawn()
  }

  private spawn(): void {
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
        // decode failures and shed segments used to die in the console while
        // the panel looked healthy (REVIEW.md H2) — surface them
        console.warn('[transcriber]', msg.message)
        this.errorCb?.(msg.message)
      }
    }
    this.worker.onerror = (e) => {
      this.error = e.message ?? 'transcription worker crashed'
      this.setState('failed')
    }
    this.setState('loading')
    this.worker.postMessage({ type: 'init', modelPath: this.modelPath, modelId: this.modelId })
  }

  private setState(state: ModelState): void {
    this.state = state
    this.stateCb?.(state)
  }

  onStateChange(cb: (state: ModelState) => void): void {
    this.stateCb = cb
  }

  /** decode errors and falling-behind drops, for the diagnostics/live banner */
  onError(cb: (message: string) => void): void {
    this.errorCb = cb
  }

  /**
   * Tear down a failed worker and load a fresh one, keeping subscribers and
   * the enabled state — mid-session recovery from a worker crash. At most two
   * per service so a persistent failure can't loop forever.
   * @returns false when the restart budget is spent
   */
  restart(): boolean {
    if (this.disposed || this.restarts >= 2) return false
    this.restarts++
    this.worker.terminate()
    this.spawn()
    return true
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
    if (!this.enabled.has(stream)) return
    this.worker.postMessage({ type: 'audio', stream, samples: chunk.samples, t: chunk.t }, [
      chunk.samples.buffer
    ])
  }

  /** arm/disarm transcription for the given streams (default both) without
   *  touching the loaded model */
  setEnabled(on: boolean, streams: Stream[] = ['them', 'you']): void {
    for (const stream of streams) {
      const was = this.enabled.has(stream)
      if (on === was) continue
      if (on) this.enabled.add(stream)
      else {
        this.enabled.delete(stream)
        // flush rather than reset: whatever was mid-sentence still deserves to
        // be transcribed, and leaving it in the segmenter would glue it to
        // whatever is said when transcription resumes, minutes later
        this.flush(stream)
      }
    }
  }

  get isEnabled(): boolean {
    return this.enabled.size > 0
  }

  isStreamEnabled(stream: Stream): boolean {
    return this.enabled.has(stream)
  }

  /** end of capture: transcribe whatever is mid-sentence, then clear the
   *  segmenter(s). Anything already queued still decodes. */
  flush(stream?: Stream): void {
    if (!this.disposed) this.worker.postMessage({ type: 'flush', stream })
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
