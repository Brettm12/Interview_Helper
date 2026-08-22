// Spike: can a small instruction model turn someone's own rambling answer
// into points they could actually say, on their own machine, at a size and
// speed worth installing?
//
// This is a measurement, not a feature. It exists because the plan for the
// prep-time model said to measure before building: if a candidate cannot do
// this at a tolerable size and speed, the numbers ARE the deliverable and the
// feature does not ship.
//
//   node tools/spike/llm-spike.mjs --models-dir ~/lih-llm [--model <id>]
//
// Two caveats that the numbers cannot state themselves:
//
//  1. This runs under onnxruntime-NODE (native). The app runs onnxruntime-web
//     (wasm) inside a worker, which is materially slower — commonly 2-4x on
//     the same machine. Treat every tokens/sec here as an optimistic ceiling.
//  2. Nothing here touches the app. No interviewer speech exists in this
//     process; the fixture is a person talking about their own work.
//
// THE GATE. A generated line ships only if it passes all four, checked
// mechanically rather than by reading it and feeling reassured:
//
//   - every content word in it appears in the source (stems compared, so
//     "interviewed" counts as "interview");
//   - every number in it was said;
//   - it does not flip a negation the source made, or make one it did not;
//   - it is close to something actually said, not a recombination of the
//     whole answer (cosine ≥ 0.6 to its nearest source clause, on the
//     encoder the app already ships).
//
// The bar for the model as a whole: ≥90% of its lines pass. The first round
// of candidates produced a fabricated "sex scandal", an inverted fact, and a
// plausible-sounding line nobody said — all of which this catches.

import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : fallback
}

const MODELS_DIR = arg('models-dir')
if (!MODELS_DIR) {
  console.error('--models-dir is required (a transformers.js-layout directory)')
  process.exit(1)
}

const CANDIDATES = arg('model')
  ? [{ id: arg('model'), task: arg('task', 'text-generation'), dtype: arg('dtype', 'q8') }]
  : [
      // the 2023-era set, kept because their failures are the reason the gate
      // below exists: a fabricated "sex scandal", an inverted fact, a
      // plausible line nobody said
      { id: 'Xenova/flan-t5-small', task: 'text2text-generation', dtype: 'q8' },
      { id: 'Xenova/LaMini-Flan-T5-248M', task: 'text2text-generation', dtype: 'q8' },
      { id: 'Xenova/Qwen1.5-0.5B-Chat', task: 'text-generation', dtype: 'q8' },
      // what the library upgrade unlocked
      { id: 'onnx-community/Qwen2.5-1.5B-Instruct', task: 'text-generation', dtype: 'q4f16' }
    ]

// A real answer, as people actually give them: circling, self-correcting,
// three ideas tangled together. This is the input the feature would get.
const RAMBLE = `so the hardest one was probably this case where we had two people
come forward about the same supervisor and honestly the site had a bit of a
history of that sort of thing being brushed under the carpet, um, so the first
thing I did was I moved people apart on the schedule rather than suspending
anybody because suspension reads as guilt before you know anything, and then I
just worked through it, I think it was eleven interviews over about five days
and I wrote each one up as I went rather than at the end which I've learned the
hard way matters, and the decision held, nobody grieved it, nobody appealed it,
which given where that site had been was the part I was pleased about.`

const ASK =
  'Turn this into three short notes I could say out loud in an interview. Write them in my voice, first person, one line each. Use my own words.'

// A causal chat model needs its chat template or it answers nothing at all.
const chatml = (text) =>
  `<|im_start|>system\nYou help someone prepare for a job interview.<|im_end|>\n<|im_start|>user\n${text}<|im_end|>\n<|im_start|>assistant\n`

const STRICT =
  'Turn this into three short notes I could say out loud in an interview. First person, one line each. Use ONLY facts and words that appear below - do not add anything, do not invent details.'

const PROMPTS = {
  'text2text-generation': [
    { name: 'ask + ramble', text: `${ASK}\n\n${RAMBLE}` },
    { name: 'summarize', text: `Summarize in three first-person bullet points:\n\n${RAMBLE}` },
    { name: 'strict', text: `${STRICT}\n\n${RAMBLE}` }
  ],
  'text-generation': [
    { name: 'chatml', text: chatml(`${ASK}\n\n${RAMBLE}`) },
    { name: 'chatml strict', text: chatml(`${STRICT}\n\n${RAMBLE}`) },
    // the fairest shot: show it the operation instead of describing it
    {
      name: 'chatml few-shot',
      text: chatml(
        'Shorten what someone said into three notes, by COPYING their own phrases. ' +
          'Never introduce a word they did not use.\n\n' +
          'Example.\nThey said: "so we had, um, a launch that went badly wrong and I ' +
          'think the thing was we shipped on a Friday which nobody should ever do, ' +
          'and then it took us until Monday to roll it back."\n' +
          'Notes:\n- We shipped on a Friday, which nobody should ever do\n' +
          '- It took us until Monday to roll it back\n\n' +
          `Now do the same.\nThey said: "${RAMBLE}"\nNotes:`
      )
    }
  ]
}

function dirBytes(dir) {
  let total = 0
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const s = statSync(p)
    total += s.isDirectory() ? dirBytes(p) : s.size
  }
  return total
}

const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(0)}MB`
const rssMb = () => process.memoryUsage().rss / 1024 / 1024

// ---- the gate --------------------------------------------------------------

/** crude but symmetric stemmer: enough to let "interviewed" match "interview"
 *  without letting "scandal" match anything at all */
const stem = (w) => w.replace(/(ing|ed|es|s|ly)$/, '')
const contentOf = (text) =>
  new Set(
    (text.toLowerCase().match(/[a-z0-9']+/g) ?? [])
      .filter((w) => w.length > 2 && !STOP.has(w) && !WEAK.has(w))
      .map(stem)
  )

const NEGATION = /\b(not|never|no|none|nobody|nothing|without|rather than|instead of|n't)\b/g
const negationCount = (text) => (text.toLowerCase().match(NEGATION) ?? []).length
const numbersOf = (text) => new Set(text.match(/\b\d+\b/g) ?? [])

/**
 * Does this line say something the person actually said?
 * Returns the reasons it does not, so a failure is legible.
 */
function fidelity(line, source, clauses, sim) {
  const reasons = []
  const src = contentOf(source)
  const invented = [...contentOf(line)].filter((w) => !src.has(w))
  if (invented.length) reasons.push(`words nobody said: ${invented.join(', ')}`)

  const srcNums = numbersOf(source)
  const madeUp = [...numbersOf(line)].filter((n) => !srcNums.has(n))
  if (madeUp.length) reasons.push(`numbers nobody said: ${madeUp.join(', ')}`)

  // nearest clause, and whether the line agrees with it about negation
  let best = { clause: '', score: -1 }
  for (const c of clauses) {
    const score = sim(line, c)
    if (score > best.score) best = { clause: c, score }
  }
  if (best.score < 0.6) reasons.push(`not close to anything said (${best.score.toFixed(2)})`)
  else if (negationCount(line) !== negationCount(best.clause)) {
    reasons.push(`flips a negation: "${best.clause.slice(0, 60)}"`)
  }
  return { pass: reasons.length === 0, reasons, nearest: best }
}

/** the lines a model produced, one per bullet, stripped of numbering */
const linesOf = (text) =>
  text
    .split('\n')
    .map((l) => l.replace(/^\s*[-*\d.)\\]+\s*/, '').replace(/^["“]|["”]$/g, '').trim())
    .filter((l) => l.split(' ').length >= 4)

// ---- the baseline the candidates have to beat ------------------------------
// Extractive: cut the person's own sentences down and pick the three that
// carry the most of what they said. Every word is theirs, so it cannot invent
// anything — and it runs on the encoder the app already has installed and
// warm, so it costs nothing to download and nothing to load.
//
// This mirrors src/renderer/src/lib/condense.ts, which is the version that
// ships and the one with the tests. It is duplicated here rather than
// imported because this harness is plain node and that module is TypeScript.

const LEADING = /^(so|um|uh|and|but|then|well|honestly|i think|i mean|sort of|kind of|like|yeah|okay|right|anyway|actually|basically)[,\s]+/i
const TRAILING = /[,;\s]*(um|uh|you know|i think|i suppose|or whatever|and so on)[.,\s]*$/i
const WEAK = new Set(
  'just really quite very pretty much lots lot bit thing things stuff sort kind through around actually basically honestly obviously literally definitely probably maybe kinda gonna'.split(
    ' '
  )
)
const STOP = new Set(
  ('a an the and or but so then that this those these i you he she it we they me my your his her its our their of to in on at for with about from as is was were be been being am are do did does done have has had it\'s i\'ve i\'d im ive was were which who whom what when where why how just really quite very much some any all one thing things sort kind bit lot got get go going went said say says up out over back down there here not no yes if because'
    ).split(' ')
)

const contentWords = (s) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9' ]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w) && !WEAK.has(w))

function trim(clause) {
  let out = clause.trim()
  let prev
  do {
    prev = out
    out = out.replace(LEADING, '').replace(TRAILING, '')
  } while (out !== prev)
  return out.replace(/[.,;]\s*$/, '').trim()
}

function clauses(text) {
  const flat = text.replace(/\s+/g, ' ').trim()
  const out = []
  for (const sentence of flat.split(/(?<=[.?!])\s+/)) {
    // Speech has no full stops. Break where the speaker actually turned the
    // thought, then keep breaking anything still too long to say in a breath.
    let parts = [sentence]
    for (const splitter of [
      /,\s+(?=and |but |so |then |which |because |I )/,
      /\s+(?=and then |and I |but I |because |which )/,
      /,\s+/,
      /\s+(?=and |but |so |because |which |rather than |before )/
    ]) {
      parts = parts.flatMap((p) => (p.split(' ').length > 18 ? p.split(splitter) : [p]))
    }
    for (const part of parts) {
      const clause = trim(part)
      if (clause.split(' ').length >= 5 && contentWords(clause).length >= 3) {
        out.push(clause[0].toUpperCase() + clause.slice(1))
      }
    }
  }
  return out
}

const cosine = (a, b) => {
  let dot = 0
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i]
  return dot
}

async function extractive(embed, text, want = 3) {
  const parts = clauses(text)
  if (parts.length <= want) return parts
  const vectors = await embed(parts)
  const centroid = new Float32Array(vectors[0].length)
  for (const v of vectors) for (let i = 0; i < v.length; i++) centroid[i] += v[i] / vectors.length
  const norm = Math.sqrt(cosine(centroid, centroid))
  for (let i = 0; i < centroid.length; i++) centroid[i] /= norm

  // Centrality alone rewards the emptiest sentence in the answer ("I just
  // worked through it" sits near the middle of everything and says nothing),
  // so weight it by how much the clause actually carries.
  const scored = parts.map((p, i) => ({
    i,
    p,
    score: cosine(vectors[i], centroid) * Math.min(1, contentWords(p).length / 6)
  }))

  const picked = []
  while (picked.length < want) {
    let best = null
    for (const c of scored) {
      if (picked.some((x) => x.i === c.i)) continue
      // maximal marginal relevance: carry weight, minus what is already said
      const redundancy = picked.reduce((m, x) => Math.max(m, cosine(vectors[c.i], vectors[x.i])), 0)
      const score = c.score - 0.35 * redundancy
      if (!best || score > best.score) best = { ...c, score }
    }
    if (!best) break
    picked.push(best)
  }
  // keep the order they said it in — a story told backwards is not an answer
  return picked.sort((a, b) => a.i - b.i).map((x) => x.p)
}

const { pipeline, env } = await import('@huggingface/transformers')
env.localModelPath = MODELS_DIR
env.allowLocalModels = true
env.allowRemoteModels = false

console.log(`\nmodels from ${MODELS_DIR}`)
console.log('onnxruntime-node (native) — the app runs wasm, which is slower\n')

// The encoder the app already ships, used for two things here: the extractive
// baseline, and the gate's "is this line close to anything they actually
// said" check. One instance, memoized.
const extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', { dtype: 'q8' })
const vecs = new Map()
const embed = async (texts) => {
  const out = []
  for (const t of texts) {
    if (!vecs.has(t)) {
      const r = await extractor(t, { pooling: 'mean', normalize: true })
      vecs.set(t, Float32Array.from(r.data))
    }
    out.push(vecs.get(t))
  }
  return out
}
const sim = (a, b) => {
  const va = vecs.get(a)
  const vb = vecs.get(b)
  return va && vb ? cosine(va, vb) : -1
}

const SOURCE_CLAUSES = clauses(RAMBLE)
await embed(SOURCE_CLAUSES)

/** score a model's output against the gate, and say why each line failed */
async function gate(text) {
  const lines = linesOf(text)
  if (lines.length === 0) return { lines: [], passed: 0, rate: 0 }
  await embed(lines)
  const judged = lines.map((line) => ({ line, ...fidelity(line, RAMBLE, SOURCE_CLAUSES, sim) }))
  const passed = judged.filter((j) => j.pass).length
  return { lines: judged, passed, rate: passed / judged.length }
}

// the baseline first, so every candidate below is read against it
{
  const rssBefore = rssMb()
  const runs = []
  let lines = []
  for (let i = 0; i < 3; i++) {
    const s0 = performance.now()
    lines = await extractive(embed, RAMBLE)
    runs.push((performance.now() - s0) / 1000)
  }
  runs.sort((a, b) => a - b)
  console.log('── baseline: extractive, on the encoder already installed')
  console.log('   on disk        0MB extra   (already warm in the app)')
  console.log(`   [own words]    ${runs[1].toFixed(2)}s median · invents nothing by construction`)
  for (const l of lines) console.log(`     ${l}`)
  const g = await gate(lines.join('\n'))
  console.log(`   gate           ${g.passed}/${g.lines.length} lines pass`)
  for (const j of g.lines) if (!j.pass) console.log(`     ✗ ${j.reasons.join('; ')}`)
  console.log(`   rss            ${rssBefore.toFixed(0)}MB → ${rssMb().toFixed(0)}MB peak\n`)
}

for (const candidate of CANDIDATES) {
  const dir = join(MODELS_DIR, ...candidate.id.split('/'))
  let onDisk
  try {
    onDisk = dirBytes(dir)
  } catch {
    console.log(`${candidate.id}: not in ${MODELS_DIR} — skipped\n`)
    continue
  }

  const rssBefore = rssMb()
  const loadStart = performance.now()
  let generate
  try {
    generate = await pipeline(candidate.task, candidate.id, { dtype: candidate.dtype ?? 'q8' })
  } catch (err) {
    console.log(`${candidate.id}: failed to load — ${err.message}\n`)
    continue
  }
  const loadSec = (performance.now() - loadStart) / 1000
  const rssLoaded = rssMb()

  console.log(`── ${candidate.id}  (${candidate.dtype ?? 'q8'})`)
  console.log(`   on disk        ${mb(onDisk)}   load ${loadSec.toFixed(1)}s`)

  for (const prompt of PROMPTS[candidate.task]) {
    const runs = []
    for (let i = 0; i < 3; i++) {
      const t0 = performance.now()
      const out = await generate(prompt.text, {
        max_new_tokens: 96,
        do_sample: false,
        temperature: 1
      })
      const sec = (performance.now() - t0) / 1000
      const raw = Array.isArray(out) ? (out[0].generated_text ?? out[0].summary_text ?? '') : ''
      const text = typeof raw === 'string' ? raw : JSON.stringify(raw)
      // the causal model echoes the prompt back, with its special tokens
      // decoded away, so a plain startsWith does not catch it
      const marker = '\nassistant\n'
      const at = text.lastIndexOf(marker)
      const newText = text.startsWith(prompt.text)
        ? text.slice(prompt.text.length)
        : at >= 0
          ? text.slice(at + marker.length)
          : text
      const tokens = Math.max(1, Math.round(newText.split(/\s+/).filter(Boolean).length * 1.3))
      runs.push({ sec, tokens, newText })
    }
    const best = runs.reduce((a, b) => (a.sec < b.sec ? a : b))
    const median = [...runs].sort((a, b) => a.sec - b.sec)[1]
    console.log(
      `   [${prompt.name}] ${median.sec.toFixed(1)}s median (${best.sec.toFixed(1)}s best) · ~${(median.tokens / median.sec).toFixed(1)} tok/s · ${median.tokens} tokens out`
    )
    const said = median.newText.trim()
    console.log(
      said === ''
        ? '     (nothing)'
        : said.split('\n').map((l) => `     ${l}`).join('\n')
    )
    const g = await gate(said)
    console.log(
      `   gate           ${g.passed}/${g.lines.length} lines pass${g.lines.length ? ` (${(g.rate * 100).toFixed(0)}%, bar 90%)` : ''}`
    )
    for (const j of g.lines) {
      if (!j.pass) console.log(`     ✗ "${j.line.slice(0, 54)}" — ${j.reasons.join('; ')}`)
    }
  }
  const rssPeak = rssMb()
  console.log(
    `   rss            ${rssBefore.toFixed(0)}MB → ${rssLoaded.toFixed(0)}MB loaded → ${rssPeak.toFixed(0)}MB peak\n`
  )
}
