import { create } from 'zustand'
import type { Candidate, SessionQuestion, SessionRecord, TranscriptLine } from '@shared/types'

// Live-session state, shaped per the handoff README's State Management
// section: session / transcript / match / coverage / history. The engine
// (lib/engine.ts) is the only writer during a session.

export type SessionStatus = 'idle' | 'armed' | 'listening' | 'paused'
export type MatchStateKind = 'none' | 'confident' | 'ambiguous' | 'pinned'

export interface TranscriptEntry {
  speaker: 'you' | 'them'
  text: string
  confirmed: boolean
  /** session clock, seconds */
  t: number
  highlight?: string
}

export interface MatchSlice {
  state: MatchStateKind
  entryId: string | null
  candidates: Candidate[]
  /** wall-clock ms when the unsure state auto-picks; null when not counting */
  autoPickAt: number | null
  /** the phrase that led to the unsure state, quoted in the UI */
  heard: string | null
  /** a question was heard that matched nothing, and the entry still on screen
   *  is from the PREVIOUS question. The card must stop presenting itself as
   *  current, and your improvised words must stop striking through its
   *  points — the panel used to look like it was tracking you. */
  stale: boolean
}

export interface HistoryRow {
  entryId: string
  /** session clock, seconds */
  askedAt: number
  coveredCount: number
  totalPoints: number
}

interface SessionState {
  status: SessionStatus
  loopId: string | null
  startedAt: number | null
  /** session clock in seconds (fixture-driven in mock, wall-clock in real) */
  clockSec: number
  keepTranscript: boolean
  /** rehearsing one answer against the real mic. Practice runs never reach
   *  sessions.json: an evening of rehearsal must not dilute the interview
   *  history, or shadow a real recap at boot (REVIEW.md P10). */
  practiceEntryId: string | null
  /** this session must never be written to disk. True for practice AND for
   *  the scripted dry run, which used to save a fake record and stamp
   *  lastUsed on real bank entries with the fixture's coverage numbers. */
  ephemeral: boolean

  transcript: TranscriptEntry[]
  match: MatchSlice
  /** seconds of your own mic time on the entry currently on screen. The
   *  recap already flags an answer that ran long — but only once it can no
   *  longer help (REVIEW.md P9). */
  activeMicSec: number
  /** entryId → covered point ids (never shrinks automatically) */
  coverage: Record<string, string[]>
  history: HistoryRow[]
  /** the session record being accumulated for the recap */
  questions: SessionQuestion[]
  /** finished record, feeds the recap screen */
  lastSession: SessionRecord | null
  /** the final save failed — the recap shows this instead of pretending the
   *  record is on disk (REVIEW.md M5) */
  saveError: string | null

  arm(
    loopId: string,
    keepTranscript: boolean,
    practiceEntryId?: string | null,
    ephemeral?: boolean
  ): void
  setStatus(s: SessionStatus): void
  setClock(sec: number): void
  setActiveMicSec(sec: number): void
  appendTranscript(e: TranscriptEntry): void
  setMatch(m: Partial<MatchSlice>): void
  coverPoints(entryId: string, pointIds: string[]): void
  /** manual click-to-toggle — the one path that may un-cover */
  togglePoint(entryId: string, pointId: string): void
  /** a genuine re-ask of an entry starts its coverage over — "covered THIS
   *  time", not "covered at some point today" */
  resetCoverage(entryId: string): void
  pushHistory(row: HistoryRow): void
  upsertQuestion(q: SessionQuestion): void
  setLastSession(s: SessionRecord | null): void
  setSaveError(message: string | null): void
  reset(): void
}

const EMPTY_MATCH: MatchSlice = {
  state: 'none',
  entryId: null,
  candidates: [],
  autoPickAt: null,
  heard: null,
  stale: false
}

export const useSessionStore = create<SessionState>((set, get) => ({
  status: 'idle',
  loopId: null,
  startedAt: null,
  clockSec: 0,
  keepTranscript: false,
  practiceEntryId: null,
  ephemeral: false,
  activeMicSec: 0,
  transcript: [],
  match: EMPTY_MATCH,
  coverage: {},
  history: [],
  questions: [],
  lastSession: null,
  saveError: null,

  arm: (loopId, keepTranscript, practiceEntryId = null, ephemeral = practiceEntryId != null) =>
    set({
      saveError: null,
      status: 'armed',
      loopId,
      keepTranscript,
      practiceEntryId,
      ephemeral,
      startedAt: Date.now(),
      clockSec: 0,
      activeMicSec: 0,
      transcript: [],
      match: EMPTY_MATCH,
      coverage: {},
      history: [],
      questions: []
    }),

  setStatus: (status) => set({ status }),
  setClock: (clockSec) => set({ clockSec }),
  setActiveMicSec: (activeMicSec) => set({ activeMicSec }),

  appendTranscript: (e) =>
    set((s) => {
      const buf = [...s.transcript]
      const last = buf[buf.length - 1]
      // an unconfirmed tail from the same speaker is replaced, not appended
      if (last && !last.confirmed && last.speaker === e.speaker) buf.pop()
      buf.push(e)
      // rolling buffer — keep the last 200 entries
      return { transcript: buf.slice(-200) }
    }),

  setMatch: (m) => set((s) => ({ match: { ...s.match, ...m } })),

  coverPoints: (entryId, pointIds) =>
    set((s) => {
      const cur = new Set(s.coverage[entryId] ?? [])
      pointIds.forEach((p) => cur.add(p))
      return { coverage: { ...s.coverage, [entryId]: [...cur] } }
    }),

  togglePoint: (entryId, pointId) =>
    set((s) => {
      const cur = new Set(s.coverage[entryId] ?? [])
      if (cur.has(pointId)) cur.delete(pointId)
      else cur.add(pointId)
      return { coverage: { ...s.coverage, [entryId]: [...cur] } }
    }),

  resetCoverage: (entryId) =>
    set((s) => ({ coverage: { ...s.coverage, [entryId]: [] } })),

  pushHistory: (row) => set((s) => ({ history: [row, ...s.history] })),

  upsertQuestion: (q) =>
    set((s) => {
      const i = s.questions.findIndex((x) => x.id === q.id)
      const questions = [...s.questions]
      if (i >= 0) questions[i] = q
      else questions.push(q)
      return { questions }
    }),

  setLastSession: (lastSession) => set({ lastSession }),
  setSaveError: (saveError) => set({ saveError }),

  reset: () =>
    set({
      status: 'idle',
      loopId: null,
      practiceEntryId: null,
      ephemeral: false,
      startedAt: null,
      clockSec: 0,
      activeMicSec: 0,
      transcript: [],
      match: EMPTY_MATCH,
      coverage: {},
      history: [],
      questions: []
    })
}))

/** transcript lines for one question's recap excerpt */
export function excerptFor(transcript: TranscriptEntry[], fromSec: number, toSec: number): TranscriptLine[] {
  return transcript
    .filter((e) => e.confirmed && e.t >= fromSec && e.t < toSec)
    .map((e) => ({ speaker: e.speaker, text: e.text, highlight: e.highlight }))
}
