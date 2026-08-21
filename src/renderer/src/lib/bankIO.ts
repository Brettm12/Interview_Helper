import type { Answer, Bank, Point } from '@shared/types'
import { diceCoefficient, normalize } from './text'

// Getting prepared material in and out.
//
// A bank is 15–23 entries of question + 3–5 points + trigger phrases, and
// until now the only way to build one was to type it into the editor. Anyone
// with existing prep notes had to retype them. There was no export at all
// either: your prepared material lived in a single bank.json whose only backup
// was written on a successful *read*.
//
// Everything here is pure, because an importer that mangles someone's prep the
// night before an interview is worse than no importer.

export interface ParsedEntry {
  question: string
  points: string[]
  triggerPhrases: string[]
  storyTitle: string | null
  /** an existing entry this looks like a re-import of */
  duplicateOf: string | null
}

export interface ImportPreview {
  format: 'json' | 'notes'
  entries: ParsedEntry[]
  /** entries carrying no points — importable, but they will not strike through */
  pointless: number
  duplicates: number
  /** why nothing could be read, when entries is empty */
  problem: string | null
}

/** a question and its bullets are close enough to an existing entry that
 *  importing it would leave you with two cards for one question */
const DUPLICATE_AT = 0.72

// ---- parsing ---------------------------------------------------------------

const HEADING = /^#{1,6}\s+(.*)$/
const BULLET = /^\s*(?:[-*•‣·]|\d+[.)])\s+(.*)$/
/** "triggers: a, b" / "> Triggers — a; b" / "story: The investigation" */
const FIELD = /^\s*>?\s*(triggers?|trigger phrases?|story|stories)\s*[:—-]\s*(.*)$/i

function splitList(value: string): string[] {
  return value
    .split(/[,;|]/)
    .map((v) => v.trim().replace(/^["“”']|["“”']$/g, ''))
    .filter(Boolean)
}

function looksLikeQuestion(line: string): boolean {
  const t = line.trim()
  if (!t) return false
  if (t.endsWith('?')) return true
  return /^(tell me|walk me|talk me through|describe|give me|how|what|why|when|where|which)\b/i.test(t)
}

/**
 * Prep notes, as people actually write them.
 *
 * A heading, or a line that reads like a question, opens an entry; the bullets
 * under it are its points. Deliberately forgiving: real notes mix `#` headings
 * with bare questions, use four different bullet characters, and put trigger
 * phrases wherever they feel like.
 */
function parseNotes(text: string): ParsedEntry[] {
  const entries: ParsedEntry[] = []
  const current = (): ParsedEntry | undefined => entries[entries.length - 1]
  const open = (question: string): void => {
    entries.push({
      question: question.trim(),
      points: [],
      triggerPhrases: [],
      storyTitle: null,
      duplicateOf: null
    })
  }

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimEnd()
    if (!line.trim()) continue

    const field = FIELD.exec(line)
    const entry = current()
    if (field && entry) {
      if (/^stor/i.test(field[1])) entry.storyTitle = field[2].trim() || null
      else entry.triggerPhrases.push(...splitList(field[2]))
      continue
    }

    const heading = HEADING.exec(line)
    if (heading) {
      if (heading[1].trim()) open(heading[1])
      continue
    }

    const bullet = BULLET.exec(line)
    if (bullet) {
      // a bullet before any question is a stray note, not a point
      if (entry) entry.points.push(bullet[1].trim())
      continue
    }

    // a bare line that reads like a question opens an entry; anything else is
    // prose we have no home for, and inventing one would be worse than
    // dropping it
    if (looksLikeQuestion(line)) open(line)
  }
  // Headings are ambiguous: notes are full of structural ones ("# Northwind
  // prep", "## Behavioural") sitting above the real questions, and the
  // markdown this module exports uses exactly that shape. A heading earns an
  // entry only if it reads like a question or actually carries content.
  return entries.filter(
    (e) =>
      e.question.length > 0 &&
      (e.points.length > 0 || e.triggerPhrases.length > 0 || looksLikeQuestion(e.question))
  )
}

function parseJson(text: string): { entries: ParsedEntry[]; problem: string | null } {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return { entries: [], problem: 'That looks like JSON but it could not be parsed.' }
  }
  const answers = (data as Partial<Bank>)?.answers
  if (!Array.isArray(answers)) {
    return { entries: [], problem: 'That JSON has no `answers` array — is it a bank export?' }
  }
  const stories = (data as Partial<Bank>)?.stories ?? []
  const entries = answers
    .filter((a): a is Answer => typeof a?.question === 'string' && a.question.trim().length > 0)
    .map((a) => ({
      question: a.question.trim(),
      points: (a.points ?? []).map((p: Point) => p.text).filter(Boolean),
      triggerPhrases: a.triggerPhrases ?? [],
      storyTitle: stories.find((s) => s.id === a.storyId)?.title ?? null,
      duplicateOf: null
    }))
  return {
    entries,
    problem: entries.length === 0 ? 'That bank export contains no answers.' : null
  }
}

/** Auto-detects a bank export from prep notes and reads whichever it is. */
export function parseBankText(text: string, existing: Answer[] = []): ImportPreview {
  const trimmed = text.trim()
  if (!trimmed) {
    return { format: 'notes', entries: [], pointless: 0, duplicates: 0, problem: 'Nothing to import.' }
  }

  const isJson = trimmed.startsWith('{') || trimmed.startsWith('[')
  const { entries, problem } = isJson
    ? parseJson(trimmed)
    : { entries: parseNotes(trimmed), problem: null }

  for (const entry of entries) {
    entry.duplicateOf = findDuplicate(entry.question, existing)
  }
  return {
    format: isJson ? 'json' : 'notes',
    entries,
    pointless: entries.filter((e) => e.points.length === 0).length,
    duplicates: entries.filter((e) => e.duplicateOf != null).length,
    problem:
      problem ??
      (entries.length === 0
        ? 'No questions found. Put each question on its own line (or as a heading) with its points as bullets underneath.'
        : null)
  }
}

/** the id of an existing entry asking substantially the same thing */
export function findDuplicate(question: string, existing: Answer[]): string | null {
  const q = normalize(question)
  if (!q) return null
  for (const answer of existing) {
    if (normalize(answer.question) === q) return answer.id
    if (diceCoefficient(question, answer.question) >= DUPLICATE_AT) return answer.id
  }
  return null
}

// ---- serialising -----------------------------------------------------------

export type ExportFormat = 'md' | 'json'

/**
 * @param loopId when given, only that loop's answers are exported
 */
export function serializeBank(bank: Bank, format: ExportFormat, loopId?: string): string {
  const answers = loopId ? bank.answers.filter((a) => a.loopIds.includes(loopId)) : bank.answers
  if (format === 'json') {
    // lossless, and re-importable: ids, sections and stories all survive
    const storyIds = new Set(answers.map((a) => a.storyId).filter(Boolean))
    return `${JSON.stringify(
      {
        ...bank,
        answers,
        stories: bank.stories.filter((s) => storyIds.has(s.id))
      },
      null,
      2
    )}\n`
  }

  const lines: string[] = []
  const loop = loopId ? bank.loops.find((l) => l.id === loopId) : null
  lines.push(`# ${loop?.name ?? 'Question bank'}`, '')
  for (const section of bank.sections) {
    const inSection = answers.filter((a) => a.sectionId === section.id)
    if (inSection.length === 0) continue
    lines.push(`## ${section.name}`, '')
    for (const answer of inSection) {
      lines.push(`### ${answer.question}`, '')
      for (const point of answer.points) lines.push(`- ${point.text}`)
      if (answer.triggerPhrases.length > 0) lines.push(`> triggers: ${answer.triggerPhrases.join(', ')}`)
      const story = bank.stories.find((s) => s.id === answer.storyId)
      if (story) lines.push(`> story: ${story.title}`)
      lines.push('')
    }
  }
  return `${lines.join('\n').trimEnd()}\n`
}

// ---- merging ---------------------------------------------------------------

let importSeq = 0

/** Build the new Answer records for the entries the user chose to keep. Pure:
 *  the caller decides what to do with them. */
export function entriesToAnswers(
  entries: ParsedEntry[],
  opts: { loopId: string; sectionId: string; stories: Bank['stories'] }
): Answer[] {
  return entries.map((entry) => ({
    id: `a-import-${Date.now().toString(36)}-${importSeq++}`,
    question: entry.question,
    sectionId: opts.sectionId,
    loopIds: [opts.loopId],
    points: entry.points.map((text, i) => ({ id: `p-import-${importSeq}-${i}`, text })),
    // a story is matched by title when the notes name one we already have;
    // inventing a story from a title would put an empty card in the library
    storyId: entry.storyTitle
      ? (opts.stories.find((s) => normalize(s.title) === normalize(entry.storyTitle as string))?.id ?? null)
      : null,
    triggerPhrases: entry.triggerPhrases,
    lastUsed: null
  }))
}
