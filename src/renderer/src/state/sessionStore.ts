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

  transcript: TranscriptEntry[]
  match: MatchSlice
  /** entryId → covered point ids (never shrinks automatically) */
  coverage: Record<string, string[]>
  history: HistoryRow[]
  /** the session record being accumulated for the recap */
  questions: SessionQuestion[]
  /** finished record, feeds the recap screen */
  lastSession: SessionRecord | null

  arm(loopId: string, keepTranscript: boolean): void
  setStatus(s: SessionStatus): void
  setClock(sec: number): void
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
  reset(): void
}

const EMPTY_MATCH: MatchSlice = { state: 'none', entryId: null, candidates: [], autoPickAt: null, heard: null }

export const useSessionStore = create<SessionState>((set, get) => ({
  status: 'idle',
  loopId: null,
  startedAt: null,
  clockSec: 0,
  keepTranscript: false,
  transcript: [],
  match: EMPTY_MATCH,
  coverage: {},
  history: [],
  questions: [],
  lastSession: null,

  arm: (loopId, keepTranscript) =>
    set({
      status: 'armed',
      loopId,
      keepTranscript,
      startedAt: Date.now(),
      clockSec: 0,
      transcript: [],
      match: EMPTY_MATCH,
      coverage: {},
      history: [],
      questions: []
    }),

  setStatus: (status) => set({ status }),
  setClock: (clockSec) => set({ clockSec }),

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

  reset: () =>
    set({
      status: 'idle',
      loopId: null,
      startedAt: null,
      clockSec: 0,
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
