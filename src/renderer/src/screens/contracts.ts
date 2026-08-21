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
  points: PointView[]
  onTogglePoint: (id: string) => void
  story: { label: string; body: string; metrics: string[] } | null
  earlier: { question: string; time: string }[]
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
  /** whole seconds remaining, e.g. 4 */
  countdownSec: number
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
  onExport: (format: 'md' | 'json') => void
  /** "Added 12 answers", "Saved to ~/Documents/bank.md" */
  result: string | null
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
  /** which Whisper build transcribes, and the cost of switching */
  model?: {
    options: DeviceOption[]
    value: string
    onChange: (value: string) => void
    /** "~145 MB · noticeably better, still real-time" */
    detail: string
  }
  keepTranscript: boolean
  onToggleTranscript: () => void
  placement: 'docked' | 'strip' | 'second-screen'
  onPlacement: (p: 'docked' | 'strip' | 'second-screen') => void
  /** one-line graceful error, e.g. only one display for second-screen */
  placementError: string | null
  /** on-device models missing → matching runs on the lexical fallback */
  modelsNotice?: string | null
  /** offered next to the notice; null while a download is running or done */
  onDownloadModels?: (() => void) | null
  canStart: boolean
  onStart: () => void
  onEditBank: () => void
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
  onDeleteSession: () => void
  onSaveToLoop: () => void
  onExport: () => void
  onPractice: () => void
}
