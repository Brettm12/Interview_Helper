import type { Answer, Segment, SessionQuestion, SessionRecord, Transcriber } from '@shared/types'
import { TUNING } from '@shared/tuning'
import { HybridMatcher } from './matcher'
import { EmbeddingCoverage } from './coverage'
import type { EmbeddingCache } from './embeddings'
import { useSessionStore } from '../state/sessionStore'
import { useBankStore, answersForLoop } from '../state/bankStore'
import { usePanelStore } from '../state/panelStore'
import { api } from './api'

// The session engine wires transcriber segments → matcher → panel state, and
// mic segments → coverage. It is the only writer to the session store while a
// session runs. UI containers read stores; they never talk to the engine
// directly except via the small command surface at the bottom.

function isQuestionLike(text: string): boolean {
  if (/\?\s*$/.test(text)) return true
  return /\b(tell me|walk me|talk me through|how do|how would|what's|what is|what would|why|describe|give me an example)\b/i.test(
    text
  )
}

export class SessionEngine {
  private matcher: HybridMatcher
  private coverage: EmbeddingCoverage
  /** rolling window of interviewer speech since the last turn boundary */
  private window: Segment[] = []
  private lastSwapAt = 0
  private autoPickTimer: ReturnType<typeof setTimeout> | null = null
  private questionSeq = 0
  private youSegments: Segment[] = []
  private stopped = false

  constructor(
    themTranscriber: Transcriber,
    youTranscriber: Transcriber,
    private embeddings: EmbeddingCache | null = null,
    private now: () => number = Date.now
  ) {
    this.matcher = new HybridMatcher(embeddings ?? null)
    this.coverage = new EmbeddingCoverage(embeddings ?? null)
    themTranscriber.onSegment((s) => this.onThem(s))
    youTranscriber.onSegment((s) => this.onYou(s))
  }

  private get session() {
    return useSessionStore.getState()
  }

  private entries(): Answer[] {
    const bankState = useBankStore.getState()
    const loopId = this.session.loopId
    if (!bankState.bank || !loopId) return []
    return answersForLoop(bankState.bank, loopId)
  }

  // ---- interviewer stream ----

  private onThem(seg: Segment): void {
    if (this.stopped) return
    const s = this.session
    if (s.status !== 'listening' && s.status !== 'armed') return
    s.setClock(Math.max(s.clockSec, seg.t))
    s.appendTranscript({ speaker: 'them', text: seg.text, confirmed: seg.confirmed, t: seg.t })
    if (!seg.confirmed) return
    if (s.status === 'armed') s.setStatus('listening')

    this.window.push(seg)
    this.pruneWindow(seg.t)
    const questionLike = isQuestionLike(seg.text)

    // ⌘K pin suppresses auto-matching until the next detected question
    if (s.match.state === 'pinned') {
      if (!questionLike) return
      s.setMatch({ state: 'confident' }) // unpin; fall through to rescoring
    }

    const entries = this.entries()
    if (entries.length === 0) return
    const utterance = this.window.map((w) => w.text).join(' ')
    // warm the embedding cache in the background; scoring stays synchronous
    void this.embeddings?.ensure([utterance, ...entries.map((e) => e.question)])
    const candidates = this.matcher.score(utterance, entries)
    const state = this.matcher.classify(candidates)

    if (state === 'confident') {
      const top = candidates[0]
      if (top.entryId !== s.match.entryId) {
        const wallNow = this.now()
        if (wallNow - this.lastSwapAt >= TUNING.swapDebounceMs) {
          this.lastSwapAt = wallNow
          this.activateEntry(top.entryId, {
            askedAt: seg.t,
            heard: seg.text,
            viaFind: false,
            candidates
          })
        }
      } else {
        s.setMatch({ candidates, state: 'confident' })
        this.clearAutoPick()
      }
    } else if (state === 'ambiguous' && questionLike) {
      const shortlist = this.matcher.shortlist(candidates)
      const wallNow = this.now()
      s.setMatch({
        state: 'ambiguous',
        candidates: shortlist,
        heard: seg.text,
        autoPickAt: s.match.state === 'ambiguous' && s.match.autoPickAt ? s.match.autoPickAt : wallNow + TUNING.autoPickSec * 1000
      })
      this.armAutoPick()
    } else if (state === 'none' && questionLike) {
      // heard a question that hit nothing in the bank — log it for the recap
      this.recordQuestion(null, seg.t, seg.text, false)
      this.window = [seg] // start a fresh window at this question
    }
  }

  private pruneWindow(nowSec: number): void {
    this.window = this.window.filter((w) => nowSec - w.t <= TUNING.windowSec || w.t === nowSec)
  }

  // ---- own mic stream ----

  private onYou(seg: Segment): void {
    if (this.stopped) return
    const s = this.session
    if (s.status !== 'listening' && s.status !== 'armed') return
    s.setClock(Math.max(s.clockSec, seg.t))
    s.appendTranscript({ speaker: 'you', text: seg.text, confirmed: seg.confirmed, t: seg.t })
    if (!seg.confirmed) return
    this.youSegments.push(seg)
    this.window = [] // speaking is a turn boundary for the interviewer window

    const entryId = s.match.entryId
    if (!entryId || (s.match.state !== 'confident' && s.match.state !== 'pinned')) return
    const entry = this.entries().find((e) => e.id === entryId)
    if (!entry) return
    const coveredAlready = new Set(s.coverage[entryId] ?? [])
    const uncovered = entry.points.filter((p) => !coveredAlready.has(p.id))
    if (uncovered.length === 0) return
    void this.embeddings?.ensure([seg.text, ...uncovered.map((p) => p.text)])
    const newlyCovered = this.coverage.score(seg.text, uncovered)
    if (newlyCovered.length > 0) {
      s.coverPoints(entryId, newlyCovered)
      this.syncActiveQuestion()
    }
  }

  // ---- activation / unsure resolution ----

  private activateEntry(
    entryId: string,
    opts: { askedAt: number; heard: string | null; viaFind: boolean; candidates?: { entryId: string; score: number }[] }
  ): void {
    const s = this.session
    this.clearAutoPick()
    // highlight the matched phrase on the transcript entry that triggered it
    if (opts.heard) {
      const entry = this.entries().find((e) => e.id === entryId)
      const phrase = entry?.triggerPhrases.find((p) =>
        opts.heard!.toLowerCase().includes(p.toLowerCase())
      )
      const buf = s.transcript
      const idx = [...buf].reverse().findIndex((e) => e.text === opts.heard && e.speaker === 'them')
      if (idx >= 0) {
        const realIdx = buf.length - 1 - idx
        const updated = [...buf]
        updated[realIdx] = { ...updated[realIdx], highlight: phrase ?? undefined }
        useSessionStore.setState({ transcript: updated })
      }
    }
    s.setMatch({
      state: opts.viaFind ? 'pinned' : 'confident',
      entryId,
      candidates: opts.candidates ?? [],
      autoPickAt: null,
      heard: null
    })
    this.recordQuestion(entryId, opts.askedAt, opts.heard, opts.viaFind)
  }

  private recordQuestion(entryId: string | null, askedAt: number, heard: string | null, viaFind: boolean): void {
    const s = this.session
    const entry = entryId ? this.entries().find((e) => e.id === entryId) : null
    // an activation arriving just after an unmatched question resolves that
    // question (e.g. ⌘K pin for the thing they just asked) — merge, don't
    // record a second row
    const last = [...s.questions].sort((a, b) => a.askedAtSec - b.askedAtSec).at(-1)
    if (entry && last && last.entryId == null && askedAt - last.askedAtSec <= 45) {
      s.upsertQuestion({
        ...last,
        entryId: entry.id,
        totalPoints: entry.points.length,
        coveredPointIds: s.coverage[entry.id] ?? [],
        pinnedViaFind: viaFind
      })
      s.pushHistory({
        entryId: entry.id,
        askedAt: last.askedAtSec,
        coveredCount: (s.coverage[entry.id] ?? []).length,
        totalPoints: entry.points.length
      })
      return
    }
    const q: SessionQuestion = {
      id: `q-${this.questionSeq++}`,
      askedAtSec: askedAt,
      question: heard ?? entry?.question ?? '',
      entryId,
      coveredPointIds: entryId ? (s.coverage[entryId] ?? []) : [],
      totalPoints: entry?.points.length ?? 0,
      missedLabels: [],
      micSeconds: 0,
      pinnedViaFind: viaFind
    }
    s.upsertQuestion(q)
    if (entry) {
      s.pushHistory({
        entryId: entry.id,
        askedAt,
        coveredCount: (s.coverage[entry.id] ?? []).length,
        totalPoints: entry.points.length
      })
    }
  }

  /** keep the active question's covered list + history in sync mid-answer */
  private syncActiveQuestion(): void {
    const s = this.session
    const entryId = s.match.entryId
    if (!entryId) return
    const covered = s.coverage[entryId] ?? []
    const q = [...s.questions].reverse().find((x) => x.entryId === entryId)
    if (q) s.upsertQuestion({ ...q, coveredPointIds: covered })
    const history = useSessionStore.getState().history.map((h) =>
      h.entryId === entryId ? { ...h, coveredCount: covered.length } : h
    )
    useSessionStore.setState({ history })
  }

  private armAutoPick(): void {
    const s = this.session
    if (this.autoPickTimer || s.match.autoPickAt == null) return
    const delay = Math.max(0, s.match.autoPickAt - this.now())
    this.autoPickTimer = setTimeout(() => {
      this.autoPickTimer = null
      const m = this.session.match
      if (m.state === 'ambiguous' && m.candidates.length > 0) {
        this.activateEntry(m.candidates[0].entryId, {
          askedAt: this.session.clockSec,
          heard: m.heard,
          viaFind: false,
          candidates: m.candidates
        })
      }
    }, delay)
  }

  private clearAutoPick(): void {
    if (this.autoPickTimer) clearTimeout(this.autoPickTimer)
    this.autoPickTimer = null
    if (this.session.match.autoPickAt != null) this.session.setMatch({ autoPickAt: null })
  }

  // ---- command surface (containers + mock control events) ----

  pickCandidate(entryId: string): void {
    const m = this.session.match
    this.activateEntry(entryId, {
      askedAt: this.session.clockSec,
      heard: m.heard,
      viaFind: false,
      candidates: m.candidates
    })
  }

  dismissUnsure(): void {
    this.clearAutoPick()
    const prev = this.session.match.entryId
    this.session.setMatch({ state: prev ? 'confident' : 'none', candidates: [], heard: null })
  }

  pinEntry(entryId: string): void {
    this.activateEntry(entryId, {
      askedAt: this.session.clockSec,
      heard: this.session.match.heard,
      viaFind: true
    })
  }

  togglePoint(entryId: string, pointId: string): void {
    this.session.togglePoint(entryId, pointId)
    this.syncActiveQuestion()
  }

  async end(): Promise<SessionRecord> {
    this.stopped = true
    this.clearAutoPick()
    const s = this.session
    const startedAt = s.startedAt ?? this.now()
    // finalize per-question mic time + transcript excerpts
    const ordered = [...s.questions].sort((a, b) => a.askedAtSec - b.askedAtSec)
    const finalized = ordered.map((q, i) => {
      const from = q.askedAtSec
      const to = ordered[i + 1]?.askedAtSec ?? Number.POSITIVE_INFINITY
      const mine = this.youSegments.filter((y) => y.t >= from && y.t < to)
      const micSeconds =
        mine.length === 0
          ? 0
          : Math.round(mine[mine.length - 1].t - mine[0].t + estimateSpokenSeconds(mine[mine.length - 1].text))
      const transcript = s.keepTranscript
        ? s.transcript
            .filter((e) => e.confirmed && e.t >= from && e.t < to)
            .map((e) => ({ speaker: e.speaker, text: e.text, highlight: e.highlight }))
        : undefined
      return { ...q, micSeconds, transcript }
    })
    const record: SessionRecord = {
      id: `session-${startedAt}`,
      loopId: s.loopId ?? '',
      startedAt,
      endedAt: startedAt + s.clockSec * 1000,
      transcriptKept: s.keepTranscript,
      questions: finalized
    }
    s.setLastSession(record)
    s.setStatus('idle')
    await api.sessions.save(record)
    // stamp lastUsed on every matched entry
    const bankState = useBankStore.getState()
    const loop = bankState.bank?.loops.find((l) => l.id === record.loopId)
    const date = new Date(record.endedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
    for (const q of finalized) {
      if (q.entryId) {
        void bankState.markLastUsed(q.entryId, {
          loopName: loop?.shortName ?? 'session',
          date,
          covered: q.coveredPointIds.length,
          total: q.totalPoints
        })
      }
    }
    usePanelStore.getState().setView('recap')
    usePanelStore.getState().setCollapsed(false)
    return record
  }
}

/** rough speaking time for a segment's text at ~150 wpm */
export function estimateSpokenSeconds(text: string): number {
  const words = text.split(/\s+/).filter(Boolean).length
  return words / 2.5
}
