import type { Answer, Candidate, Segment, SessionQuestion, SessionRecord, Transcriber } from '@shared/types'
import { TUNING } from '@shared/tuning'
import { HybridMatcher } from './matcher'
import { EmbeddingCoverage } from './coverage'
import type { EmbeddingCache } from './embeddings'
import { useSessionStore } from '../state/sessionStore'
import { useBankStore, answersForLoop } from '../state/bankStore'
import { usePanelStore } from '../state/panelStore'
import { useSettingsStore } from '../state/settingsStore'
import { usePersistHealth } from '../state/persistHealth'
import { api } from './api'

// The session engine wires transcriber segments → matcher → panel state, and
// mic segments → coverage. It is the only writer to the session store while a
// session runs. UI containers read stores; they never talk to the engine
// directly except via the small command surface at the bottom.

/** Does this read as a question or a request to speak? Exported so the
 *  calibration tests exercise the same detector the engine runs.
 *  Multi-word lead-ins match anywhere; bare interrogatives only count at a
 *  clause start — "that's why we moved the interview online" is not a
 *  question (REVIEW.md M12). */
export function isQuestionLike(text: string): boolean {
  if (/\?\s*$/.test(text)) return true
  if (
    /\b(tell me|tell us|walk me|walk us|take me through|talk me through|talk about|can you|could you|would you|have you ever|how do|how did|how would|describe|give me|give us|share an?|share your|i'd love to hear|suppose|imagine|say you)\b/i.test(
      text
    )
  ) {
    return true
  }
  // bare interrogatives (including "what's/what is") only at a clause start —
  // "we know what is at stake" is not a question
  return /(^|[.;!?]\s+)(why|what|how|when|where)\b/i.test(text)
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
  /** every confirmed line while the transcript toggle is on. The recap's
   *  excerpts come from here — the UI's 200-line rolling ring emptied the
   *  first half of a real-length interview (REVIEW.md H10). */
  private keptLines: { speaker: 'you' | 'them'; text: string; t: number; highlight?: string }[] = []
  private stopped = false
  /** how many times each entry has been put on screen this session — the
   *  repeat prior reads this */
  private activations = new Map<string, number>()
  /** the question row a partial opened, waiting for the confirmed text */
  private partialQuestionId: string | null = null
  /** session clock at which the entry now on screen was activated — the live
   *  pacing cue measures your mic time from here (REVIEW.md P9) */
  private activeAskedAt: number | null = null

  private snapshotTimer: ReturnType<typeof setInterval> | null = null
  /** a confident swap deferred by the debounce window */
  private pendingSwapTimer: ReturnType<typeof setTimeout> | null = null
  /** bumped by every manual resolution (pick / dismiss / pin) so an async
   *  warm-embedding rescore can tell its scoring is stale (REVIEW.md M2) */
  private resolutionSeq = 0
  /** session clock at pause — trailing flushed segments stamped before this
   *  still belong to the session (REVIEW.md M6) */
  private pausedAtSec: number | null = null

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
    // interim snapshots: a crash mid-interview keeps the recap up to the last
    // tick. The final end() save overwrites the snapshot (same id, upsert).
    this.snapshotTimer = setInterval(() => {
      const s = this.session
      if (this.stopped || (s.status !== 'listening' && s.status !== 'paused')) return
      if (s.questions.length === 0) return
      void api.sessions
        .save(this.buildRecord(true))
        .then(() => usePersistHealth.getState().noteSuccess('sessions'))
        .catch((err) => usePersistHealth.getState().noteFailure('sessions', err))
    }, TUNING.snapshotIntervalSec * 1000)
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

  private keepLine(speaker: 'you' | 'them', seg: Segment): void {
    if (!this.session.keepTranscript) return
    this.keptLines.push({ speaker, text: seg.text, t: seg.t })
    // ~9h of continuous confirmed speech — a leak guard, not a working limit
    if (this.keptLines.length > 5000) this.keptLines.splice(0, this.keptLines.length - 5000)
  }

  /** attach the matched phrase to the kept line it fired on, so the recap can
   *  show why (same annotation the UI ring gets) */
  noteHighlight(text: string, highlight: string): void {
    for (let i = this.keptLines.length - 1; i >= 0; i--) {
      const line = this.keptLines[i]
      if (line.speaker === 'them' && line.text === text) {
        if (!line.highlight) line.highlight = highlight
        return
      }
    }
  }

  /** is the session accepting segments? While paused, only the trailing
   *  flush of speech from before the pause is let through (REVIEW.md M6) */
  private accepts(segT: number): boolean {
    const s = this.session
    if (s.status === 'listening' || s.status === 'armed') return true
    return s.status === 'paused' && this.pausedAtSec != null && segT <= this.pausedAtSec + 1
  }

  private onThem(seg: Segment): void {
    if (this.stopped) return
    const s = this.session
    if (!this.accepts(seg.t)) return
    s.setClock(Math.max(s.clockSec, seg.t))
    s.appendTranscript({ speaker: 'them', text: seg.text, confirmed: seg.confirmed, t: seg.t })
    if (!seg.confirmed) {
      this.onPartial(seg)
      return
    }
    this.keepLine('them', seg)
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
    if (entries.length === 0) {
      // an empty loop still hears questions — the recap must say so rather
      // than reporting a silent session (REVIEW.md L12)
      if (questionLike) {
        this.recordQuestion(null, seg.t, seg.text, false)
        this.window = [seg]
      }
      return
    }
    const utterance = this.window.map((w) => w.text).join(' ')
    // warm the embedding cache in the background; scoring stays synchronous
    const wasCold =
      this.embeddings != null && this.embeddings.hasProvider && this.embeddings.get(utterance) == null
    const warm = this.embeddings?.ensure([
      utterance,
      ...entries.flatMap((e) => [e.question, ...e.triggerPhrases])
    ])
    this.applyScores(utterance, seg, questionLike, false)
    // once the vectors land, rescore the same window — a cold Dice-only
    // decision can flip to a confident match seconds before the next segment.
    // The rescore respects anything the user resolved by hand in the meantime.
    if (wasCold && warm) {
      const resolutionAt = this.resolutionSeq
      void warm.then(() => this.rescoreIfUnchanged(utterance, seg, questionLike, resolutionAt))
    }
  }

  /**
   * An in-flight partial, arriving while the interviewer is still speaking.
   *
   * Two jobs. First, always warm the embedding for what they are saying, so
   * the confirmed pass scores immediately instead of waiting on a round trip
   * to the worker. Second — and only well above the confirmed bar — put the
   * card up now. Waiting for a confirmed segment costs the VAD's silence
   * timeout plus a decode, and lands the answer in the pause where you were
   * meant to be speaking.
   *
   * The partial is deliberately *not* pushed into `this.window`: the confirmed
   * segment covering the same speech is moments behind it and would otherwise
   * be counted twice.
   */
  private onPartial(seg: Segment): void {
    const s = this.session
    if (s.match.state === 'pinned') return
    const entries = this.entries()
    if (entries.length === 0) return

    const utterance = [...this.window.map((w) => w.text), seg.text].join(' ')
    void this.embeddings?.ensure([utterance, ...entries.flatMap((e) => [e.question, ...e.triggerPhrases])])

    const candidates = this.matcher.score(utterance, entries, this.priors, isQuestionLike(seg.text))
    const top = candidates[0]
    if (!top || top.entryId === s.match.entryId) return
    const runnerUp = candidates[1]?.score ?? 0
    if (
      top.score < TUNING.confidentPartial ||
      top.score - runnerUp < TUNING.confidentMarginPartial
    ) {
      return
    }
    // a swap this recent belongs to the question still being asked; jumping
    // again mid-sentence is the flip-flop this bar exists to prevent
    const wallNow = this.now()
    if (wallNow - this.lastSwapAt < TUNING.swapDebounceMs) return
    this.lastSwapAt = wallNow
    if (s.status === 'armed') s.setStatus('listening')
    this.activateEntry(top.entryId, {
      askedAt: seg.t,
      heard: seg.text,
      viaFind: false,
      candidates,
      fromPartial: true
    })
  }

  /** an entry already answered is less likely to be asked again */
  private priors = (entryId: string): number => {
    const n = this.activations.get(entryId) ?? 0
    return -Math.min(TUNING.repeatPenaltyMax, n * TUNING.repeatPenalty)
  }

  private rescoreIfUnchanged(
    utterance: string,
    seg: Segment,
    questionLike: boolean,
    resolutionAt: number
  ): void {
    if (this.stopped) return
    const s = this.session
    if (s.status !== 'listening' && s.status !== 'armed') return
    if (s.match.state === 'pinned') return
    // the user picked or dismissed since this was scored — their call stands
    // (REVIEW.md M2)
    if (this.resolutionSeq !== resolutionAt) return
    if (this.window.map((w) => w.text).join(' ') !== utterance) return
    this.applyScores(utterance, seg, questionLike, true)
  }

  private applyScores(
    utterance: string,
    seg: Segment,
    questionLike: boolean,
    isRescore: boolean
  ): void {
    const s = this.session
    const entries = this.entries()
    // Score the whole window *and* the question on its own, and take whichever
    // reads more clearly. Joining 12 seconds of speech means "right, that makes
    // sense, okay, so next one" gets averaged into the question's embedding and
    // dilutes it toward nothing in particular.
    const tail = this.questionTail(utterance)
    let candidates = this.matcher.score(utterance, entries, this.priors, questionLike)
    let state = this.matcher.classify(candidates)
    if (tail !== utterance) {
      const tailCandidates = this.matcher.score(tail, entries, this.priors, questionLike)
      if ((tailCandidates[0]?.score ?? 0) > (candidates[0]?.score ?? 0)) {
        candidates = tailCandidates
        state = this.matcher.classify(tailCandidates)
      }
    }

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
            candidates,
            fromRescore: isRescore
          })
        } else {
          // inside the debounce window: defer instead of dropping — a
          // question asked right after a swap must not be lost
          this.queueSwap(
            { entryId: top.entryId, askedAt: seg.t, heard: seg.text, candidates },
            this.lastSwapAt + TUNING.swapDebounceMs - wallNow
          )
        }
      } else {
        // newer evidence re-confirmed the current entry — a swap queued for an
        // older reading is stale now (REVIEW.md H4)
        this.clearPendingSwap()
        s.setMatch({ candidates, state: 'confident' })
        this.clearAutoPick()
        // the panel was already on this entry because a partial put it there;
        // now that the full sentence has arrived, correct the wording the
        // recap will show rather than leaving half a question in the record
        this.patchPartialQuestion(seg)
      }
    } else if (state === 'ambiguous' && questionLike) {
      // a NEWER question is on the table — a swap deferred for the previous
      // one must not fire over its unsure card (REVIEW.md H4)
      this.clearPendingSwap()
      const shortlist = this.matcher.shortlist(candidates)
      const wallNow = this.now()
      // "never" (autoPickSec null) leaves autoPickAt null: the card waits for
      // a decision rather than committing a leader you were still reading
      // (REVIEW.md P5)
      const autoPickSec = useSettingsStore.getState().autoPickSec
      const keepDeadline = s.match.state === 'ambiguous' && s.match.autoPickAt != null
      s.setMatch({
        state: 'ambiguous',
        candidates: shortlist,
        heard: seg.text,
        autoPickAt: keepDeadline
          ? s.match.autoPickAt
          : autoPickSec == null
            ? null
            : wallNow + autoPickSec * 1000
      })
      this.armAutoPick()
    } else if (state === 'none' && questionLike && !isRescore) {
      this.clearPendingSwap()
      // heard a question that hit nothing in the bank — log it for the recap
      // (a warm rescore that still lands on none must not double-record)
      this.recordQuestion(null, seg.t, seg.text, false)
      this.window = [seg] // start a fresh window at this question
    }
  }

  private clearPendingSwap(): void {
    if (this.pendingSwapTimer) {
      clearTimeout(this.pendingSwapTimer)
      this.pendingSwapTimer = null
    }
  }

  /** replace a partial's half-sentence with the confirmed text on the row it
   *  opened. Only ever touches the one row, and only once. */
  private patchPartialQuestion(seg: Segment): void {
    const id = this.partialQuestionId
    if (!id) return
    const s = this.session
    const q = s.questions.find((x) => x.id === id)
    this.partialQuestionId = null
    if (!q || !seg.text) return
    // the confirmed segment covers the same speech, so it is the longer and
    // more accurate rendering of it
    if (seg.text.length <= q.question.length) return
    s.upsertQuestion({ ...q, question: seg.text })
  }

  private queueSwap(
    pending: { entryId: string; askedAt: number; heard: string; candidates: Candidate[] },
    delayMs: number
  ): void {
    if (this.pendingSwapTimer) clearTimeout(this.pendingSwapTimer)
    this.pendingSwapTimer = setTimeout(() => {
      this.pendingSwapTimer = null
      if (this.stopped) return
      const m = this.session.match
      if (m.state === 'pinned' || m.entryId === pending.entryId) return
      this.lastSwapAt = this.now()
      this.activateEntry(pending.entryId, { ...pending, viaFind: false })
    }, delayMs)
  }

  /** the window from the last question-like segment onward, or the whole
   *  thing when nothing in it looks like a question */
  private questionTail(whole: string): string {
    for (let i = this.window.length - 1; i >= 0; i--) {
      if (isQuestionLike(this.window[i].text)) {
        const tail = this.window.slice(i).map((w) => w.text).join(' ')
        return tail || whole
      }
    }
    return whole
  }

  private pruneWindow(nowSec: number): void {
    // a long silence between *their* segments is a turn boundary too. Only
    // your own speech used to end the turn, so a question could be scored
    // together with preamble from well before it.
    const prev = this.window[this.window.length - 2]
    if (prev && nowSec - prev.t > TUNING.windowGapSec) {
      this.window = this.window.slice(-1)
      return
    }
    this.window = this.window.filter((w) => nowSec - w.t <= TUNING.windowSec || w.t === nowSec)
  }

  // ---- own mic stream ----

  private onYou(seg: Segment): void {
    if (this.stopped) return
    const s = this.session
    if (!this.accepts(seg.t)) return
    s.setClock(Math.max(s.clockSec, seg.t))
    s.appendTranscript({ speaker: 'you', text: seg.text, confirmed: seg.confirmed, t: seg.t })
    if (!seg.confirmed) return
    this.keepLine('you', seg)
    this.youSegments.push(seg)
    this.updateActiveMicSec()
    this.window = [] // speaking is a turn boundary for the interviewer window

    const entryId = s.match.entryId
    if (!entryId || (s.match.state !== 'confident' && s.match.state !== 'pinned')) return
    const entry = this.entries().find((e) => e.id === entryId)
    if (!entry) return
    const coveredAlready = new Set(s.coverage[entryId] ?? [])
    const uncovered = entry.points.filter((p) => !coveredAlready.has(p.id))
    if (uncovered.length === 0) return

    // A point delivered across two breaths — "I brought a two-week test" …
    // "rather than an argument" — could clear the bar in neither segment on
    // its own, so the last few seconds of speech are scored as well, against a
    // higher threshold since more text is easier to match by accident.
    const recent = this.recentSpeech(seg.t)
    const texts = recent === seg.text ? [seg.text] : [seg.text, recent]
    void this.embeddings?.ensure([...texts, ...uncovered.map((p) => p.text)])

    const newlyCovered = new Set(this.coverage.score(seg.text, uncovered))
    if (recent !== seg.text) {
      for (const id of this.coverage.score(recent, uncovered, TUNING.coverageWindowMargin)) {
        newlyCovered.add(id)
      }
    }
    if (newlyCovered.size > 0) {
      s.coverPoints(entryId, [...newlyCovered])
      this.syncActiveQuestion()
    }
  }

  /** what you have said in the last coverageWindowSec, as one string */
  private recentSpeech(nowSec: number): string {
    const recent = this.youSegments.filter((y) => nowSec - y.t <= TUNING.coverageWindowSec)
    return recent.map((y) => y.text).join(' ')
  }

  // ---- activation / unsure resolution ----

  private activateEntry(
    entryId: string,
    opts: {
      askedAt: number
      heard: string | null
      viaFind: boolean
      candidates?: { entryId: string; score: number }[]
      /** an in-flight partial put this on screen; the confirmed text will
       *  arrive shortly and should replace the recorded question wording */
      fromPartial?: boolean
      /** a warm-embedding rescore of an already-heard window */
      fromRescore?: boolean
    }
  ): void {
    const s = this.session
    this.clearAutoPick()
    const priorActivations = this.activations.get(entryId) ?? 0
    this.activations.set(entryId, priorActivations + 1)
    // any activation that isn't itself a partial ends the wait for one: a swap
    // to a different entry would otherwise leave the old row marked, and the
    // *next* confirmed segment would patch the wrong question's text
    if (!opts.fromPartial) this.partialQuestionId = null
    // any activation supersedes a deferred swap
    this.clearPendingSwap()
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
      if (phrase) this.noteHighlight(opts.heard, phrase)
    }
    s.setMatch({
      state: opts.viaFind ? 'pinned' : 'confident',
      entryId,
      candidates: opts.candidates ?? [],
      autoPickAt: null,
      heard: null
    })
    // the pacing cue is about THIS asking, so the meter restarts here
    this.activeAskedAt = opts.askedAt
    s.setActiveMicSec(0)
    const outcome = this.recordQuestion(
      entryId,
      opts.askedAt,
      opts.heard,
      opts.viaFind,
      opts.fromPartial === true,
      opts.fromRescore === true
    )
    // a genuine re-ask starts its coverage from zero: the new recap row (and
    // the card) mean "covered THIS time", not "covered at some point today"
    // (REVIEW.md L19)
    if (outcome === 'created' && priorActivations > 0) {
      s.resetCoverage(entryId)
      this.syncActiveQuestion()
    }
  }

  private recordQuestion(
    entryId: string | null,
    askedAt: number,
    heard: string | null,
    viaFind: boolean,
    fromPartial = false,
    fromRescore = false
  ): 'merged' | 'created' {
    const s = this.session
    const entry = entryId ? this.entries().find((e) => e.id === entryId) : null
    // An activation RESOLVING an unmatched question absorbs its row instead of
    // double-counting: a ⌘K pin for the thing they just asked, or a warm
    // rescore of the same window. Nothing else merges — an organic match for
    // the NEXT question used to swallow a genuine not-in-bank question from
    // the recap (REVIEW.md H3).
    const last = [...s.questions].sort((a, b) => a.askedAtSec - b.askedAtSec).at(-1)
    if (
      entry &&
      last &&
      last.entryId == null &&
      askedAt - last.askedAtSec <= 45 &&
      (viaFind || fromRescore)
    ) {
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
      return 'merged'
    }
    const q: SessionQuestion = {
      id: `q-${this.questionSeq++}`,
      askedAtSec: askedAt,
      question: heard ?? entry?.question ?? '',
      entryId,
      coveredPointIds: entryId ? (s.coverage[entryId] ?? []) : [],
      totalPoints: entry?.points.length ?? 0,
      micSeconds: 0,
      pinnedViaFind: viaFind
    }
    s.upsertQuestion(q)
    // a partial's text is half a sentence; remember the row so the confirmed
    // wording can replace it rather than adding a second row to the recap
    this.partialQuestionId = fromPartial ? q.id : null
    if (entry) {
      s.pushHistory({
        entryId: entry.id,
        askedAt,
        coveredCount: (s.coverage[entry.id] ?? []).length,
        totalPoints: entry.points.length
      })
    }
    return 'created'
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

  /** mic time spent on the entry currently on screen — the same arithmetic
   *  buildRecord uses for the recap's "ran long" flag, live (REVIEW.md P9) */
  private updateActiveMicSec(): void {
    const from = this.activeAskedAt
    if (from == null) return
    const mine = this.youSegments.filter((y) => y.t >= from)
    if (mine.length === 0) return
    const last = mine[mine.length - 1]
    const sec = last.t - mine[0].t + estimateSpokenSeconds(last.text)
    this.session.setActiveMicSec(Math.max(0, Math.round(sec)))
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
    // the countdown drives clicks right at the deadline — if the auto-pick
    // (or anything else) resolved this first, a late click must not record a
    // second question row (REVIEW.md M3)
    if (m.state !== 'ambiguous') return
    this.resolutionSeq++
    this.activateEntry(entryId, {
      askedAt: this.session.clockSec,
      heard: m.heard,
      viaFind: false,
      candidates: m.candidates
    })
  }

  dismissUnsure(): void {
    this.resolutionSeq++
    this.clearAutoPick()
    const prev = this.session.match.entryId
    this.session.setMatch({ state: prev ? 'confident' : 'none', candidates: [], heard: null })
  }

  pinEntry(entryId: string): void {
    this.resolutionSeq++
    this.activateEntry(entryId, {
      askedAt: this.session.clockSec,
      heard: this.session.match.heard,
      viaFind: true
    })
  }

  /** the session paused: stop the timers that would otherwise keep resolving
   *  questions while "not listening" (REVIEW.md M4), and remember the clock so
   *  the flushed mid-sentence tail is still accepted (REVIEW.md M6) */
  pause(): void {
    this.pausedAtSec = this.session.clockSec
    this.clearAutoPick()
    this.clearPendingSwap()
  }

  resume(): void {
    this.pausedAtSec = null
  }

  togglePoint(entryId: string, pointId: string): void {
    this.session.togglePoint(entryId, pointId)
    this.syncActiveQuestion()
  }

  /** the SessionRecord as of now — shared by interim snapshots and end() */
  buildRecord(incomplete: boolean): SessionRecord {
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
      // privacy: excerpts only when the recap transcript toggle is on.
      // Sourced from the engine's own uncapped keep, not the UI's 200-line
      // ring — the ring emptied the opening questions of any real-length
      // interview (REVIEW.md H10).
      const transcript = s.keepTranscript
        ? this.keptLines
            .filter((e) => e.t >= from && e.t < to)
            .map((e) => ({ speaker: e.speaker, text: e.text, highlight: e.highlight }))
        : undefined
      return { ...q, micSeconds, transcript }
    })
    return {
      id: `session-${startedAt}`,
      loopId: s.loopId ?? '',
      startedAt,
      // wall clock, not the audio clock: the audio clock stops during pauses
      // and silence, so it under-reported the recap's "N MINUTES" (REVIEW.md L22)
      endedAt: Math.max(startedAt, this.now()),
      transcriptKept: s.keepTranscript,
      questions: finalized,
      ...(incomplete ? { incomplete: true } : {})
    }
  }

  async end(): Promise<SessionRecord> {
    this.stopped = true
    this.clearAutoPick()
    if (this.snapshotTimer) clearInterval(this.snapshotTimer)
    this.snapshotTimer = null
    if (this.pendingSwapTimer) clearTimeout(this.pendingSwapTimer)
    this.pendingSwapTimer = null
    const s = this.session
    const record = this.buildRecord(false)
    s.setLastSession(record)
    s.setStatus('idle')
    try {
      // a disk error here used to strand the app on the live view with the
      // mic still hot: no recap, no capture teardown (REVIEW.md M5). The recap
      // opens from memory regardless; the failure is reported on it.
      await api.sessions.save(record)
      s.setSaveError(null)
    } catch (err) {
      s.setSaveError(
        `This session could not be saved — ${err instanceof Error ? err.message : String(err)}. ` +
          'The recap below is from memory; export it before closing the app.'
      )
    } finally {
      // stamp lastUsed on every matched entry (persist() surfaces any failure)
      const bankState = useBankStore.getState()
      const loop = bankState.bank?.loops.find((l) => l.id === record.loopId)
      const date = new Date(record.endedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
      for (const q of record.questions) {
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
    }
    return record
  }
}

/** rough speaking time for a segment's text at ~150 wpm */
export function estimateSpokenSeconds(text: string): number {
  const words = text.split(/\s+/).filter(Boolean).length
  return words / 2.5
}
