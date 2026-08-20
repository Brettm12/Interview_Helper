import type { AudioChunk, Segment, Transcriber } from '@shared/types'
import { MODELS_URL_PREFIX } from '@shared/ipc'
import { createMockDriver, type MockDriver } from '../lib/drivers/mock'
import {
  MeetingAudioSource,
  MicAudioSource,
  WhisperTranscriber,
  WorkerEmbeddings
} from '../lib/drivers/real'
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
let realTranscribers: { them: WhisperTranscriber; you: WhisperTranscriber } | null = null
let realEmbeddings: WorkerEmbeddings | null = null
let audioPrepared = false

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
    for (let i = 0; i + frameSize <= samples.length; i += frameSize) {
      floor.update(dbfs(rms(samples.subarray(i, i + frameSize))), live)
    }
    const level = ballistics.push(rms(samples), now)
    live = gate.update(level, now)
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
    audio.setLabels({ meeting: 'Meeting audio · Google Meet tab', mic: 'Your mic · MacBook Pro' })
    return
  }
  const settings = useSettingsStore.getState()
  realSources = {
    meeting: new MeetingAudioSource(settings.meetingDeviceId),
    mic: new MicAudioSource(settings.micDeviceId)
  }
  realSources.meeting.onChunk((c) => {
    meetingMeter(c.samples)
    realTranscribers?.them.push(stampClock('meeting', c))
  })
  realSources.mic.onChunk((c) => {
    micMeter(c.samples)
    // a copy, and *before* the session transcriber: push() transfers the
    // buffer, so whoever goes second would be handed a detached array
    if (micTestSink) micTestSink({ ...c, samples: c.samples.slice() })
    realTranscribers?.you.push(stampClock('mic', c))
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
  // labels arrive with the track, so the picker needs a refresh once
  // permission has actually been granted
  void useAudioStore.getState().refreshDevices()
}

/** tear the capture path down. Pause uses this: for an app whose promise is
 *  "audio stays on this machine and nothing is recorded", pausing has to stop
 *  the tracks, not just flip a flag and keep listening. */
export function stopAudio(): void {
  // the mock driver's scripted playback *is* the demo — stopping it would look
  // like a broken app rather than a paused one
  if (MOCK || !realSources) return
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

let micTestSink: ((c: AudioChunk) => void) | null = null

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export async function runMicTest(): Promise<void> {
  const audio = useAudioStore.getState()
  if (audio.micTest.state === 'recording' || audio.micTest.state === 'thinking') return
  if (realTranscribers) {
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

  const models = await api.models.status(useSettingsStore.getState().whisperModel)
  if (!models.whisper) {
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
  audio.setMicTest({ state: 'recording' })

  const modelPath = IN_ELECTRON ? MODELS_URL_PREFIX : 'models'
  const probe = new WhisperTranscriber('you', modelPath, useSettingsStore.getState().whisperModel)
  const heard: string[] = []
  probe.onSegment((s) => {
    if (s.confirmed) heard.push(s.text)
  })
  micTestSink = (c) => probe.push(c)

  try {
    await delay(TUNING.micTestRecordMs)
    micTestSink = null
    useAudioStore.getState().setMicTest({ state: 'thinking' })
    // whatever is mid-sentence still counts — this is a five-second test and
    // losing the tail would report "heard nothing" for a working mic
    probe.flush()
    const deadline = Date.now() + TUNING.micTestDecodeMs
    while (heard.length === 0 && Date.now() < deadline) await delay(150)
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
    micTestSink = null
    probe.dispose()
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
        protectionOn: useSettingsStore.getState().contentProtection
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
}

export function startSession(opts: StartOptions = {}): void {
  const bank = useBankStore.getState().bank
  if (!bank || engine) return
  const settings = useSettingsStore.getState()
  const session = useSessionStore.getState()
  const useMock = MOCK || opts.dryRun === true

  session.arm(bank.activeLoopId, settings.keepTranscript)
  zeroClock(true)
  startViewSync()

  if (useMock) {
    if (!driver) {
      driver = createMockDriver()
      const meetingMeter = createLevelMeter('meeting')
      const micMeter = createLevelMeter('mic')
      driver.meetingSource.onChunk((c) => meetingMeter(c.samples))
      driver.micSource.onChunk((c) => micMeter(c.samples))
      driver.meetingSource.start()
      driver.micSource.start()
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
    })
    wireControlEvents(d)
    stopPlayback = d.play()
  } else {
    prepareAudio()
    // main serves userData/models over the privileged scheme; the browser
    // build never reaches this branch
    const modelPath = IN_ELECTRON ? MODELS_URL_PREFIX : 'models'
    realTranscribers = {
      them: new WhisperTranscriber('them', modelPath, settings.whisperModel),
      you: new WhisperTranscriber('you', modelPath, settings.whisperModel)
    }
    realEmbeddings = new WorkerEmbeddings(modelPath)
    const cache = new EmbeddingCache(realEmbeddings)
    const them = tee(realTranscribers.them)
    const you = tee(realTranscribers.you)
    countSegments(them, 'meeting')
    countSegments(you, 'mic')
    engine = new SessionEngine(them, you, cache)
    // pre-warm the bank's questions and points while the interviewer is still
    // on small talk
    const answers = bank.answers.filter((a) => a.loopIds.includes(bank.activeLoopId))
    void cache.ensure([
      ...answers.map((a) => a.question),
      ...answers.flatMap((a) => a.points.map((p) => p.text))
    ])
  }

  usePanelStore.getState().setView('armed')
  startStripPublisher()
  usePanelStore.getState().setCollapsed(settings.placement === 'strip')
  if (settings.placement === 'strip' && IN_ELECTRON) void api.windows.showStrip(true)
}

export async function endSession(): Promise<void> {
  stopPlayback?.()
  stopPlayback = null
  if (engine) {
    const e = engine
    engine = null
    await e.end() // saves the record, flips the view to recap
  }
  realTranscribers?.them.dispose()
  realTranscribers?.you.dispose()
  realTranscribers = null
  realEmbeddings?.dispose()
  realEmbeddings = null
  zeroClock(false)
  stripPublisherStop?.()
  usePanelStore.getState().setCollapsed(false)
  if (IN_ELECTRON) void api.windows.showStrip(false)
}

/** ⌘⇧R: during a session this IS the session end; idle, it reopens the last recap */
export function recapCommand(): void {
  const s = useSessionStore.getState()
  if (s.status === 'armed' || s.status === 'listening' || s.status === 'paused') {
    void endSession()
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
    s.setStatus(s.match.entryId ? 'listening' : 'armed')
    prepareAudio()
    return
  }
  if (s.status === 'armed' || s.status === 'listening') {
    s.setStatus('paused')
    // anything mid-sentence still belongs in the transcript
    realTranscribers?.them.flush()
    realTranscribers?.you.flush()
    stopAudio()
  }
}
