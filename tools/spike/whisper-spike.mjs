// Spike: is a bigger speech model affordable?
//
// The transcript is the measured bottleneck — a run-on or a left-in disfluency
// costs 0.10-0.15 of match score, more than the entire spread between three
// embedding models (DECISIONS.md). So the highest-value model change available
// is the transcriber, if it can be afforded.
//
// This is a measurement, not a feature. If nothing clears the bar, the numbers
// ARE the deliverable and nothing ships.
//
//   node tools/spike/whisper-spike.mjs --models-dir ~/lih-asr --audio clip.wav \
//        [--wer-audio short.wav --wer-reference "what it says"] [--model <id>]
//
// Each candidate runs in its own child process. Loading three Whisper models
// into one process makes every RSS figure after the first meaningless — the
// first attempt at this reported a candidate's "peak" while two other models
// were still resident.
//
// The bar, derived from src/shared/tuning.ts before any number was taken:
//
//   A partial covers asrPartialWindowSec = 8s and is produced at most every
//   asrPartialIntervalMs = 1600ms, so an 8s clip must decode in under 1.6s or
//   the early card stops being early. Confirmed segments arrive up to one per
//   vadSoftMaxSec = 9s per stream, two streams, ~80% of wall-clock spoken, so
//   RTF ≤ 0.60 is merely "never sheds speech".
//
// That gives an ABSOLUTE bar of RTF ≤ 0.20, halved to 0.10 for a machine
// slower than the one measuring. But an absolute RTF is only meaningful on a
// machine someone would actually use, and this measurement runs on whatever
// CPU it is given — a shared cloud vCPU is not a laptop. So the bar that
// decides is RELATIVE to the incumbent, which is known to keep up in the
// field:
//
//        cost at the 8s partial window ≤ 1.5x base.en
//
// The absolute numbers are still printed, because a candidate that cannot
// clear 0.20 even natively on the measuring machine cannot clear it in wasm
// on a worse one.
//
// Two caveats the numbers cannot state themselves:
//
//  1. This runs onnxruntime-NODE (native). The app runs onnxruntime-web (wasm)
//     in a worker, which is slower. Every RTF here is an optimistic FLOOR: a
//     candidate that fails here cannot pass in the app.
//  2. Whisper pads every clip to a fixed 30s window, so the encoder is a
//     constant cost per decode that does not shrink with a short utterance.
//     That is why RTF is reported per clip length rather than as one number.
//  3. Word error rate against a clean clip runs into a ceiling: if the
//     incumbent already scores 0%, a better model cannot show a gain. Where a
//     gain would show is disfluent, mangled interview speech — which needs a
//     real recording of someone reading the bank questions aloud, and that is
//     on docs/hardware-checklist.md rather than in this repo.
//  4. The first clip length measured is still warming: give the numbers to
//     the deadline row, which runs third.

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : fallback
}

const MODELS_DIR = arg('models-dir')
const AUDIO = arg('audio')
if (!MODELS_DIR || !AUDIO) {
  console.error(
    'usage: --models-dir <transformers.js-layout dir> --audio <16kHz mono wav>\n' +
      '\nThe audio is not committed and not guessed at. For the decisive accuracy\n' +
      'axis it should be someone reading the bank questions aloud; for speed alone\n' +
      'any 16kHz mono speech clip works.'
  )
  process.exit(1)
}

const CANDIDATES = arg('model')
  ? [arg('model')]
  : ['Xenova/whisper-base.en', 'distil-whisper/distil-small.en', 'Xenova/whisper-small.en']

/** the app's real segment lengths: vad soft/hard caps, and the partial window
 *  that carries the only hard deadline (tuning.ts) */
const LENGTHS = [
  { sec: 3, what: 'short answer' },
  { sec: 6, what: 'typical question' },
  { sec: 8, what: 'PARTIAL WINDOW — the deadline' },
  { sec: 9, what: 'vadSoftMaxSec' },
  { sec: 15, what: 'vadMaxSegmentSec' }
]

const DEADLINE_SEC = 8
/** absolute, for context only — see the header */
const BAR_RTF = 0.2
/** the bar that decides: cost at the partial window, against the incumbent */
const BAR_VS_BASE = 1.5
const INCUMBENT = 'Xenova/whisper-base.en'

// ---- a 16-bit PCM wav, as Float32 mono at its own rate --------------------

function readWav(path) {
  const buf = readFileSync(path)
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error(`${path} is not a RIFF/WAVE file`)
  }
  let pos = 12
  let fmt = null
  let data = null
  while (pos + 8 <= buf.length) {
    const id = buf.toString('ascii', pos, pos + 4)
    const size = buf.readUInt32LE(pos + 4)
    const body = buf.subarray(pos + 8, pos + 8 + size)
    if (id === 'fmt ') {
      fmt = { channels: body.readUInt16LE(2), rate: body.readUInt32LE(4), bits: body.readUInt16LE(14) }
    } else if (id === 'data') {
      data = body
    }
    pos += 8 + size + (size % 2)
  }
  if (!fmt || !data) throw new Error(`${path}: no fmt/data chunk`)
  if (fmt.bits !== 16) throw new Error(`${path}: only 16-bit PCM is handled, got ${fmt.bits}`)
  const frames = Math.floor(data.length / 2 / fmt.channels)
  const out = new Float32Array(frames)
  for (let i = 0; i < frames; i++) {
    // mono-mix, which is what the app's capture does
    let sum = 0
    for (let c = 0; c < fmt.channels; c++) sum += data.readInt16LE((i * fmt.channels + c) * 2) / 32768
    out[i] = sum / fmt.channels
  }
  return { samples: out, rate: fmt.rate }
}

/** nearest-neighbour to 16kHz — good enough for a timing fixture, and the app
 *  resamples for real in lib/resample.ts */
function to16k(samples, rate) {
  if (rate === 16000) return samples
  const ratio = rate / 16000
  const out = new Float32Array(Math.floor(samples.length / ratio))
  for (let i = 0; i < out.length; i++) out[i] = samples[Math.floor(i * ratio)]
  return out
}

// ---- word error rate ------------------------------------------------------

const words = (s) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9' ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)

function wer(reference, hypothesis) {
  const r = words(reference)
  const h = words(hypothesis)
  if (r.length === 0) return null
  const d = Array.from({ length: r.length + 1 }, (_, i) => [i, ...Array(h.length).fill(0)])
  for (let j = 0; j <= h.length; j++) d[0][j] = j
  for (let i = 1; i <= r.length; i++) {
    for (let j = 1; j <= h.length; j++) {
      d[i][j] =
        r[i - 1] === h[j - 1]
          ? d[i - 1][j - 1]
          : 1 + Math.min(d[i - 1][j - 1], d[i][j - 1], d[i - 1][j])
    }
  }
  return d[r.length][h.length] / r.length
}

// ---- reporting ------------------------------------------------------------

function dirBytes(dir) {
  let total = 0
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const s = statSync(p)
    total += s.isDirectory() ? dirBytes(p) : s.size
  }
  return total
}

function fileList(dir, prefix = '') {
  const out = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...fileList(p, `${prefix}${name}/`))
    else out.push(`${prefix}${name}`)
  }
  return out.sort()
}

const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(0)}MB`
const rssMb = () => process.memoryUsage().rss / 1024 / 1024
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]

// ---- run ------------------------------------------------------------------

const REF_AUDIO = arg('wer-audio')
const REFERENCE = arg('wer-reference')

async function measure(id) {
  const { samples, rate } = readWav(AUDIO)
  const audio = to16k(samples, rate)

  const { pipeline, env } = await import('@xenova/transformers')
  env.localModelPath = MODELS_DIR
  env.allowRemoteModels = false

  const dir = join(MODELS_DIR, ...id.split('/'))
  let onDisk
  try {
    onDisk = dirBytes(dir)
  } catch {
    console.log(`── ${id}: not in ${MODELS_DIR} — skipped`)
    return null
  }

  const rssBefore = rssMb()
  const loadStart = performance.now()
  let transcribe
  try {
    transcribe = await pipeline('automatic-speech-recognition', id, { quantized: true })
  } catch (err) {
    console.log(`── ${id}: failed to load — ${err.message}`)
    return null
  }
  const loadSec = (performance.now() - loadStart) / 1000
  const rssLoaded = rssMb()

  console.log(`── ${id}`)
  console.log(`   on disk        ${mb(onDisk)}   load ${loadSec.toFixed(1)}s`)
  // a manifest missing a file the runtime wants is a model that can never load
  // offline — print what is actually here so the manifest can match it
  console.log(`   files          ${fileList(dir).join(', ')}`)

  // one discarded warm-up, matching the app's own asrWarmupMs posture
  await transcribe(audio.slice(0, 16000 * 3))

  let deadlineSec = null
  for (const { sec, what } of LENGTHS) {
    const clip = audio.slice(0, 16000 * sec)
    if (clip.length < 16000 * sec) {
      console.log(`   ${String(sec).padStart(2)}s            (clip is shorter than this)`)
      continue
    }
    const runs = []
    let tokens = 0
    for (let i = 0; i < 3; i++) {
      const t0 = performance.now()
      const out = await transcribe(clip)
      runs.push((performance.now() - t0) / 1000)
      tokens = words(out.text ?? '').length
    }
    const m = median(runs)
    if (sec === DEADLINE_SEC) deadlineSec = m
    // words out is reported because decode time tracks tokens generated, not
    // clip length — Whisper pads to a fixed 30s window either way
    console.log(
      `   ${String(sec).padStart(2)}s decode      ${m.toFixed(2)}s · RTF ${(m / sec).toFixed(3)} · ${String(tokens).padStart(3)} words out   ${what}`
    )
  }

  let werRate = null
  if (REF_AUDIO && REFERENCE) {
    const ref = readWav(REF_AUDIO)
    const heard = (await transcribe(to16k(ref.samples, ref.rate))).text ?? ''
    werRate = wer(REFERENCE, heard)
    console.log(`   word errors    ${(werRate * 100).toFixed(1)}%   on ${REF_AUDIO}`)
    console.log(`   heard          ${heard.trim()}`)
  }

  const rssPeak = rssMb()
  console.log(
    `   rss            ${rssBefore.toFixed(0)}MB → ${rssLoaded.toFixed(0)}MB loaded → ${rssPeak.toFixed(0)}MB peak`
  )
  return { id, onDisk, deadlineSec, rssPeak, wer: werRate }
}

// child: one candidate, one process, so RSS means something
if (process.argv.includes('--child')) {
  const result = await measure(arg('model'))
  console.log(`##RESULT##${JSON.stringify(result)}`)
  process.exit(0)
}

const { spawn } = await import('node:child_process')

console.log(`\nmodels from ${MODELS_DIR}`)
console.log(`timing clip ${AUDIO}`)
console.log('onnxruntime-node (native). The app runs wasm, which is slower, so every')
console.log('number here is a FLOOR — a candidate that fails natively cannot pass in the app.')
console.log(`Absolute RTF depends on this machine; the bar that decides is ≤${BAR_VS_BASE}x the incumbent.\n`)

const results = []
for (const id of CANDIDATES) {
  const child = spawn(
    process.execPath,
    [
      new URL(import.meta.url).pathname,
      '--child',
      '--model',
      id,
      '--models-dir',
      MODELS_DIR,
      '--audio',
      AUDIO,
      ...(REF_AUDIO ? ['--wer-audio', REF_AUDIO] : []),
      ...(REFERENCE ? ['--wer-reference', REFERENCE] : [])
    ],
    { stdio: ['ignore', 'pipe', 'inherit'], env: { ...process.env, ORT_LOGGING_LEVEL: '3' } }
  )
  let buf = ''
  child.stdout.on('data', (d) => {
    buf += d.toString()
    let at
    while ((at = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, at)
      buf = buf.slice(at + 1)
      if (line.startsWith('##RESULT##')) {
        const parsed = JSON.parse(line.slice('##RESULT##'.length))
        if (parsed) results.push(parsed)
      } else {
        console.log(line)
      }
    }
  })
  await new Promise((resolve) => child.on('exit', resolve))
  console.log('')
}

// ---- the verdict, against the bar written above ---------------------------

const base = results.find((r) => r.id === INCUMBENT)
if (!base || results.length < 2) {
  console.log('nothing to compare — run without --model to measure the whole set\n')
  process.exit(0)
}

console.log('── against the bar')
console.log(
  `   incumbent ${INCUMBENT}: ${base.deadlineSec?.toFixed(2)}s at the ${DEADLINE_SEC}s partial window` +
    ` (RTF ${(base.deadlineSec / DEADLINE_SEC).toFixed(3)})\n`
)
for (const r of results) {
  if (r.id === base.id) continue
  const size = (r.onDisk - base.onDisk) / 1024 / 1024
  const rss = r.rssPeak - base.rssPeak
  const times = r.deadlineSec / base.deadlineSec
  const rtf = r.deadlineSec / DEADLINE_SEC
  const verdict = (ok, text) => `${ok ? 'ok  ' : 'FAIL'} ${text}`
  console.log(`   ${r.id}`)
  console.log(`     ${verdict(size <= 100, `size +${size.toFixed(0)}MB (bar +100MB)`)}`)
  console.log(`     ${verdict(rss <= 400, `rss +${rss.toFixed(0)}MB (bar +400MB)`)}`)
  console.log(
    `     ${verdict(times <= BAR_VS_BASE, `${times.toFixed(2)}x the incumbent at the partial window (bar ${BAR_VS_BASE}x) · RTF ${rtf.toFixed(3)} here${rtf > BAR_RTF ? `, already over the absolute ${BAR_RTF} before wasm` : ''}`)}`
  )
  console.log(
    `     ${
      r.wer == null || base.wer == null
        ? '     accuracy not measured — needs a clip with a known transcript'
        : verdict(
            r.wer < base.wer,
            `word errors ${(r.wer * 100).toFixed(1)}% vs ${(base.wer * 100).toFixed(1)}%${r.wer < base.wer ? '' : ' — and speed was never the problem'}`
          )
    }`
  )
  console.log('')
}
