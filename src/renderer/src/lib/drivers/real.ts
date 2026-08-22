import type { AudioChunk, AudioSource } from '@shared/types'
import type { EmbeddingProvider } from '../embeddings'
import captureWorkletUrl from './capture.worklet.ts?worker&url'
import { Biquad, Resampler } from '../dsp/resample'
import { TUNING } from '@shared/tuning'
import { loopbackGuidance } from '../devices'

// Real capture path. Speaker attribution comes from stream identity:
// system/meeting audio is `them`, the microphone is `you`. Transcription
// itself lives in TranscriptionService (one worker, both streams). All
// processing stays on this machine.

const TARGET_RATE = TUNING.asrSampleRate

abstract class MediaStreamSource implements AudioSource {
  private cb: ((c: AudioChunk) => void) | null = null
  private errCb: ((e: Error) => void) | null = null
  private deviceCb: ((label: string) => void) | null = null
  private ctx: AudioContext | null = null
  private node: AudioWorkletNode | null = null
  private mediaStream: MediaStream | null = null
  private disposed = false
  private resampler: Resampler | null = null
  private highpass: Biquad | null = null
  /** output samples emitted so far — the session clock is derived from this
   *  rather than Date.now(), so main-thread jank cannot shift timestamps */
  private producedSamples = 0

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
    // the real device name, which only the track knows. Without this the UI
    // showed a hardcoded 'Your mic' and a silently-switched input was invisible
    const label = this.mediaStream.getAudioTracks()[0]?.label
    if (label) this.deviceCb?.(label)
    // A dying capture must be LOUD. Unplugged headset, Bluetooth battery,
    // permission revoked, the OS "Stop sharing" bar — all end or mute the
    // track, and with no listener the panel just went quiet with the dot stuck
    // green (REVIEW.md C4).
    for (const track of this.mediaStream.getAudioTracks()) {
      track.addEventListener('ended', () => {
        if (this.disposed) return
        this.errCb?.(
          new Error(
            `the ${this.streamName === 'mic' ? 'microphone' : 'meeting audio'} input stopped — device unplugged, switched, or permission revoked. Re-pick the device on the setup screen.`
          )
        )
      })
      let muteTimer: ReturnType<typeof setTimeout> | null = null
      track.addEventListener('mute', () => {
        if (this.disposed) return
        // transient mutes happen (Bluetooth renegotiation); only a sustained
        // one means the device stopped delivering audio
        muteTimer = setTimeout(() => {
          if (!this.disposed && track.muted) {
            this.errCb?.(
              new Error(
                `the ${this.streamName === 'mic' ? 'microphone' : 'meeting audio'} input went silent at the device level — it may have been switched off or claimed by another app.`
              )
            )
          }
        }, 4000)
      })
      track.addEventListener('unmute', () => {
        if (muteTimer) clearTimeout(muteTimer)
        muteTimer = null
      })
    }
    this.ctx = new AudioContext()
    // sleep/wake can leave the context suspended; try to resume, and say so
    // if that fails rather than sitting silent
    this.ctx.addEventListener('statechange', () => {
      const ctx = this.ctx
      if (!ctx || this.disposed) return
      if ((ctx.state as string) === 'suspended' || (ctx.state as string) === 'interrupted') {
        void ctx.resume().catch(() => {})
        setTimeout(() => {
          if (!this.disposed && this.ctx && this.ctx.state !== 'running') {
            this.errCb?.(
              new Error(
                'the audio engine was suspended (machine slept?) and did not resume — restart listening from the setup screen.'
              )
            )
          }
        }, 1000)
      }
    })
    // capture runs on the audio thread; ScriptProcessorNode (deprecated,
    // main-thread) would jank the panel
    await this.ctx.audioWorklet.addModule(captureWorkletUrl)
    if (this.disposed) return
    const src = this.ctx.createMediaStreamSource(this.mediaStream)
    const inRate = this.ctx.sampleRate
    this.highpass = Biquad.highpass(inRate, TUNING.inputHighpassHz)
    this.resampler = new Resampler(inRate, TARGET_RATE, {
      zeroCrossings: TUNING.resamplerZeroCrossings,
      rolloff: TUNING.resamplerRolloff,
      phases: TUNING.resamplerPhases
    })
    this.node = new AudioWorkletNode(this.ctx, 'capture', {
      numberOfInputs: 1,
      channelCount: 1,
      // 'explicit' is what actually makes the graph downmix to mono. Under the
      // default 'max' the channelCount above is ignored and the worklet only
      // ever saw the left channel — the right one was silently discarded.
      channelCountMode: 'explicit',
      channelInterpretation: 'speakers'
    })
    this.node.port.onmessage = (e: MessageEvent<Float32Array>) => {
      if (!this.resampler || !this.highpass) return
      // high-pass first so rumble never reaches the level estimate, then
      // resample properly rather than dropping two of every three samples
      const filtered = this.highpass.process(e.data)
      const samples = this.resampler.process(filtered)
      if (samples.length === 0) return
      const t = this.producedSamples / TARGET_RATE
      this.producedSamples += samples.length
      this.cb?.({ stream: this.streamName, samples, sampleRate: TARGET_RATE, t })
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
    this.resampler = null
    this.highpass = null
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

  /** the device's real name, once a track exists */
  onDevice(cb: (label: string) => void): void {
    this.deviceCb = cb
  }
}

export class MicAudioSource extends MediaStreamSource {
  constructor(private deviceId: string | null = null) {
    super('mic')
  }
  protected acquire(): Promise<MediaStream> {
    return navigator.mediaDevices.getUserMedia({
      audio: {
        // an exact id would fail outright when the device is unplugged
        // mid-interview; ideal falls back to the system default instead
        ...(this.deviceId ? { deviceId: { ideal: this.deviceId } } : {}),
        // Chromium's speech-tuned processing chain. Echo cancellation is what
        // keeps the meeting audio coming out of your speakers from being
        // transcribed as *you*; gain control is a real rescue for a quiet mic
        echoCancellation: true,
        autoGainControl: true,
        noiseSuppression: true,
        channelCount: 1
      },
      video: false
    })
  }
}

/**
 * The meeting side, by one of two routes.
 *
 * `getDisplayMedia` + main's loopback request handler captures system audio
 * directly, but Electron only supports that on Windows. Everywhere else the
 * meeting has to be routed through a virtual audio cable (BlackHole and
 * friends) and picked up as an ordinary input — which is what a non-null
 * deviceId means here.
 */
export class MeetingAudioSource extends MediaStreamSource {
  constructor(private deviceId: string | null = null) {
    super('meeting')
  }
  protected async acquire(): Promise<MediaStream> {
    if (this.deviceId) {
      return navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: { ideal: this.deviceId },
          // a loopback device carries clean digital audio that never went
          // through the air. Every one of these would only damage it — and
          // echo cancellation in particular would gate out the interviewer
          // whenever you were talking.
          echoCancellation: false,
          autoGainControl: false,
          noiseSuppression: false,
          channelCount: 1
        },
        video: false
      })
    }
    const stream = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true })
    // the video track is only a capture-API requirement — drop it
    stream.getVideoTracks().forEach((t) => t.stop())
    if (stream.getAudioTracks().length === 0) {
      stream.getTracks().forEach((t) => t.stop())
      throw new Error(`no system-audio track — ${loopbackGuidance()}`)
    }
    return stream
  }
}

/** MiniLM embeddings behind the EmbeddingProvider interface */
export class WorkerEmbeddings implements EmbeddingProvider {
  private worker: Worker
  private seq = 0
  private pending = new Map<
    number,
    { resolve: (v: Float32Array[]) => void; reject: (e: Error) => void }
  >()
  ready = false

  constructor(modelPath: string) {
    this.worker = new Worker(new URL('../../workers/embeddings.worker.ts', import.meta.url), {
      type: 'module'
    })
    this.worker.onmessage = (e) => {
      const msg = e.data
      if (msg.type === 'ready') this.ready = true
      else if (msg.type === 'embedded') {
        this.pending.get(msg.id)?.resolve(msg.vectors)
        this.pending.delete(msg.id)
      } else if (msg.type === 'error') {
        // an error WITH an id rejects that one request so the cache can retry
        // it later; one without is the model load itself failing, which dooms
        // everything in flight. Leaving these pending forever silently turned
        // semantic matching off for the session (REVIEW.md C8).
        console.warn('[embeddings]', msg.message)
        if (msg.id != null) {
          this.pending.get(msg.id)?.reject(new Error(msg.message))
          this.pending.delete(msg.id)
        } else {
          this.rejectAll(new Error(msg.message))
        }
      }
    }
    this.worker.onerror = (e) => {
      console.warn('[embeddings] worker crashed:', e.message)
      this.rejectAll(new Error(`embeddings worker crashed: ${e.message}`))
    }
    this.worker.postMessage({ type: 'init', modelPath })
  }

  private rejectAll(err: Error): void {
    for (const p of this.pending.values()) p.reject(err)
    this.pending.clear()
  }

  embed(texts: string[]): Promise<Float32Array[]> {
    const id = this.seq++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.worker.postMessage({ type: 'embed', id, texts })
    })
  }

  dispose(): void {
    this.rejectAll(new Error('embeddings worker disposed'))
    this.worker.terminate()
  }
}
