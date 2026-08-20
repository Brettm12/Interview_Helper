/// <reference lib="webworker" />
import { TUNING } from '@shared/tuning'
import { VadSegmenter, normalizeForAsr, type Utterance } from '@/lib/dsp/vad'
import { cleanTranscript, isLikelyHallucination } from '@/lib/asrText'

export {}

// Whisper transcription in a worker, one instance per stream (speaker
// attribution comes from stream identity, not diarisation). Audio arrives as
// 16 kHz mono Float32 chunks. Local models only — no network.
//
// This worker used to do its own segmentation with a fixed 0.008 RMS gate, and
// each part of that was a bug you could hear:
//
//  - a mic quieter than the constant produced no transcript at all, silently
//  - sub-threshold chunks were dropped *before buffering*, so Whisper received
//    speech spliced together at every inter-word gap
//  - 800ms closed a segment, which is inside an ordinary pause
//  - short buffers early-returned from flush without being cleared, so a "yes"
//    glued itself onto whatever was said minutes later
//  - partials re-transcribed the entire growing buffer, so they got steadily
//    more expensive until the `busy` guard started dropping real flushes
//
// Segmentation now lives in VadSegmenter (adaptive floor, pre-roll, hangover,
// hard caps — and unit-tested, which none of the above ever was). What remains
// here is model lifecycle, a serial queue, and output filtering.

type InMsg =
  | { type: 'init'; modelPath: string; speaker: 'you' | 'them'; modelId?: string }
  | { type: 'audio'; samples: Float32Array; t: number }
  /** end of capture: emit whatever is still open rather than losing it */
  | { type: 'flush' }
  /** pause/resume: drop in-progress audio without tearing the model down */
  | { type: 'reset' }

type OutMsg =
  | { type: 'ready' }
  | { type: 'error'; message: string }
  | { type: 'segment'; speaker: 'you' | 'them'; text: string; confirmed: boolean; t: number }

const DEFAULT_MODEL = 'Xenova/whisper-tiny.en'

let speaker: 'you' | 'them' = 'them'
let transcribe: ((audio: Float32Array, opts: object) => Promise<{ text: string }>) | null = null

const vad = new VadSegmenter(TUNING.asrSampleRate)
/** the segmenter counts from its own first sample; the source's clock started
 *  earlier (capture runs before the session does), so anchor to the offset */
let clockOffset: number | null = null
let lastPartialAt = 0

function post(msg: OutMsg): void {
  ;(self as unknown as Worker).postMessage(msg)
}

async function init(modelPath: string, modelId: string): Promise<void> {
  const { pipeline, env } = await import('@xenova/transformers')
  env.allowRemoteModels = false
  env.localModelPath = modelPath
  const asr = await pipeline('automatic-speech-recognition', modelId)
  transcribe = (audio: Float32Array, opts: object) => asr(audio, opts) as Promise<{ text: string }>
  // compile the graph on silence now rather than partway through the first
  // answer, where the delay is indistinguishable from "it isn't working"
  try {
    const warm = new Float32Array(Math.round((TUNING.asrSampleRate * TUNING.asrWarmupMs) / 1000))
    await transcribe(warm, {})
  } catch {
    // a warm-up failure is not a load failure — the real path reports its own
  }
  post({ type: 'ready' })
  // audio that arrived while the model was loading is already queued, and
  // nothing else will come along to start it
  void pump()
}

// ---- serial transcription queue -------------------------------------------
// One job at a time: Whisper is the bottleneck and running two decodes
// concurrently in one worker just makes both slower. The old code guarded with
// a `busy` flag and *dropped* whatever arrived during a decode, which meant
// real speech was lost precisely when the machine was under load.

interface Job {
  audio: Float32Array
  confirmed: boolean
  t: number
  speechMs: number
}

const queue: Job[] = []
let running = false

function enqueue(job: Job): void {
  if (!job.confirmed) {
    // a partial that has to wait is stale before it runs — and the confirmed
    // text for the same audio is right behind it
    if (running || queue.length > 0) return
  } else {
    // confirmed text supersedes any queued partial of the same speech
    for (let i = queue.length - 1; i >= 0; i--) if (!queue[i].confirmed) queue.splice(i, 1)
    while (queue.length >= TUNING.asrMaxQueued) {
      queue.shift()
      post({ type: 'error', message: 'transcription is falling behind — dropped the oldest segment' })
    }
  }
  queue.push(job)
  void pump()
}

async function pump(): Promise<void> {
  if (running || !transcribe) return
  running = true
  try {
    while (queue.length > 0) {
      const job = queue.shift() as Job
      await run(job)
    }
  } finally {
    running = false
  }
}

async function run(job: Job): Promise<void> {
  if (!transcribe) return
  try {
    // whatever level the mic delivered, the model sees something sane
    const { samples } = normalizeForAsr(job.audio)
    const seconds = samples.length / TUNING.asrSampleRate
    // Whisper's window is 30s; below that, chunked long-form is pure overhead
    const opts = seconds > 30 ? { chunk_length_s: 30 } : {}
    const result = await transcribe(samples, opts)
    const text = cleanTranscript(result.text)
    if (isLikelyHallucination(text, job.speechMs)) return
    post({ type: 'segment', speaker, text, confirmed: job.confirmed, t: job.t })
  } catch (err) {
    post({ type: 'error', message: String(err) })
  }
}

// ---- audio in --------------------------------------------------------------

function emit(u: Utterance): void {
  enqueue({
    audio: u.samples,
    confirmed: true,
    t: (clockOffset ?? 0) + u.startT,
    speechMs: u.speechMs
  })
}

function onAudio(samples: Float32Array, t: number): void {
  if (clockOffset === null) clockOffset = t
  for (const u of vad.push(samples)) emit(u)

  // in-flight partial → the panel's trailing words at low opacity
  const now = Date.now()
  if (now - lastPartialAt < TUNING.asrPartialIntervalMs) return
  const open = vad.peekOpen(TUNING.asrPartialWindowSec)
  if (!open || open.speechMs < TUNING.asrPartialMinSpeechMs) return
  lastPartialAt = now
  enqueue({
    audio: open.samples,
    confirmed: false,
    t: (clockOffset ?? 0) + open.startT,
    speechMs: open.speechMs
  })
}

self.onmessage = async (e: MessageEvent<InMsg>) => {
  const msg = e.data
  try {
    switch (msg.type) {
      case 'init':
        speaker = msg.speaker
        await init(msg.modelPath, msg.modelId ?? DEFAULT_MODEL)
        break
      case 'audio':
        onAudio(msg.samples, msg.t)
        break
      case 'flush': {
        const tail = vad.flush()
        if (tail) emit(tail)
        break
      }
      case 'reset':
        vad.reset()
        queue.length = 0
        clockOffset = null
        break
    }
  } catch (err) {
    post({ type: 'error', message: String(err) })
  }
}
