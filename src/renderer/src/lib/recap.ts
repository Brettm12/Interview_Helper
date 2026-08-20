import type { Bank, SessionRecord, TranscriptLine } from '@shared/types'
import { TUNING } from '@shared/tuning'
import { storyById } from '../state/bankStore'

// Pure derivation of everything the recap screen shows from a SessionRecord
// + the bank. Kept free of store/UI imports so it is directly testable.

export interface RecapRowData {
  id: string
  time: string
  question: string
  matched: boolean
  entryId: string | null
  subLine: string
  transcriptOff: boolean
  coveredPct: number | null
  counter: string | null
  transcript: TranscriptLine[] | null
}

export type FixKind = 'draft' | 'uncovered' | 'long' | 'override'

export interface RecapFixData {
  id: string
  kind: FixKind
  title: string
  why: string
  chip: string
  entryId: string | null
  /** for 'draft': the question + excerpt to prefill the editor with */
  question?: string
  excerpt?: string
}

export interface RecapData {
  eyebrow: string
  sub: string
  stats: { covered: number; totalPoints: number; matched: number; unmatched: number }
  rows: RecapRowData[]
  fixes: RecapFixData[]
  practiceEntryIds: string[]
}

export function formatClock(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function formatRan(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = Math.round(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s
  const cut = s.slice(0, max)
  const atWord = cut.slice(0, cut.lastIndexOf(' '))
  return `${atWord || cut}…`
}

export function deriveRecap(record: SessionRecord, bank: Bank): RecapData {
  const questions = [...record.questions].sort((a, b) => a.askedAtSec - b.askedAtSec)
  const matchedQs = questions.filter((q) => q.entryId != null)
  const unmatchedQs = questions.filter((q) => q.entryId == null)

  const covered = matchedQs.reduce((n, q) => n + q.coveredPointIds.length, 0)
  const totalPoints = matchedQs.reduce((n, q) => n + q.totalPoints, 0)

  const rows: RecapRowData[] = questions.map((q) => {
    const entry = q.entryId ? (bank.answers.find((a) => a.id === q.entryId) ?? null) : null
    const missed = entry ? entry.points.filter((p) => !q.coveredPointIds.includes(p.id)) : []
    let subLine: string
    if (!entry) {
      subLine = 'Not in your bank'
    } else if (missed.length === 0) {
      subLine = `All ${entry.points.length} point${entry.points.length === 1 ? '' : 's'} covered`
    } else {
      subLine = `Missed: ${missed.map((p) => truncate(p.text, 42).toLowerCase()).join(' · ')}`
    }
    const transcript = q.transcript ?? null
    const transcriptOff = !record.transcriptKept
    if (transcriptOff && entry) subLine += ' · transcript off'
    return {
      id: q.id,
      time: formatClock(q.askedAtSec),
      question: q.question,
      matched: entry != null,
      entryId: q.entryId,
      subLine,
      transcriptOff,
      coveredPct: entry ? Math.round((q.coveredPointIds.length / Math.max(1, q.totalPoints)) * 100) : null,
      counter: entry ? `${q.coveredPointIds.length}/${q.totalPoints}` : null,
      transcript
    }
  })

  // ---- worth fixing (generated from the session, capped at 4) ----
  const fixes: RecapFixData[] = []
  let fixSeq = 0
  const push = (f: Omit<RecapFixData, 'id'>) => {
    if (fixes.length < 4) fixes.push({ ...f, id: `fix-${fixSeq++}` })
  }

  for (const q of unmatchedQs.slice(0, 1)) {
    push({
      kind: 'draft',
      title: 'Draft an answer from what I said',
      why: `“${truncate(q.question, 58)}” isn't in your bank yet`,
      chip: 'Draft it',
      entryId: null,
      question: q.question,
      excerpt: q.transcript
        ?.filter((l) => l.speaker === 'you')
        .map((l) => l.text)
        .join(' ')
    })
  }

  const firstMissed = matchedQs
    .map((q) => {
      const entry = bank.answers.find((a) => a.id === q.entryId)
      const missed = entry?.points.find((p) => !q.coveredPointIds.includes(p.id))
      return missed && entry ? { entry, missed } : null
    })
    .find(Boolean)
  if (firstMissed) {
    push({
      kind: 'uncovered',
      title: `You never said “${truncate(firstMissed.missed.text, 40).toLowerCase()}”`,
      why: "It's on the card but it didn't make it out loud",
      chip: 'Open answer',
      entryId: firstMissed.entry.id
    })
  }

  const longQ = matchedQs.find((q) => q.micSeconds > TUNING.longAnswerSec)
  if (longQ) {
    const entry = bank.answers.find((a) => a.id === longQ.entryId)
    const story = entry ? storyById(bank, entry.storyId) : null
    push({
      kind: 'long',
      title: `${story?.title ?? truncate(longQ.question, 36)} ran ${formatRan(longQ.micSeconds)}`,
      why: 'Trim it to the two metrics that landed',
      chip: 'Edit story',
      entryId: entry?.id ?? null
    })
  }

  const overridden = questions.find((q) => q.pinnedViaFind && q.entryId)
  if (overridden) {
    push({
      kind: 'override',
      title: 'You pulled this one up by hand',
      why: 'Add the phrase they actually used as a trigger',
      chip: 'Add trigger',
      entryId: overridden.entryId
    })
  }

  // remaining unmatched questions fill any leftover card slots
  for (const q of unmatchedQs.slice(1)) {
    push({
      kind: 'draft',
      title: 'Draft an answer from what I said',
      why: `“${truncate(q.question, 58)}” isn't in your bank yet`,
      chip: 'Draft it',
      entryId: null,
      question: q.question,
      excerpt: q.transcript
        ?.filter((l) => l.speaker === 'you')
        .map((l) => l.text)
        .join(' ')
    })
  }

  const practiceEntryIds = [
    ...new Set(
      matchedQs
        .filter((q) => q.coveredPointIds.length < q.totalPoints)
        .map((q) => q.entryId as string)
    )
  ]

  const minutes = Math.max(1, Math.round((record.endedAt - record.startedAt) / 60000))
  return {
    eyebrow: `SESSION ENDED · ${minutes} MINUTE${minutes === 1 ? '' : 'S'}`,
    sub: `${questions.length} question${questions.length === 1 ? '' : 's'} heard · ${matchedQs.length} matched to your bank`,
    stats: { covered, totalPoints, matched: matchedQs.length, unmatched: unmatchedQs.length },
    rows,
    fixes,
    practiceEntryIds
  }
}

/** plain-markdown session notes: question, points covered and missed, the
 *  story used, and the transcript excerpt if it was kept */
export function exportNotes(record: SessionRecord, bank: Bank): string {
  const loop = bank.loops.find((l) => l.id === record.loopId)
  const lines: string[] = [`# ${loop?.name ?? 'Interview session'} — session notes`, '']
  const data = deriveRecap(record, bank)
  lines.push(
    `${data.stats.matched + data.stats.unmatched} questions heard · ${data.stats.matched} matched · ${data.stats.covered}/${data.stats.totalPoints} points covered`,
    ''
  )
  for (const q of [...record.questions].sort((a, b) => a.askedAtSec - b.askedAtSec)) {
    lines.push(`## ${formatClock(q.askedAtSec)} — ${q.question}`, '')
    const entry = q.entryId ? bank.answers.find((a) => a.id === q.entryId) : null
    if (!entry) {
      lines.push('_Not in the bank._', '')
    } else {
      for (const p of entry.points) {
        lines.push(`- [${q.coveredPointIds.includes(p.id) ? 'x' : ' '}] ${p.text}`)
      }
      const story = storyById(bank, entry.storyId)
      if (story) lines.push('', `**Story used:** ${story.title}`)
      lines.push('')
    }
    if (q.transcript && q.transcript.length > 0) {
      lines.push('```')
      for (const t of q.transcript) lines.push(`${t.speaker}: ${t.text}`)
      lines.push('```', '')
    }
  }
  lines.push('---', '_Transcript is on this machine only. Deleting the session removes it._')
  return lines.join('\n')
}
