import { contentTokens } from './text'
import type { EmbeddingCache } from './embeddings'

/**
 * Turn a rambling spoken answer into a few lines you could actually say.
 *
 * This is the prep-time "help me write this", and it is deliberately
 * extractive: every word it returns is a word the user said. A generative
 * model was measured against this job first (`tools/spike/llm-spike.mjs`) and
 * every candidate small enough to install invented details about the user's
 * own experience — a fabricated fact in prep material is worse than no prep
 * material, because you say it in the room and cannot take it back.
 *
 * It runs on the encoder the app already has warm, so it costs nothing to
 * download and nothing to load, and it falls back to content density when
 * embeddings are cold rather than refusing to answer.
 *
 * Input is always the user's own speech or their own typing. Interviewer
 * lines never reach here — the recap filters to `speaker === 'you'` before
 * the excerpt is handed to the editor, and `tests/condense.test.ts` fails if
 * that ever stops being true.
 */

/** speech has no full stops; these are where a speaker actually turns the
 *  thought, in the order worth splitting on */
const SPLITTERS = [
  /,\s+(?=and |but |so |then |which |because |I )/,
  /\s+(?=and then |and I |but I |because |which )/,
  /,\s+/,
  // last resort for a sentence that never took a breath: any conjunction
  /\s+(?=and |but |so |because |which |rather than |before )/
]

const LEADING =
  /^(so|um|uh|and|but|then|well|honestly|i think|i mean|sort of|kind of|like|yeah|okay|right|anyway|actually|basically)[,\s]+/i
const TRAILING = /[,;\s]*(um|uh|you know|i think|i suppose|or whatever|and so on)[.,\s]*$/i

/** a clause you could say in one breath: ~18 words. The seed bank's points
 *  average nine, and a point you cannot finish is not a point. */
const MAX_WORDS = 18
const MIN_WORDS = 5
const MIN_CONTENT = 3

/** words that pass the app's stopword filter but carry nothing in speech.
 *  Without these, "I just worked through it" reads as three content words and
 *  wins a place on the card by sitting near the middle of everything. */
const WEAK = new Set(
  'just really quite very pretty much lots lot bit thing things stuff sort kind through around actually basically honestly obviously literally definitely probably maybe kinda gonna'.split(
    ' '
  )
)

const carried = (s: string): string[] => contentTokens(s).filter((t) => !WEAK.has(t))

function trim(clause: string): string {
  let out = clause.trim()
  let prev: string
  do {
    prev = out
    out = out.replace(LEADING, '').replace(TRAILING, '')
  } while (out !== prev)
  // points do not end in punctuation anywhere else in the bank
  return out.replace(/[.,;]\s*$/, '').trim()
}

/** the sayable clauses inside a spoken answer, in the order they were said */
export function clauses(text: string): string[] {
  const flat = text.replace(/\s+/g, ' ').trim()
  const out: string[] = []
  for (const sentence of flat.split(/(?<=[.?!])\s+/)) {
    let parts = [sentence]
    for (const splitter of SPLITTERS) {
      parts = parts.flatMap((p) => (p.split(' ').length > MAX_WORDS ? p.split(splitter) : [p]))
    }
    for (const part of parts) {
      const clause = trim(part)
      if (clause.split(' ').length < MIN_WORDS) continue
      if (carried(clause).length < MIN_CONTENT) continue
      out.push(clause[0].toUpperCase() + clause.slice(1))
    }
  }
  return out
}

function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i]
  return dot
}

/**
 * Pick the `want` clauses that carry the most of what was said.
 *
 * Centrality alone rewards the emptiest sentence in the answer — "I just
 * worked through it" sits near the middle of everything and says nothing — so
 * it is weighted by how much each clause actually carries, and each pick is
 * discounted by how much the ones already chosen have said.
 */
export async function condense(
  text: string,
  embeddings: EmbeddingCache | null,
  want = 3
): Promise<string[]> {
  const parts = clauses(text)
  if (parts.length <= want) return parts

  const density = (p: string): number => Math.min(1, carried(p).length / 6)

  if (embeddings) await embeddings.ensure(parts)
  const vectors = embeddings
    ? parts.map((p) => embeddings.get(p))
    : parts.map(() => null)
  const warm = vectors.every((v) => v != null)

  if (!warm) {
    // cold encoder: rank on content density alone rather than refusing. It is
    // a worse ordering, not a wrong one, and the clauses are still theirs.
    return parts
      .map((p, i) => ({ p, i, score: carried(p).length }))
      .sort((a, b) => b.score - a.score)
      .slice(0, want)
      .sort((a, b) => a.i - b.i)
      .map((x) => x.p)
  }

  const vecs = vectors as Float32Array[]
  const centroid = new Float32Array(vecs[0].length)
  for (const v of vecs) for (let i = 0; i < v.length; i++) centroid[i] += v[i] / vecs.length
  const norm = Math.sqrt(cosine(centroid, centroid)) || 1
  for (let i = 0; i < centroid.length; i++) centroid[i] /= norm

  const scored = parts.map((p, i) => ({ i, p, score: cosine(vecs[i], centroid) * density(p) }))
  const picked: { i: number; p: string }[] = []
  while (picked.length < want && picked.length < scored.length) {
    let best: { i: number; p: string; score: number } | null = null
    for (const c of scored) {
      if (picked.some((x) => x.i === c.i)) continue
      const redundancy = picked.reduce((m, x) => Math.max(m, cosine(vecs[c.i], vecs[x.i])), 0)
      const score = c.score - 0.35 * redundancy
      if (!best || score > best.score) best = { ...c, score }
    }
    if (!best) break
    picked.push({ i: best.i, p: best.p })
  }
  // keep the order they said it in — a story told backwards is not an answer
  return picked.sort((a, b) => a.i - b.i).map((x) => x.p)
}
