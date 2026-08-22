// Prop contracts for every screen component. Screens are dumb/presentational:
// all data arrives as props, all behaviour leaves as callbacks. Containers
// (state layer) bind these to the stores. Do not add store imports to screens.

// ---- live panel -------------------------------------------------------------

export interface TranscriptLineView {
  speaker: 'you' | 'them'
  text: string
  /** exact substring of `text` to render highlighted (matched phrase) */
  highlight?: string
  /** number of trailing words still unconfirmed (render at opacity .45) */
  trailingWords?: number
}

export interface PointView {
  id: string
  text: string
  state: 'covered' | 'current' | 'upcoming'
}

export interface MatchedBodyProps {
  question: string
  covered: number
  total: number
  /** "2:40 on this one" once this answer has run long — null below the
   *  threshold, which is every state the design reference renders
   *  (REVIEW.md P9) */
  pacing?: string | null
  points: PointView[]
  onTogglePoint: (id: string) => void
  story: { label: string; body: string; metrics: string[] } | null
  /** questions already asked, most recent first. `onResume` puts that answer
   *  back on the panel after a wrong swap — the data is already on screen, so
   *  the way back should not require typing into ⌘K while someone watches. */
  earlier: { key: string; question: string; time: string; onResume?: () => void }[]
}

export interface UnsureCandidateView {
  entryId: string
  title: string
  /** "4 points · Roadmap freeze story" */
  sub: string
  /** 0–100 */
  pct: number
}

export interface UnsureBodyProps {
  /** the heard phrase, rendered quoted */
  heard: string
  /** ranked, first = leader */
  candidates: UnsureCandidateView[]
  /** whole seconds remaining, e.g. 4 — null when auto-pick is set to "never",
   *  in which case the card waits for a decision (REVIEW.md P5) */
  countdownSec: number | null
  /** 0–100 fill of the auto-pick bar */
  countdownPct: number
  onPick: (entryId: string) => void
  onNone: () => void
  onSearchBank: () => void
}

export interface LivePanelProps {
  mode: 'matched' | 'unsure'
  matched: MatchedBodyProps | null
  unsure: UnsureBodyProps | null
  transcript: TranscriptLineView | null
  transcriptVisible: boolean
  /** the session is paused: pause closes the microphone, so the header must
   *  stop claiming it is listening (REVIEW.md P2) */
  paused?: boolean
  /** a question was heard that matched nothing — what is on screen belongs to
   *  the previous one. Says so and dims; deliberately carries no instruction,
   *  because at this moment the user is improvising under someone's gaze. */
  stale?: boolean
  /** pipeline problem (model failed, audio stalled) — renders a one-line
   *  warning strip; null in every design-reference state */
  notice?: string | null
  onToggleTranscript: () => void
  onFind: () => void
  onCollapse: () => void
  /** unsure-header "Search bank" */
  onSearchBank: () => void
}

/** demo wrapper: the 1428×836 reference frame with the placeholder call area */
export interface MockCallFrameProps {
  headerLeft: string
  timer: string
  /** name pill on the main tile, e.g. "Priya R. · speaking" */
  speakerPill: string
  children: import('react').ReactNode
}

// ---- panic find (⌘K) --------------------------------------------------------

export interface FindResultView {
  entryId: string
  title: string
  /** selected row: the answer's key points, joined with " · " by the screen */
  preview: string[] | null
  /** unselected rows: "3 points · Notifications rollback" */
  sub: string | null
}

export interface FindOverlayProps {
  query: string
  matchCount: number
  results: FindResultView[]
  selectedIndex: number
  onQueryChange: (q: string) => void
  /** click on a specific row pins THAT row — never the current selection,
   *  which is one render behind the click (REVIEW.md C5) */
  onPinEntry: (entryId: string) => void
  /** +1 / −1 */
  onMove: (delta: number) => void
  onPin: () => void
  onClose: () => void
}

// ---- share-safe strip -------------------------------------------------------

export interface StripProps {
  variant: 'current' | 'queued' | 'new-question'
  /** the single line: current point, or "New: <question>" */
  text: string
  /** "3/4" — shown for current/queued */
  counter: string | null
  /** translucent bg + shadow when overlaying a shared surface */
  overlay: boolean
  /** content-protection state, surfaced in the tooltip */
  protectionOn: boolean
  /** the OS cannot exclude windows from capture at all (Linux) — the tooltip
   *  must say so instead of claiming share-safety (REVIEW.md M21) */
  protectionUnsupported?: boolean
  /** session paused, microphone closed — the dot goes grey (REVIEW.md P2) */
  paused?: boolean
  onExpand: () => void
}

// ---- question bank ----------------------------------------------------------

export interface BankRowView {
  id: string
  question: string
  /** "4 points" */
  pointsLabel: string
  /** story title; null with `noStory` unset renders the points-only meta */
  storyTitle: string | null
  /** incomplete entry → amber "no story yet" replaces the meta line */
  noStory?: boolean
}

export interface BankGroupView {
  sectionId: string
  sectionName: string
  rows: BankRowView[]
}

export interface BankDetailProps {
  /** "BEHAVIOURAL · ASKED IN 3 LOOPS" */
  crumb: string
  question: string
  points: { id: string; text: string }[]
  story: { label: string; body: string; metrics: string[]; usedIn: number } | null
  triggers: string[]
  /** "Last used · Castlegate screen, 12 Aug" or null */
  lastUsed: string | null
  /** "Covered 4/4 that time" or null */
  lastUsedRight: string | null
  onEdit: () => void
  onPractice: () => void
  onAddPhrase: (phrase: string) => void
  onRemovePhrase: (phrase: string) => void
}

export interface BankScreenProps {
  /** failure strip: unreadable bank on load, or saves not landing (H8/H9) */
  banner?: string | null
  loops: { id: string; shortName: string }[]
  selectedLoopId: string
  sections: { id: string; name: string; count: number }[]
  storiesCount: number
  answerCount: number
  groups: BankGroupView[]
  selectedAnswerId: string | null
  detail: BankDetailProps | null
  /** when true, pane 3 renders `editorSlot` instead of the detail */
  editing: boolean
  /** the composed <EditorPane> element (kept as a slot so the two stay decoupled) */
  editorSlot: import('react').ReactNode
  searchQuery: string
  onSearch: (q: string) => void
  onSelectLoop: (id: string) => void
  onSelectAnswer: (id: string) => void
  onNewAnswer: () => void
  onImport: () => void
  onStories: () => void
}

// ---- import / export (pane 3) -----------------------------------------------

export interface ImportPreviewView {
  /** "12 questions · 47 points" */
  summary: string
  /** the caveats, each worth reading before committing */
  warnings: string[]
  /** first few questions, so it's obvious the parse understood the notes */
  sample: { question: string; points: number; duplicate: boolean }[]
  /** why nothing could be read */
  problem: string | null
  /** how many would actually be added */
  importable: number
}

export interface ImportPaneProps {
  text: string
  onTextChange: (t: string) => void
  /** null until there is something to preview */
  preview: ImportPreviewView | null
  /** re-importing a bank you already have would double every card */
  skipDuplicates: boolean
  onSkipDuplicates: (skip: boolean) => void
  onImport: () => void
  /** the paste is a complete bank backup — offered as an exact restore that
   *  REPLACES the whole bank (REVIEW.md M9); null when it isn't one */
  onRestore?: (() => void) | null
  onExport: (format: 'md' | 'json') => void
  /** "Added 12 answers", "Saved to ~/Documents/bank.md" */
  result: string | null
  /** the example answers the app ships with are still in the bank, untouched.
   *  They are scored against the interviewer's voice like anything else, so
   *  there has to be a way out of them. Null once none are left. */
  starters?: { count: number; onRemove: () => void } | null
  onClose: () => void
}

// ---- stories library (pane 3) -----------------------------------------------

export interface StoryRowView {
  id: string
  title: string
  /** "3 metrics · used in 4 answers" */
  sub: string
}

export interface StoriesPaneProps {
  rows: StoryRowView[]
  /** the story being edited, or null when just browsing the list */
  draft: { storyId: string | null; title: string; body: string; metrics: string[] } | null
  onSelect: (id: string) => void
  onNew: () => void
  onTitleChange: (t: string) => void
  onBodyChange: (b: string) => void
  onMetricAdd: (m: string) => void
  onMetricRemove: (m: string) => void
  onSave: () => void
  /** delete the story being edited; every answer using it loses the
   *  reference rather than keeping a dangling one. Null while it is new. */
  onDelete?: (() => void) | null
  /** how many answers currently point at the story being edited — deleting a
   *  shared entity should say what it is about to touch */
  draftUsedIn?: number
  onClose: () => void
}

// ---- bank check (pane 3) ----------------------------------------------------

export interface CheckAnswerView {
  entryId: string
  question: string
  onOpen: () => void
}

export interface CheckFindingView {
  id: string
  /** the entry that loses the collision, in its own words */
  question: string
  /** one sentence about what happens live — never a score */
  detail: string
  onMerge: (() => void) | null
  onOpen: () => void
  /** "Merge them" reads wrong for a shared phrase: the fix is to take the
   *  phrase off one of them, which is an edit */
  mergeLabel: string
}

export interface CheckPaneProps {
  /** the pasted question */
  text: string
  onTextChange: (t: string) => void
  /** null until something has been asked */
  result: {
    /** "This one goes straight up", "You would get the pick-one card",
     *  "Nothing would come up" */
    verdict: string
    tone: 'good' | 'unsure' | 'none'
    answers: CheckAnswerView[]
    /** offered when nothing matched — drafts it with the question filled in */
    onAddToBank: (() => void) | null
  } | null
  /** the worst three, each with something to do about it */
  findings: CheckFindingView[]
  /** the encoder is still loading: results would be lexical guesses, so the
   *  pane waits rather than showing a worse answer than the interview will */
  warming: boolean
  /** a session is running — this wants the same model the interview is using */
  blocked: boolean
  entryCount: number
  onClose: () => void
}

// ---- entry editor -----------------------------------------------------------

export interface EditorPaneProps {
  question: string
  points: { id: string; text: string }[]
  /** null → "no story yet" pick state */
  story: { title: string; sub: string } | null
  triggers: string[]
  onQuestionChange: (q: string) => void
  onPointChange: (id: string, text: string) => void
  onPointAdd: (text: string) => void
  onPointRemove: (id: string) => void
  onPointsReorder: (fromIndex: number, toIndex: number) => void
  onTriggerAdd: (t: string) => void
  onTriggerRemove: (t: string) => void
  onSwapStory: () => void
  /** the draft has unsaved changes — Esc asks before discarding them
   *  (REVIEW.md P6) */
  dirty?: boolean
  /** delete this entry for good — absent while drafting a new one, since
   *  there is nothing yet to delete. Two presses, no modal. */
  onDelete?: (() => void) | null
  /** what you actually said when this question came up, one line per breath,
   *  carried in from the recap. Yours only — the interviewer's words never
   *  travel with it. Clicking a line drops it into the points as a draft. */
  excerpt?: string[] | null
  onUseExcerptLine?: (text: string) => void
  /** turn the whole excerpt into a few sayable points, in the user's own
   *  words. Absent when there is nothing to work from. */
  onCondenseExcerpt?: (() => void) | null
  /** the condense pass is running (it warms the encoder on first use) */
  condensing?: boolean
  /** a phrase sitting in the trigger input, uncommitted. The user edits it
   *  down and presses Enter, or ignores it — nothing is written for them. */
  seedTriggerPhrase?: string
  onCancel: () => void
  onSave: () => void
}

// ---- setup + armed ----------------------------------------------------------

export interface AudioRowView {
  /** hearing sound right now → green dot */
  ok: boolean
  /** no audio track at all — a distinct, louder failure than "silent", so a
   *  dead source can't be mistaken for a working one */
  failed: boolean
  title: string
  why: string
}

/** one entry in a source's device picker */
export interface DeviceOption {
  /** '' is the row's default: the system mic, or screen-capture loopback */
  value: string
  label: string
}

/** when present, the row's title becomes a picker. The meeting row needs one
 *  on macOS (its audio has to come from a virtual cable) and the mic row needs
 *  one because a default input can change under you without saying so. */
export interface DevicePickerView {
  options: DeviceOption[]
  value: string
  onChange: (value: string) => void
}

export interface SetupScreenProps {
  eyebrow: string
  title: string
  sub: string
  stats: { answers: number; stories: number; noStory: number }
  meeting: AudioRowView & { levels: number[] | null; picker?: DevicePickerView }
  mic: AudioRowView & { hasSignal: boolean; levels?: number[] | null; picker?: DevicePickerView }
  // There is no speech-model picker. tiny.en used to sit here as a "Fast"
  // option that misses more words — an invitation to make your own interview
  // worse to save 34 MB. It is still the automatic fallback; it is not a
  // choice. If a second model ever earns its place (measured, not assumed),
  // the picker comes back with two options that are both good.
  /** how long the unsure card waits before committing its leader
   *  (REVIEW.md P5) */
  autoPick?: {
    options: DeviceOption[]
    value: string
    onChange: (value: string) => void
    detail: string
  }
  keepTranscript: boolean
  onToggleTranscript: () => void
  /** raise the dimmest text above the design default (REVIEW.md P7) */
  highLegibility?: boolean
  onToggleLegibility?: () => void
  placement: 'docked' | 'strip' | 'second-screen'
  onPlacement: (p: 'docked' | 'strip' | 'second-screen') => void
  /** one-line graceful error, e.g. only one display for second-screen */
  placementError: string | null
  /** persistence failure strip: unreadable bank, or saves not landing (H8/H9) */
  alert?: string | null
  /** on-device models missing → matching runs on the lexical fallback */
  modelsNotice?: string | null
  /** offered next to the notice; null while a download is running or done */
  onDownloadModels?: (() => void) | null
  /** offered next to the notice while a download runs; partial files resume */
  onCancelDownload?: (() => void) | null
  canStart: boolean
  onStart: () => void
  onEditBank: () => void
  /** open the bank check — what a question would match, and which entries the
   *  matcher will confuse. Belongs here because this is the "am I ready"
   *  surface, and it is the last screen before a session arms. */
  onCheckBank?: () => void
  onFixNoStory: () => void
  onTestMic: () => void
  /** "Test" | "Listening…" | "Thinking…" | "Test again" */
  testLabel?: string
  onDryRun: () => void
}

export interface ArmedCardProps {
  /** "23 answers loaded. I'll pull one up the moment they ask." */
  headline: string
  openers: string[]
  statusLeft: string
  onPause: () => void
}

// ---- diagnostics (⌘⇧D) ------------------------------------------------------

export interface DiagnosticSourceView {
  /** "Meeting audio" | "Your mic" */
  name: string
  state: 'idle' | 'no-track' | 'silent' | 'live'
  /** real device name off the MediaStreamTrack, when known */
  device: string | null
  /** "−31 dB" — dB is the unit that makes "too quiet" legible */
  levelDb: string
  /** "−62 dB · speech opens at −53 dB": the room noise estimate and the bar
   *  your voice has to clear. Reading these two next to the level is what
   *  turns "it isn't working" into "you're 8 dB under the threshold". */
  floorDb: string
  /** confirmed transcript segments so far; live with zero segments is the
   *  signature of audio arriving but never getting through transcription */
  segments: number
  error: string | null
}

export interface DiagnosticsPanelProps {
  sources: DiagnosticSourceView[]
  models: {
    whisper: string
    whisperMissing: boolean
    embeddings: string
    embeddingsMissing: boolean
    dir: string
  }
  /** last few transcript lines, newest last */
  transcript: string[]
  /** one plain sentence naming the most likely problem, or that all is well */
  verdict: string
  onClose: () => void
}

// ---- recap ------------------------------------------------------------------

export interface RecapRowView {
  id: string
  /** "08:12" */
  time: string
  question: string
  matched: boolean
  /** "Missed: … · …" | "All 4 points covered" | "Not in your bank" —
   *  already carries the trailing " · transcript off" when applicable */
  subLine: string
  /** transcript wasn't kept → the row doesn't expand */
  transcriptOff: boolean
  /** 0–100, matched rows only */
  coveredPct: number | null
  /** "3/4", matched rows only */
  counter: string | null
  transcript: TranscriptLineView[] | null
  /** unmatched rows: "Add to bank →" */
  onAddToBank: (() => void) | null
}

export interface RecapFixView {
  id: string
  title: string
  why: string
  chip: string
  onAction: () => void
}

export interface RecapScreenProps {
  eyebrow: string
  title: string
  sub: string
  stats: {
    covered: number
    totalPoints: number
    matched: number
    unmatched: number
  }
  rows: RecapRowView[]
  fixes: RecapFixView[]
  /** "Practice the N I missed →"; 0 hides the link */
  practiceCount: number
  /** the final save failed — this recap exists only in memory (REVIEW.md M5) */
  notice?: string | null
  /** nothing about this session was written to disk — a rehearsal or a dry
   *  run — so the storage actions are replaced by a way back. "Save to loop"
   *  here would write a fixture into real interview history. */
  ephemeral?: boolean
  onDone?: () => void
  onDeleteSession: () => void
  onSaveToLoop: () => void
  onExport: () => void
  onPractice: () => void
}
