/// <reference lib="webworker" />
export {}

// Whisper transcription in a worker, one instance per stream (speaker
// attribution comes from stream identity, not diarisation). Audio arrives as
// 16 kHz mono Float32 chunks; segments are flushed on ~800 ms of silence or a
// 12 s cap. Local models only — no network.

type InMsg =
  | { type: 'init'; modelPath: string; speaker: 'you' | 'them' }
  | { type: 'audio'; samples: Float32Array; t: number }

type OutMsg =
  | { type: 'ready' }
  | { type: 'error'; message: string }
  | { type: 'segment'; speaker: 'you' | 'them'; text: string; confirmed: boolean; t: number }

const SAMPLE_RATE = 16000
const SILENCE_RMS = 0.008
const SILENCE_FLUSH_MS = 800
const MAX_BUFFER_SEC = 12
const PARTIAL_EVERY_MS = 1600

let speaker: 'you' | 'them' = 'them'
let transcribe: ((audio: Float32Array, opts: object) => Promise<{ text: string }>) | null = null

let buffer: Float32Array[] = []
let bufferedSamples = 0
let silenceMs = 0
let lastPartialAt = 0
let segmentStartT = 0
let busy = false

function post(msg: OutMsg): void {
  ;(self as unknown as Worker).postMessage(msg)
}

async function init(modelPath: string): Promise<void> {
  const { pipeline, env } = await import('@xenova/transformers')
  env.allowRemoteModels = false
  env.localModelPath = modelPath
  const asr = await pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny.en')
  transcribe = (audio: Float32Array, opts: object) => asr(audio, opts) as Promise<{ text: string }>
  post({ type: 'ready' })
}

function rms(samples: Float32Array): number {
  let sum = 0
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i]
  return Math.sqrt(sum / samples.length)
}

function joined(): Float32Array {
  const out = new Float32Array(bufferedSamples)
  let o = 0
  for (const b of buffer) {
    out.set(b, o)
    o += b.length
  }
  return out
}

async function flush(confirmed: boolean): Promise<void> {
  if (!transcribe || busy || bufferedSamples < SAMPLE_RATE * 0.4) return
  busy = true
  try {
    const audio = joined()
    if (confirmed) {
      buffer = []
      bufferedSamples = 0
      silenceMs = 0
    }
    const result = await transcribe(audio, { chunk_length_s: 30 })
    const text = result.text.trim()
    if (text && !/^\[.*\]$/.test(text)) {
      post({ type: 'segment', speaker, text, confirmed, t: segmentStartT })
    }
    if (confirmed) segmentStartT = 0
  } catch (err) {
    post({ type: 'error', message: String(err) })
  } finally {
    busy = false
  }
}

self.onmessage = async (e: MessageEvent<InMsg>) => {
  const msg = e.data
  if (msg.type === 'init') {
    speaker = msg.speaker
    await init(msg.modelPath)
    return
  }
  if (msg.type === 'audio') {
    const level = rms(msg.samples)
    const chunkMs = (msg.samples.length / SAMPLE_RATE) * 1000
    if (level < SILENCE_RMS) {
      silenceMs += chunkMs
      // trailing silence closes the segment
      if (silenceMs >= SILENCE_FLUSH_MS && bufferedSamples > 0) {
        void flush(true)
      }
      return
    }
    if (bufferedSamples === 0) segmentStartT = msg.t
    silenceMs = 0
    buffer.push(msg.samples)
    bufferedSamples += msg.samples.length
    if (bufferedSamples >= SAMPLE_RATE * MAX_BUFFER_SEC) {
      void flush(true)
    } else if (Date.now() - lastPartialAt > PARTIAL_EVERY_MS) {
      lastPartialAt = Date.now()
      void flush(false) // in-flight partial → trailing words at low opacity
    }
  }
}
