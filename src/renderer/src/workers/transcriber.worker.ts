/// <reference lib="webworker" />
import { TUNING } from '@shared/tuning'
import { DEFAULT_WHISPER_MODEL, FALLBACK_WHISPER_MODEL } from '@shared/models'
import { VadSegmenter, normalizeForAsr, type Utterance } from '@/lib/dsp/vad'
import { cleanTranscript, isLikelyHallucination } from '@/lib/asrText'
import { AsrQueue, rank, type Stream } from '@/lib/asrQueue'

export {}

// Whisper transcription. One worker, one copy of the model, both streams —
// speaker attribution is stream identity, not diarisation. Audio arrives as
// 16 kHz mono Float32 chunks. Local models only; no network.
//
// There used to be one worker per stream. Two copies of base.en is ~290MB
// resident and two decodes competing blindly for the same cores, with no way
// to say which mattered more. Here the queue knows: the interviewer's audio
// drives the panel, yours drives coverage.
//
// Segmentation lives in VadSegmenter (adaptive floor, pre-roll, hangover, hard
// caps) — this file is model lifecycle, the queue, and output filtering.

type InMsg =
  | { type: 'init'; modelPath: string; modelId?: string }
  | { type: 'audio'; stream: Stream; samples: Float32Array; t: number }
  /** end of capture: emit whatever is still open rather than losing it */
  | { type: 'flush' }
  /** pause/resume: drop in-progress audio without tearing the model down */
  | { type: 'reset' }

type OutMsg =
  | { type: 'ready' }
  | { type: 'error'; message: string }
  | { type: 'segment'; speaker: 'you' | 'them'; text: string; confirmed: boolean; t: number }

const STREAMS: Stream[] = ['them', 'you']

let transcribe: ((audio: Float32Array, opts: object) => Promise<{ text: string }>) | null = null

const vad: Record<Stream, VadSegmenter> = {
  them: new VadSegmenter(TUNING.asrSampleRate),
  you: new VadSegmenter(TUNING.asrSampleRate)
}
/** each segmenter counts from its own first sample; the source's clock started
 *  earlier (capture runs before the session does), so anchor to the offset */
const clockOffset: Record<Stream, number | null> = { them: null, you: null }
const lastPartialAt: Record<Stream, number> = { them: 0, you: 0 }

function post(msg: OutMsg): void {
  ;(self as unknown as Worker).postMessage(msg)
}

async function init(modelPath: string, modelId: string): Promise<void> {
  const { pipeline, env } = await import('@xenova/transformers')
  env.allowRemoteModels = false
  env.localModelPath = modelPath
  let asr: Awaited<ReturnType<typeof pipeline>>
  try {
    asr = await pipeline('automatic-speech-recognition', modelId)
  } catch (err) {
    // the chosen tier isn't on disk, or its download was interrupted.
    // Transcribing with the smaller model beats transcribing nothing —
    // silence is exactly the failure this whole round is about.
    if (modelId === FALLBACK_WHISPER_MODEL) throw err
    post({ type: 'error', message: `${modelId} failed to load — falling back to the smaller model` })
    asr = await pipeline('automatic-speech-recognition', FALLBACK_WHISPER_MODEL)
  }
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

// ---- the queue -------------------------------------------------------------
// One decode at a time: Whisper is the bottleneck and two concurrent decodes in
// one worker just make both slower. Ordering and eviction live in AsrQueue,
// which is pure and unit-tested; this file only supplies the jobs.

interface Job {
  stream: Stream
  confirmed: boolean
  audio: Float32Array
  t: number
  speechMs: number
}

const queue = new AsrQueue<Job>(TUNING.asrMaxQueued)
let runningRank: number | null = null

function enqueue(job: Job): void {
  const { dropped } = queue.push(job, runningRank)
  // a dropped *confirmed* segment is lost speech and the user should be able
  // to find out why; dropped partials are the intended pressure valve
  if (dropped.some((d) => d.confirmed)) {
    post({ type: 'error', message: 'transcription is falling behind — dropped the oldest segment' })
  }
  void pump()
}

async function pump(): Promise<void> {
  if (runningRank !== null || !transcribe) return
  for (;;) {
    const job = queue.shift()
    if (!job) break
    runningRank = rank(job)
    try {
      await run(job)
    } finally {
      runningRank = null
    }
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
    post({ type: 'segment', speaker: job.stream, text, confirmed: job.confirmed, t: job.t })
  } catch (err) {
    post({ type: 'error', message: String(err) })
  }
}

// ---- audio in --------------------------------------------------------------

function emit(stream: Stream, u: Utterance): void {
  enqueue({
    stream,
    confirmed: true,
    audio: u.samples,
    t: (clockOffset[stream] ?? 0) + u.startT,
    speechMs: u.speechMs
  })
}

function onAudio(stream: Stream, samples: Float32Array, t: number): void {
  if (clockOffset[stream] === null) clockOffset[stream] = t
  for (const u of vad[stream].push(samples)) emit(stream, u)

  // in-flight partial → the panel's trailing words, and the early match
  const now = Date.now()
  if (now - lastPartialAt[stream] < TUNING.asrPartialIntervalMs) return
  const open = vad[stream].peekOpen(TUNING.asrPartialWindowSec)
  if (!open || open.speechMs < TUNING.asrPartialMinSpeechMs) return
  lastPartialAt[stream] = now
  enqueue({
    stream,
    confirmed: false,
    audio: open.samples,
    t: (clockOffset[stream] ?? 0) + open.startT,
    speechMs: open.speechMs
  })
}

function clearStream(stream: Stream): void {
  vad[stream].reset()
  clockOffset[stream] = null
  lastPartialAt[stream] = 0
}

self.onmessage = async (e: MessageEvent<InMsg>) => {
  const msg = e.data
  try {
    switch (msg.type) {
      case 'init':
        await init(msg.modelPath, msg.modelId ?? DEFAULT_WHISPER_MODEL)
        break
      case 'audio':
        onAudio(msg.stream, msg.samples, msg.t)
        break
      case 'flush':
        // emit whatever is open, then clear the segmenters. Queued work still
        // decodes — this is "capture stopped", not "throw it away".
        for (const stream of STREAMS) {
          const tail = vad[stream].flush()
          if (tail) emit(stream, tail)
          clearStream(stream)
        }
        break
      case 'reset':
        for (const stream of STREAMS) clearStream(stream)
        queue.clear()
        break
    }
  } catch (err) {
    post({ type: 'error', message: String(err) })
  }
}
