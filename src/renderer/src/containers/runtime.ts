import type { Segment, Transcriber } from '@shared/types'
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
import { LivenessGate, MeterBallistics, rms } from '../lib/dsp/level'
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
  let lastPublishedAt = -Infinity
  let lastState: string | null = null

  return (samples: Float32Array) => {
    const now = Date.now()
    const level = ballistics.push(rms(samples), now)
    const live = gate.update(level, now)
    const state = live ? 'live' : 'silent'
    // publish on a material state change immediately, otherwise at ~10Hz
    if (state === lastState && now - lastPublishedAt < TUNING.levelPublishMinIntervalMs) return
    lastPublishedAt = now
    lastState = state
    const current = useAudioStore.getState()[stream]
    // a capture failure owns the state until it clears — never overwrite
    // 'no-track' with 'silent', which is what made a dead source look alive
    if (current.state === 'no-track') return
    useAudioStore.getState().publish(stream, { level, state })
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
  realSources = { meeting: new MeetingAudioSource(), mic: new MicAudioSource() }
  realSources.meeting.onChunk((c) => {
    meetingMeter(c.samples)
    realTranscribers?.them.push(c)
  })
  realSources.mic.onChunk((c) => {
    micMeter(c.samples)
    realTranscribers?.you.push(c)
  })
  // failures land in the store; the setup row's why-line carries them and the
  // dot stays amber (level never rises)
  realSources.meeting.onError((e) => useAudioStore.getState().setError('meeting', e.message))
  realSources.mic.onError((e) => useAudioStore.getState().setError('mic', e.message))
  realSources.mic.start()
  realSources.meeting.start()
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
      them: new WhisperTranscriber('them', modelPath),
      you: new WhisperTranscriber('you', modelPath)
    }
    realEmbeddings = new WorkerEmbeddings(modelPath)
    const cache = new EmbeddingCache(realEmbeddings)
    engine = new SessionEngine(realTranscribers.them, realTranscribers.you, cache)
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

export function pauseSession(): void {
  const s = useSessionStore.getState()
  if (s.status === 'paused') s.setStatus(s.match.entryId ? 'listening' : 'armed')
  else if (s.status === 'armed' || s.status === 'listening') s.setStatus('paused')
}
