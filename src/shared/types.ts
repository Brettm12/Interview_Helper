// Data shapes per the handoff README's State Management section.
// Bank data (Loop/Section/Answer/Story) is persisted; Session feeds the recap.

export type PointId = string

export interface Point {
  id: PointId
  text: string
}

export interface Answer {
  id: string
  question: string
  sectionId: string
  loopIds: string[]
  points: Point[]
  storyId: string | null
  triggerPhrases: string[]
  lastUsed: {
    loopName: string
    date: string
    covered: number
    total: number
  } | null
}

export interface Story {
  id: string
  title: string
  body: string
  metrics: string[]
}

export interface Section {
  id: string
  name: string
}

export interface Loop {
  id: string
  /** e.g. "Senior People Partner · Meridian Health · Round 2" */
  name: string
  /** sidebar-length name, e.g. "People Partner · Meridian" */
  shortName: string
  /** e.g. "Alex Kim + one more · 45 min · Google Meet" */
  detail: string
  /** e.g. "STARTS IN 6 MINUTES" */
  startsIn?: string
  /** Ranked opener guesses for the armed screen */
  likelyOpeners: string[]
}

export interface Bank {
  /** schema version, stamped on save so a future migration has something to
   *  read — and unknown fields round-trip instead of being silently stripped
   *  (REVIEW.md L18) */
  version?: number
  loops: Loop[]
  sections: Section[]
  answers: Answer[]
  stories: Story[]
  /** id of the loop selected in the bank/setup */
  activeLoopId: string
}

// ---- Session (recap) ----

export interface TranscriptLine {
  speaker: 'you' | 'them'
  text: string
  /** phrase to render highlighted, if any */
  highlight?: string
}

export interface SessionQuestion {
  id: string
  /** seconds into the session it was heard */
  askedAtSec: number
  /** verbatim question as heard */
  question: string
  /** matched bank entry, or null when nothing in the bank matched */
  entryId: string | null
  coveredPointIds: PointId[]
  totalPoints: number
  /** seconds of the candidate's own mic time spent on this answer */
  micSeconds: number
  /** the entry was pulled up by hand via ⌘K */
  pinnedViaFind: boolean
  /** kept only when the transcript toggle was on */
  transcript?: TranscriptLine[]
}

export interface SessionRecord {
  id: string
  loopId: string
  startedAt: number
  endedAt: number
  transcriptKept: boolean
  questions: SessionQuestion[]
  /** written by interim crash-resilience snapshots; the final save omits it */
  incomplete?: boolean
}

// ---- Runtime plumbing (audio → transcript → match → coverage) ----

export interface AudioChunk {
  stream: 'meeting' | 'mic'
  /** mono PCM float32 samples at `sampleRate` */
  samples: Float32Array
  sampleRate: number
  t: number
}

export interface Segment {
  speaker: 'you' | 'them'
  text: string
  /** false while the tail of the segment may still be revised */
  confirmed: boolean
  t: number
}

export interface Candidate {
  entryId: string
  score: number
}

export interface AudioSource {
  start(): void
  stop(): void
  onChunk(cb: (c: AudioChunk) => void): void
  /** acquisition/capture failure — surfaced on the setup screen (optional:
   *  the mock never fails) */
  onError?(cb: (e: Error) => void): void
}

export interface Transcriber {
  push(chunk: AudioChunk): void
  onSegment(cb: (s: Segment) => void): void
}

export interface Matcher {
  score(utterance: string, entries: Answer[]): Candidate[]
}

export interface CoverageModel {
  score(said: string, points: Point[]): PointId[]
}

// ---- Settings persisted alongside the bank ----

export interface Settings {
  /** schema version (REVIEW.md L18) */
  version?: number
  /** exclude helper windows from screen capture */
  contentProtection: boolean
  /** keep a transcript for the recap (default off) */
  keepTranscript: boolean
  placement: 'docked' | 'strip' | 'second-screen'
  /** last remembered strip position */
  stripPosition: { x: number; y: number } | null
  /** chosen microphone, or null for the system default. Worth persisting:
   *  a default input that silently switches to a narrowband headset is
   *  invisible otherwise */
  micDeviceId: string | null
  /** input device carrying the meeting, for the loopback route (BlackHole and
   *  friends). null means screen-capture loopback, which Electron only
   *  supports on Windows — on macOS this is the setting that makes the
   *  meeting side work at all. */
  meetingDeviceId: string | null
  /** Whisper build to transcribe with; ids come from models.json */
  whisperModel: string
  /** seconds the unsure card waits before committing its leader, or null for
   *  "never — wait for me". Four seconds is right for a fast reader watching
   *  the screen; it is not enough for someone watching the interviewer
   *  (REVIEW.md P5). */
  autoPickSec: number | null
}
