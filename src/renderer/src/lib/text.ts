// Text utilities shared by the matcher and the coverage model. Pure functions.

/** lowercase, strip punctuation/diacritics, collapse whitespace */
export function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[’‘]/g, "'")
    .replace(/[^a-z0-9'\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function tokens(s: string): string[] {
  const n = normalize(s)
  return n ? n.split(' ') : []
}

/** character-bigram multiset of a normalized string (spaces collapsed out) */
function charBigrams(s: string): Map<string, number> {
  const grams = new Map<string, number>()
  const t = normalize(s).replace(/ /g, '')
  for (let i = 0; i < t.length - 1; i++) {
    const g = t.slice(i, i + 2)
    grams.set(g, (grams.get(g) ?? 0) + 1)
  }
  return grams
}

/** word-bigram set */
function wordBigrams(s: string): Set<string> {
  const ts = tokens(s)
  const out = new Set<string>()
  for (let i = 0; i < ts.length - 1; i++) out.add(`${ts[i]} ${ts[i + 1]}`)
  return out
}

/** Dice coefficient over word bigrams, falling back to char bigrams for very
 *  short strings. 0..1. This is the model-cold fallback scorer. */
export function diceCoefficient(a: string, b: string): number {
  const wa = wordBigrams(a)
  const wb = wordBigrams(b)
  if (wa.size >= 2 && wb.size >= 2) {
    let inter = 0
    for (const g of wa) if (wb.has(g)) inter++
    return (2 * inter) / (wa.size + wb.size)
  }
  const ca = charBigrams(a)
  const cb = charBigrams(b)
  if (ca.size === 0 || cb.size === 0) return 0
  let inter = 0
  let total = 0
  for (const [g, n] of ca) {
    total += n
    const m = cb.get(g)
    if (m) inter += Math.min(n, m)
  }
  for (const [, n] of cb) total += n
  return (2 * inter) / total
}

/** token-overlap recall of `needle` inside `haystack` (how much of the needle
 *  is present), used by lexical coverage */
export function tokenRecall(needle: string, haystack: string): number {
  const nt = tokens(needle).filter((t) => !STOPWORDS.has(t))
  if (nt.length === 0) return 0
  const ht = new Set(tokens(haystack))
  let hit = 0
  for (const t of nt) if (ht.has(t)) hit++
  return hit / nt.length
}

const STOPWORDS = new Set(
  'a an the i you we they he she it of to in on at for with and or but not no as is are was were be been am do does did have has had my your our their this that these those so than then there here what when where which who whom how why me him her us them its'.split(
    ' '
  )
)

/** Levenshtein distance, banded early-exit not needed at our sizes */
export function editDistance(a: string, b: string): number {
  const m = a.length
  const n = b.length
  if (m === 0) return n
  if (n === 0) return m
  let prev = new Array<number>(n + 1)
  let cur = new Array<number>(n + 1)
  for (let j = 0; j <= n; j++) prev[j] = j
  for (let i = 1; i <= m; i++) {
    cur[0] = i
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost)
    }
    ;[prev, cur] = [cur, prev]
  }
  return prev[n]
}

/** 1 − normalized edit distance, on normalized strings */
export function fuzzySimilarity(a: string, b: string): number {
  const na = normalize(a)
  const nb = normalize(b)
  if (!na || !nb) return 0
  const d = editDistance(na, nb)
  return 1 - d / Math.max(na.length, nb.length)
}

/** does `phrase` appear in `utterance`, allowing fuzzy word-window matching?
 *  Slides a window of the phrase's word length across the utterance and takes
 *  the best fuzzy similarity — comparing both the raw window and the
 *  sorted-token forms, so re-ordered speech ("burning their team out" vs the
 *  trigger "burning out their team") still hits. */
export function fuzzyPhraseHit(phrase: string, utterance: string, threshold: number): boolean {
  const pt = tokens(phrase)
  const ut = tokens(utterance)
  if (pt.length === 0 || ut.length === 0) return false
  const np = pt.join(' ')
  const npSorted = [...pt].sort().join(' ')
  const windowHits = (win: string[]): boolean =>
    fuzzySimilarity(np, win.join(' ')) >= threshold ||
    fuzzySimilarity(npSorted, [...win].sort().join(' ')) >= threshold
  if (ut.length <= pt.length) return windowHits(ut)
  for (let i = 0; i + pt.length <= ut.length; i++) {
    if (windowHits(ut.slice(i, i + pt.length))) return true
  }
  return false
}

export function cosineSimilarity(a: Float32Array | number[], b: Float32Array | number[]): number {
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  if (na === 0 || nb === 0) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}
