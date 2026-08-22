import type { AudioChunk, Segment, Transcriber } from '@shared/types'
import { MODELS_URL_PREFIX } from '@shared/ipc'
import { createMockDriver, type MockDriver } from '../lib/drivers/mock'
import { MeetingAudioSource, MicAudioSource, WorkerEmbeddings } from '../lib/drivers/real'
import { TranscriptionService } from '../lib/drivers/transcription'
import { SessionEngine } from '../lib/engine'
import { EmbeddingCache, nullEmbeddings } from '../lib/embeddings'
import { createStripPublisher, deriveStripState } from '../lib/strip'
import { LivenessGate, MeterBallistics, dbfs, rms } from '../lib/dsp/level'
import { NoiseFloor } from '../lib/dsp/vad'
import { TUNING } from '@shared/tuning'
import { api } from '../lib/api'
import { useAudioStore } from '../state/audioStore'
import { useBankStore, answersForLoop } from '../state/bankStore'
import { usePanelStore } from '../state/panelStore'
import { useSessionStore } from '../state/sessionStore'
import { useSettingsStore } from '../state/settingsStore'

// Session runtime: owns the capture path (mock or real), the transcribers and
// the engine, and keeps the Electron window frame in sync with the view.
// Containers call the exported commands; everything else flows through stores.

const MOCK = api.env.mock
/** real Electron (preload present) vs the browser shim — window plumbing only
 *  exists in Electron, even when the session itself is mocked */
const IN_ELECTRON = typeof window !== 'undefined' && window.api !== undefined

let driver: MockDriver | null = null
let engine: SessionEngine | null = null
let stopPlayback: (() => void) | null = null
let realSources: { meeting: MeetingAudioSource; mic: MicAudioSource } | null = null
let audioPrepared = false

// ---- capture watchdog ------------------------------------------------------
// A source can die without any event reaching us (REVIEW.md C4): the one
// symptom is chunks stopping. Track the last arrival per stream; a started
// source that goes quiet for watchdogStallMs gets a visible error and one
// automatic re-acquire attempt.
const WATCHDOG_STALL_MS = 5000
const WATCHDOG_RESTART_COOLDOWN_MS = 15000
const lastChunkAt = { meeting: 0, mic: 0 }
const stalled = { meeting: false, mic: false }
let watchdogTimer: ReturnType<typeof setInterval> | null = null
let watchdogRestartAt = 0

function noteChunk(stream: 'meeting' | 'mic'): void {
  lastChunkAt[stream] = Date.now()
  if (stalled[stream]) {
    stalled[stream] = false
    const audio = useAudioStore.getState()
    audio.setError(stream, null)
    if (audio.pipelineNotice?.includes('stopped arriving')) audio.setPipelineNotice(null)
  }
}

function startWatchdog(): void {
  if (watchdogTimer) return
  watchdogTimer = setInterval(() => {
    if (!realSources) return
    const now = Date.now()
    for (const stream of ['meeting', 'mic'] as const) {
      const status = useAudioStore.getState()[stream]
      if (status.state === 'no-track' || status.state === 'idle') continue
      if (lastChunkAt[stream] === 0 || now - lastChunkAt[stream] <= WATCHDOG_STALL_MS) continue
      if (!stalled[stream]) {
        stalled[stream] = true
        const name = stream === 'meeting' ? 'Meeting audio' : 'Microphone audio'
        useAudioStore
          .getState()
          .setError(stream, 'audio stopped arriving — device lost, or the machine slept.')
        useAudioStore
          .getState()
          .setPipelineNotice(`${name} stopped arriving — check the device (⌘⇧D for details).`)
      }
      if (now - watchdogRestartAt > WATCHDOG_RESTART_COOLDOWN_MS) {
        watchdogRestartAt = now
        restartAudio()
      }
    }
  }, 2000)
}

function stopWatchdog(): void {
  if (watchdogTimer) clearInterval(watchdogTimer)
  watchdogTimer = null
  lastChunkAt.meeting = 0
  lastChunkAt.mic = 0
  stalled.meeting = false
  stalled.mic = false
}

/**
 * The on-device models, loaded once and kept.
 *
 * These used to be created inside startSession, which meant the first minute
 * of every interview ran while ~145MB of Whisper and MiniLM were still loading
 * from cold: utterances queued behind the load and were dropped past the cap,
 * and until MiniLM was warm the matcher had no embeddings at all and fell back
 * to bigram Dice. The opening question — usually the one you most want the
 * card up for — was the one least likely to work.
 *
 * They load on the setup screen instead, while the user is choosing a
 * placement, and transcription stays *disabled* until a session arms. Warm
 * model, idle pipeline: nothing said in front of the setup screen is
 * transcribed.
 */
let models: {
  transcription: TranscriptionService
  embeddings: WorkerEmbeddings
  cache: EmbeddingCache
  modelId: string
} | null = null

export function getEngine(): SessionEngine | null {
  return engine
}

/**
 * Per-stream level pipeline: raw block RMS → meter ballistics → hysteretic
 * liveness → throttled publish.
 *
 * Chunks arrive ~23×/sec per stream. Writing each one straight to the store
 * re-rendered the whole setup screen ~47×/sec and, worse, drove the status dot
 * from an instantaneous 42ms window — so it flipped on every inter-word gap
 * and read as activity even for a source that was never working.
 */
function createLevelMeter(stream: 'meeting' | 'mic'): (samples: Float32Array) => void {
  const ballistics = new MeterBallistics(TUNING.levelReleasePerSec)
  const gate = new LivenessGate({
    openLevel: TUNING.levelOpen,
    closeLevel: TUNING.levelClose,
    holdMs: TUNING.levelHoldMs
  })
  // the same estimator the segmenter runs, fed at the same 20ms cadence, so
  // the floor shown in diagnostics is the floor transcription is actually
  // gating against rather than a lookalike
  const floor = new NoiseFloor()
  const frameSize = Math.round((TUNING.asrSampleRate * TUNING.vadFrameMs) / 1000)
  let live = false
  let lastPublishedAt = -Infinity
  let lastState: string | null = null

  return (samples: Float32Array) => {
    const now = Date.now()
    let maxFrameDb = -120
    for (let i = 0; i + frameSize <= samples.length; i += frameSize) {
      const db = dbfs(rms(samples.subarray(i, i + frameSize)))
      if (db > maxFrameDb) maxFrameDb = db
      floor.update(db, live)
    }
    const level = ballistics.push(rms(samples), now)
    // liveness follows the same adaptive gate the segmenter uses, so the dot
    // can never say "silent" about a mic that transcribes fine, or "live"
    // about one below the speech threshold (REVIEW.md L5). Same hysteresis and
    // hold, just in dB against the moving floor.
    const openAtDb = Math.max(floor.value + TUNING.vadOpenDb, TUNING.vadAbsoluteOpenDbfs)
    const closeAtDb = floor.value + TUNING.vadCloseDb
    live = gate.update(maxFrameDb, now, openAtDb, closeAtDb)
    const state = live ? 'live' : 'silent'
    // publish on a material state change immediately, otherwise at ~10Hz
    if (state === lastState && now - lastPublishedAt < TUNING.levelPublishMinIntervalMs) return
    lastPublishedAt = now
    lastState = state
    const current = useAudioStore.getState()[stream]
    // a capture failure owns the state until it clears — never overwrite
    // 'no-track' with 'silent', which is what made a dead source look alive
    if (current.state === 'no-track') return
    useAudioStore.getState().publish(stream, { level, state, floorDbfs: floor.value })
  }
}

/** single-subscriber Transcriber → fan-out, so the engine and the runtime can
 *  both observe segments */
function tee(t: Transcriber): Transcriber & { subscribe(cb: (s: Segment) => void): void } {
  const subs: ((s: Segment) => void)[] = []
  t.onSegment((s) => subs.forEach((cb) => cb(s)))
  return {
    push: (c) => t.push(c),
    onSegment: (cb) => subs.push(cb),
    subscribe: (cb) => subs.push(cb)
  }
}

// ---- session clock ---------------------------------------------------------
// Each capture source counts time from its own first sample, which is right
// for the resampler and wrong for the session: capture starts on the setup
// screen, and pausing or switching device restarts the counter from zero. The
// engine's clock is monotonic (`max`), so a counter that jumped backwards
// would freeze it and hand the recap nonsense durations.

const capture = {
  meeting: { base: 0, last: 0, zero: 0 },
  mic: { base: 0, last: 0, zero: 0 }
}

function stampClock(stream: 'meeting' | 'mic', c: AudioChunk): AudioChunk {
  const s = capture[stream]
  s.last = c.t
  return { ...c, t: Math.max(0, s.base + c.t - s.zero) }
}

/** capture stopped: fold what it counted into the running total */
function parkClock(): void {
  for (const s of [capture.meeting, capture.mic]) {
    s.base += s.last
    s.last = 0
  }
}

/** t=0 is the moment the session starts, not the moment capture did */
function zeroClock(atSessionStart: boolean): void {
  for (const s of [capture.meeting, capture.mic]) {
    if (atSessionStart) s.zero = s.base + s.last
    else {
      s.base = 0
      s.last = 0
      s.zero = 0
    }
  }
}

/** "live, but zero segments" is the signature of audio arriving and never
 *  surviving transcription — the one failure diagnostics can't infer from
 *  levels alone, so the count has to come from the transcriber itself */
function countSegments(
  t: { subscribe(cb: (s: Segment) => void): void },
  stream: 'meeting' | 'mic'
): void {
  t.subscribe((s) => {
    if (s.confirmed) useAudioStore.getState().countSegment(stream)
  })
}

/** start the capture sources so the setup screen's dots/meters go live */
export function prepareAudio(): void {
  if (audioPrepared) return
  audioPrepared = true
  const audio = useAudioStore.getState()
  const meetingMeter = createLevelMeter('meeting')
  const micMeter = createLevelMeter('mic')
  if (MOCK) {
    driver = createMockDriver()
    driver.meetingSource.onChunk((c) => meetingMeter(c.samples))
    driver.micSource.onChunk((c) => micMeter(c.samples))
    driver.meetingSource.start()
    driver.micSource.start()
    // once per DRIVER, not per session — control handlers accumulate, and a
    // second dry run used to apply every scripted pin/end twice (REVIEW.md L14)
    wireControlEvents(driver)
    audio.setLabels({ meeting: 'Meeting audio · Google Meet tab', mic: 'Your mic · MacBook Pro' })
    return
  }
  const settings = useSettingsStore.getState()
  realSources = {
    meeting: new MeetingAudioSource(settings.meetingDeviceId),
    mic: new MicAudioSource(settings.micDeviceId)
  }
  realSources.meeting.onChunk((c) => {
    noteChunk('meeting')
    meetingMeter(c.samples)
    models?.transcription.push('them', stampClock('meeting', c))
  })
  realSources.mic.onChunk((c) => {
    noteChunk('mic')
    micMeter(c.samples)
    models?.transcription.push('you', stampClock('mic', c))
  })
  // the device's real name, straight off the track — a default input that
  // switched to a narrowband headset is otherwise completely invisible
  realSources.meeting.onDevice((label) =>
    useAudioStore.getState().publish('meeting', { deviceLabel: `Meeting audio · ${label}` })
  )
  realSources.mic.onDevice((label) =>
    useAudioStore.getState().publish('mic', { deviceLabel: `Your mic · ${label}` })
  )
  // failures land in the store; the setup row's why-line carries them and the
  // dot goes red (never amber, which could be mistaken for "merely quiet")
  realSources.meeting.onError((e) => useAudioStore.getState().setError('meeting', e.message))
  realSources.mic.onError((e) => useAudioStore.getState().setError('mic', e.message))
  realSources.mic.start()
  realSources.meeting.start()
  startWatchdog()
  // labels arrive with the track, so the picker needs a refresh once
  // permission has actually been granted
  void useAudioStore.getState().refreshDevices()
  ensureModels()
}

/**
 * Load the on-device models and warm the bank, without transcribing anything.
 *
 * Idempotent, except when the chosen Whisper tier changes — switching model on
 * the setup screen has to actually take effect, so the old worker is torn down
 * and a new one loads.
 */
export function ensureModels(): void {
  if (MOCK) return
  const modelId = useSettingsStore.getState().whisperModel
  if (models && models.modelId !== modelId) {
    models.transcription.dispose()
    models.embeddings.dispose()
    models = null
  }
  if (models) return
  // main serves userData/models over the privileged scheme; the browser build
  // never reaches this branch
  const modelPath = IN_ELECTRON ? MODELS_URL_PREFIX : 'models'
  const transcription = new TranscriptionService(modelPath, modelId)
  const embeddings = new WorkerEmbeddings(modelPath)
  const cache = new EmbeddingCache(embeddings)
  transcription.onStateChange((state) => {
    useAudioStore.getState().publish('mic', {})
    const audio = useAudioStore.getState()
    if (state === 'failed') {
      // mid-session, try to bring a crashed worker back before telling anyone
      // it's over; a persistent load failure gets a permanent visible notice
      // instead of dying in the console (REVIEW.md H2)
      if (engine && transcription.restart()) {
        audio.setPipelineNotice('Transcription crashed — restarting it now…')
      } else {
        audio.setPipelineNotice(
          `The speech model failed to load${transcription.error ? ` — ${transcription.error}` : ''}. Re-download it from the setup screen.`
        )
      }
    } else if (state === 'warm' && audio.pipelineNotice?.startsWith('Transcription crashed')) {
      audio.setPipelineNotice(null)
    }
  })
  // decode errors and falling-behind drops — the worker already narrates
  // these; they just never reached a surface anyone watches
  transcription.onError((message) => useAudioStore.getState().setPipelineNotice(message))
  models = { transcription, embeddings, cache, modelId }
  warmBank()
}

/** embed the active loop's questions, trigger phrases and points ahead of time,
 *  so the first question is matched semantically rather than on bigram overlap */
function warmBank(): void {
  const bank = useBankStore.getState().bank
  if (!bank || !models) return
  const answers = answersForLoop(bank, bank.activeLoopId)
  void models.cache.ensure([
    ...answers.map((a) => a.question),
    ...answers.flatMap((a) => a.triggerPhrases),
    ...answers.flatMap((a) => a.points.map((p) => p.text))
  ])
}

/** what the diagnostics panel reports about the speech model */
export function modelState(): 'loading' | 'warm' | 'failed' | 'idle' {
  return models?.transcription.state ?? 'idle'
}

// Truthful signals for the offline probe (tools/verify/wasm-probe.mjs): "did
// the real pipelines come up on the bundled wasm, without touching the CDN"
// is not observable from a screenshot. Read-only, and embedSmoke embeds one
// throwaway string — nothing here can change app state.
declare global {
  interface Window {
    __lihDebug?: {
      embeddingsReady(): boolean
      transcriberState(): 'loading' | 'warm' | 'failed' | 'idle'
      /** embed one string end-to-end; resolves to the vector length (384) */
      embedSmoke(): Promise<number>
    }
  }
}
if (typeof window !== 'undefined') {
  window.__lihDebug = {
    embeddingsReady: () => models?.embeddings.ready ?? false,
    transcriberState: () => modelState(),
    embedSmoke: async () => {
      const rows = (await models?.embeddings.embed(['offline wasm probe'])) ?? []
      return rows[0]?.length ?? 0
    }
  }
}

/** tear the capture path down. Pause uses this: for an app whose promise is
 *  "audio stays on this machine and nothing is recorded", pausing has to stop
 *  the tracks, not just flip a flag and keep listening. */
export function stopAudio(): void {
  // the mock driver's scripted playback *is* the demo — stopping it would look
  // like a broken app rather than a paused one
  if (MOCK || !realSources) return
  stopWatchdog()
  realSources.meeting.stop()
  realSources.mic.stop()
  realSources = null
  audioPrepared = false
  parkClock()
  const audio = useAudioStore.getState()
  audio.reset('meeting')
  audio.reset('mic')
}

/** picking a different input has to re-acquire — constraints are fixed at
 *  getUserMedia time */
export function restartAudio(): void {
  const wasPrepared = audioPrepared
  stopAudio()
  if (wasPrepared) prepareAudio()
}

// ---- the pre-interview microphone check ------------------------------------
// "Test" used to call requestMicrophone() and do nothing at all when
// permission was already granted, which is the normal case by the time you're
// on that screen. A check that cannot fail is worse than none: it tells you
// everything is fine right up until the interview starts. This one records
// through the real capture path, transcribes with the real model, and shows
// you the words back — the same path that will run during the call.

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** wait up to `ms`, bailing early (false) the moment a session starts — the
 *  session owns the shared pipeline from that point, and the test's cleanup
 *  must not touch it (REVIEW.md C3) */
async function testWait(ms: number): Promise<boolean> {
  const until = Date.now() + ms
  while (Date.now() < until) {
    if (engine) return false
    await delay(Math.min(150, Math.max(1, until - Date.now())))
  }
  return true
}

export async function runMicTest(): Promise<void> {
  const audio = useAudioStore.getState()
  if (audio.micTest.state === 'recording' || audio.micTest.state === 'thinking') return
  if (engine) {
    audio.setMicTest({ state: 'failed', error: 'A session is already running.' })
    return
  }
  audio.resetMicTest()

  if (audio.permissions.microphone !== 'granted') {
    await api.permissions.requestMicrophone()
    await useAudioStore.getState().refreshPermissions()
    if (useAudioStore.getState().permissions.microphone !== 'granted') {
      audio.setMicTest({
        state: 'failed',
        error: 'Microphone permission was not granted, so there is nothing to test.'
      })
      return
    }
  }

  if (MOCK) {
    // the demo build has no microphone and no model — say so rather than
    // inventing a transcript, which is exactly the kind of lie this replaces
    audio.setMicTest({ state: 'recording' })
    await delay(1200)
    audio.setMicTest({
      state: 'failed',
      error: 'This is the demo build — there is no microphone or model to test.'
    })
    return
  }

  const installed = await api.models.status(useSettingsStore.getState().whisperModel)
  if (!installed.whisper) {
    audio.setMicTest({
      state: 'failed',
      error: 'The speech model is not installed yet — download it first.'
    })
    return
  }

  prepareAudio()
  // a source that never opened would spend 25 seconds arriving at "heard
  // nothing", which names the symptom and hides the cause
  const micState = useAudioStore.getState().mic
  if (micState.state === 'no-track') {
    audio.setMicTest({
      state: 'failed',
      error: micState.error ?? 'The microphone did not open. Pick a different input above.'
    })
    return
  }
  ensureModels()
  const svc = models?.transcription
  if (!svc) {
    audio.setMicTest({ state: 'failed', error: 'The speech model is not loaded.' })
    return
  }
  audio.setMicTest({ state: 'recording' })

  // the same warm model the session will use, rather than a throwaway probe:
  // spawning one meant every test paid a cold load inside its own timeout.
  // Only the mic stream opens — decoding meeting audio during the test both
  // wastes the decode budget and can starve the test past its deadline
  // (REVIEW.md L4).
  const heard: string[] = []
  const off = svc.subscribe('you', (s) => {
    if (s.confirmed) heard.push(s.text)
  })
  svc.setEnabled(true, ['you'])

  try {
    if (!(await testWait(TUNING.micTestRecordMs))) return
    useAudioStore.getState().setMicTest({ state: 'thinking' })
    // whatever is mid-sentence still counts — this is a five-second test and
    // losing the tail would report "heard nothing" for a working mic
    svc.flush('you')
    const deadline = Date.now() + TUNING.micTestDecodeMs
    while (heard.length === 0 && Date.now() < deadline) {
      if (!(await testWait(150))) return
    }
    const text = heard.join(' ').trim()
    useAudioStore.getState().setMicTest(
      text
        ? { state: 'done', text, error: null }
        : {
            state: 'failed',
            error:
              'Heard nothing. Check the input device above, move closer, or raise the input level in System Settings → Sound.'
          }
    )
  } catch (err) {
    useAudioStore.getState().setMicTest({
      state: 'failed',
      error: err instanceof Error ? err.message : String(err)
    })
  } finally {
    off()
    // A session that started mid-test owns the pipeline now — disabling it
    // here was REVIEW.md C3: the test's cleanup landed up to 25s after arming
    // and silently killed transcription for the whole interview.
    if (!engine) {
      svc.setEnabled(false, ['you'])
    } else if (useAudioStore.getState().micTest.state !== 'done') {
      useAudioStore.getState().setMicTest({ state: 'idle', text: null, error: null })
    }
  }
}

/** wire a mock driver's control events to the same commands the shortcuts use */
function wireControlEvents(d: MockDriver): void {
  d.onControl((e) => {
    const panel = usePanelStore.getState()
    switch (e.kind) {
      case 'find-open':
        panel.openFind()
        break
      case 'find-query':
        panel.setFindQuery(e.query)
        break
      case 'find-pin':
        engine?.pinEntry(e.entryId)
        panel.closeFind()
        break
      case 'collapse':
        setCollapsed(true)
        break
      case 'expand':
        setCollapsed(false)
        break
      case 'end':
        void endSession()
        break
    }
  })
}

/** first activation flips armed → live; keep the Electron frame in sync */
let viewSyncStarted = false
function startViewSync(): void {
  if (viewSyncStarted) return
  viewSyncStarted = true
  let lastView = usePanelStore.getState().view
  usePanelStore.subscribe((s) => {
    if (s.view !== lastView) {
      lastView = s.view
      void api.windows.setView(s.view, { placement: useSettingsStore.getState().placement })
    }
  })
  let lastMatchKey = ''
  useSessionStore.subscribe((s) => {
    const m = s.match
    const key = `${m.state}:${m.entryId ?? ''}`
    if (key === lastMatchKey) return
    lastMatchKey = key
    const panel = usePanelStore.getState()
    const showsAnswer = m.entryId != null || m.state === 'ambiguous'
    if (showsAnswer && (panel.view === 'armed' || panel.view === 'setup') && s.status !== 'idle') {
      panel.setView('live')
    }
  })
}

/** collapse to the share-safe strip (and back) */
export function setCollapsed(collapsed: boolean): void {
  const panel = usePanelStore.getState()
  if (panel.collapsed === collapsed) return
  panel.setCollapsed(collapsed)
  // the strip is its own window whenever we're in Electron — even with the
  // mock driver; only the browser build renders it inline
  if (IN_ELECTRON) void api.windows.showStrip(collapsed)
}

// ---- strip window feed (Electron) ----
// the session lives in this renderer; the strip window renders relayed
// snapshots. Publish only material changes, throttled.

let stripPublisherStop: (() => void) | null = null

function startStripPublisher(): void {
  if (!IN_ELECTRON || stripPublisherStop) return
  const publisher = createStripPublisher({
    send: (s) => api.strip.publish(s),
    minIntervalMs: TUNING.stripPublishMinIntervalMs
  })

  let entryAtCollapse: string | null = null
  let lastCollapsed = usePanelStore.getState().collapsed

  const offer = (): void => {
    const bank = useBankStore.getState().bank
    if (!bank) return
    const session = useSessionStore.getState()
    publisher.offer(
      deriveStripState({
        entries: answersForLoop(bank, session.loopId ?? bank.activeLoopId),
        match: session.match,
        coverage: session.coverage,
        entryAtCollapse,
        protectionOn: useSettingsStore.getState().contentProtection,
        paused: session.status === 'paused'
      })
    )
  }

  const unsubs = [
    usePanelStore.subscribe((s) => {
      if (s.collapsed !== lastCollapsed) {
        lastCollapsed = s.collapsed
        // record what was showing at collapse; anything different later is
        // the "new question" nudge
        entryAtCollapse = s.collapsed ? useSessionStore.getState().match.entryId : null
        offer()
      }
    }),
    useSessionStore.subscribe(offer),
    useSettingsStore.subscribe(offer),
    useBankStore.subscribe(offer)
  ]
  offer()

  stripPublisherStop = () => {
    unsubs.forEach((u) => u())
    publisher.dispose()
    stripPublisherStop = null
  }
}

/** other windows saved the bank — reload so this one isn't stale. Returns the
 *  unsubscribe; App mounts it once per window. */
export function startBankSync(): () => void {
  return api.bank.onChanged(() => void useBankStore.getState().load())
}

export interface StartOptions {
  /** dry runs replay the scripted fixture even in a real-capture build */
  dryRun?: boolean
  /**
   * Rehearse ONE answer against your real microphone: the entry is pinned,
   * points strike through as you say them, and it ends in a one-entry recap
   * that is never written to disk (REVIEW.md P10). Before this, "Practice"
   * replayed the scripted HR fixture — a demo of someone else's interview.
   */
  practiceEntryId?: string
}

export function startSession(opts: StartOptions = {}): void {
  const bank = useBankStore.getState().bank
  if (!bank || engine) return
  const settings = useSettingsStore.getState()
  const session = useSessionStore.getState()
  const useMock = MOCK || opts.dryRun === true
  const practiceEntryId = opts.practiceEntryId ?? null

  if (!useMock) {
    // arming a dead pipeline used to look exactly like a working session
    // (REVIEW.md H2) — refuse, visibly, while there is still time to fix it
    prepareAudio()
    ensureModels()
    if (!models) return
    if (models.transcription.state === 'failed') {
      useAudioStore
        .getState()
        .setPipelineNotice(
          `Not starting${opts.practiceEntryId ? ' practice' : ''}: the speech model failed to load${models.transcription.error ? ` — ${models.transcription.error}` : ''}. Re-download it below, then try again.`
        )
      return
    }
  }

  session.arm(bank.activeLoopId, settings.keepTranscript, practiceEntryId)
  zeroClock(true)
  startViewSync()
  // a latent ⌘K pressed on the setup screen must not pop the overlay the
  // moment the armed card mounts (REVIEW.md M20)
  usePanelStore.getState().closeFind()
  // session shortcuts are registered only for the session's span; an
  // accelerator another app holds is reported, not silently dead (H15/M19)
  void api.session.setActive(true).then(({ failedShortcuts }) => {
    if (failedShortcuts.length > 0) {
      useAudioStore
        .getState()
        .setPipelineNotice(
          `${failedShortcuts.join(', ')} is held by another app — the shortcut works only while this panel is focused.`
        )
    }
  })

  if (useMock) {
    if (!driver) {
      driver = createMockDriver()
      const meetingMeter = createLevelMeter('meeting')
      const micMeter = createLevelMeter('mic')
      driver.meetingSource.onChunk((c) => meetingMeter(c.samples))
      driver.micSource.onChunk((c) => micMeter(c.samples))
      driver.meetingSource.start()
      driver.micSource.start()
      // once per DRIVER, not per session — a second dry run used to apply
      // every scripted pin/end twice (REVIEW.md L14)
      wireControlEvents(driver)
    }
    const d = driver
    const them = tee(d.meetingTranscriber)
    const you = tee(d.micTranscriber)
    countSegments(them, 'meeting')
    countSegments(you, 'mic')
    engine = new SessionEngine(them, you, nullEmbeddings())
    // the fixture knows which phrase each question matched on — apply it to the
    // transcript entry when the engine's trigger-substring pass didn't
    them.subscribe((seg) => {
      if (!seg.confirmed) return
      const hl = d.highlightFor(seg.text)
      if (!hl) return
      const st = useSessionStore.getState()
      let idx = -1
      for (let i = st.transcript.length - 1; i >= 0; i--) {
        if (st.transcript[i].speaker === 'them' && st.transcript[i].text === seg.text) {
          idx = i
          break
        }
      }
      if (idx >= 0 && !st.transcript[idx].highlight) {
        const transcript = [...st.transcript]
        transcript[idx] = { ...transcript[idx], highlight: hl }
        useSessionStore.setState({ transcript })
      }
      // the recap excerpt reads from the engine's own keep, not the UI ring
      engine?.noteHighlight(seg.text, hl)
    })
    stopPlayback = d.play()
  } else {
    const m = models
    if (!m) return
    // already loaded (and the bank warmed) from the setup screen — arming
    // just opens the gate
    m.transcription.clearSubscribers()
    const them = tee(m.transcription.transcriberFor('them'))
    const you = tee(m.transcription.transcriberFor('you'))
    countSegments(them, 'meeting')
    countSegments(you, 'mic')
    engine = new SessionEngine(them, you, m.cache)
    warmBank() // the active loop may have changed since the models loaded
    if (practiceEntryId) {
      // rehearsal: your microphone only. There is no interviewer to listen
      // to, and nothing to match — the answer under practice is pinned.
      m.transcription.setEnabled(true, ['you'])
      engine.pinEntry(practiceEntryId)
    } else {
      m.transcription.setEnabled(true)
    }
  }

  usePanelStore.getState().setView('armed')
  startStripPublisher()
  usePanelStore.getState().setCollapsed(settings.placement === 'strip')
  if (settings.placement === 'strip' && IN_ELECTRON) void api.windows.showStrip(true)
}

export async function endSession(): Promise<void> {
  stopPlayback?.()
  stopPlayback = null
  void api.session.setActive(false)
  try {
    if (engine) {
      const e = engine
      engine = null
      await e.end() // flips the view to recap; a failed save surfaces THERE
    }
  } finally {
    // capture teardown runs no matter what end() hit — a save error used to
    // leave the mic hot on the live view after the user ended the interview
    // (REVIEW.md M5)
    // the models stay loaded: a second session in the same run should cost
    // nothing, and disposing them here is what made every arm pay a cold start
    models?.transcription.setEnabled(false)
    models?.transcription.clearSubscribers()
    zeroClock(false)
    stripPublisherStop?.()
    usePanelStore.getState().setCollapsed(false)
    if (IN_ELECTRON) void api.windows.showStrip(false)
  }
}

/** ⌘⇧R: during a session this IS the session end; idle, it reopens the last
 *  recap. Ending takes TWO presses within 2s — ⌘⇧R is also the browsers'
 *  hard-reload chord, and a single reflexive press in a flaky CoderPad tab
 *  used to end the interview session instantly (REVIEW.md H17). */
const RECAP_CONFIRM_NOTICE = 'Press ⌘⇧R again to end the session and open the recap.'
let recapConfirmTimer: ReturnType<typeof setTimeout> | null = null

export function recapCommand(): void {
  const s = useSessionStore.getState()
  if (s.status === 'armed' || s.status === 'listening' || s.status === 'paused') {
    if (recapConfirmTimer) {
      clearTimeout(recapConfirmTimer)
      recapConfirmTimer = null
      if (useAudioStore.getState().pipelineNotice === RECAP_CONFIRM_NOTICE) {
        useAudioStore.getState().setPipelineNotice(null)
      }
      void endSession()
      return
    }
    useAudioStore.getState().setPipelineNotice(RECAP_CONFIRM_NOTICE)
    recapConfirmTimer = setTimeout(() => {
      recapConfirmTimer = null
      if (useAudioStore.getState().pipelineNotice === RECAP_CONFIRM_NOTICE) {
        useAudioStore.getState().setPipelineNotice(null)
      }
    }, 2000)
  } else if (s.lastSession) {
    usePanelStore.getState().setView('recap')
  }
}

/**
 * Pause used to flip a status flag and nothing else: the engine dropped the
 * segments but the microphone stayed open the whole time. For an app that
 * promises "audio stays on this machine and nothing is recorded", pause has to
 * actually close the tracks — and the meters going dark is the honest signal
 * that it did.
 */
export function pauseSession(): void {
  const s = useSessionStore.getState()
  if (s.status === 'paused') {
    engine?.resume()
    s.setStatus(s.match.entryId ? 'listening' : 'armed')
    prepareAudio()
    models?.transcription.setEnabled(true)
    return
  }
  if (s.status === 'armed' || s.status === 'listening') {
    // tell the engine first: it notes the pause clock (so the flushed
    // mid-sentence tail is still accepted, REVIEW.md M6) and stops the
    // auto-pick/deferred-swap timers (REVIEW.md M4)
    engine?.pause()
    s.setStatus('paused')
    // anything mid-sentence still belongs in the transcript
    models?.transcription.setEnabled(false) // flushes what was mid-sentence
    stopAudio()
  }
}
