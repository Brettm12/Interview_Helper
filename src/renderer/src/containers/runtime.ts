import type { AudioSource, Segment, Transcriber } from '@shared/types'
import { createMockDriver, type MockDriver } from '../lib/drivers/mock'
import {
  MeetingAudioSource,
  MicAudioSource,
  WhisperTranscriber,
  WorkerEmbeddings
} from '../lib/drivers/real'
import { SessionEngine } from '../lib/engine'
import { EmbeddingCache, nullEmbeddings } from '../lib/embeddings'
import { api } from '../lib/api'
import { useAudioStore } from '../state/audioStore'
import { useBankStore } from '../state/bankStore'
import { usePanelStore } from '../state/panelStore'
import { useSessionStore } from '../state/sessionStore'
import { useSettingsStore } from '../state/settingsStore'

// Session runtime: owns the capture path (mock or real), the transcribers and
// the engine, and keeps the Electron window frame in sync with the view.
// Containers call the exported commands; everything else flows through stores.

const MOCK = api.env.mock

let driver: MockDriver | null = null
let engine: SessionEngine | null = null
let stopPlayback: (() => void) | null = null
let realSources: { meeting: AudioSource; mic: AudioSource } | null = null
let realTranscribers: { them: WhisperTranscriber; you: WhisperTranscriber } | null = null
let realEmbeddings: WorkerEmbeddings | null = null
let audioPrepared = false

export function getEngine(): SessionEngine | null {
  return engine
}

function rms(samples: Float32Array): number {
  let sum = 0
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i]
  return Math.sqrt(sum / samples.length)
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
  if (MOCK) {
    driver = createMockDriver()
    driver.meetingSource.onChunk((c) => useAudioStore.getState().setLevel('meeting', rms(c.samples)))
    driver.micSource.onChunk((c) => useAudioStore.getState().setLevel('mic', rms(c.samples)))
    driver.meetingSource.start()
    driver.micSource.start()
    audio.setLabels({ meeting: 'Meeting audio · Google Meet tab', mic: 'Your mic · MacBook Pro' })
    return
  }
  realSources = { meeting: new MeetingAudioSource(), mic: new MicAudioSource() }
  realSources.meeting.onChunk((c) => {
    useAudioStore.getState().setLevel('meeting', rms(c.samples))
    realTranscribers?.them.push(c)
  })
  realSources.mic.onChunk((c) => {
    useAudioStore.getState().setLevel('mic', rms(c.samples))
    realTranscribers?.you.push(c)
  })
  // failures leave the level at 0 → amber dot + fix instruction on setup
  try {
    realSources.mic.start()
  } catch {
    /* dot stays amber */
  }
  try {
    realSources.meeting.start()
  } catch {
    /* dot stays amber */
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
  if (!MOCK) void api.windows.showStrip(collapsed)
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
      driver.meetingSource.onChunk((c) =>
        useAudioStore.getState().setLevel('meeting', rms(c.samples))
      )
      driver.micSource.onChunk((c) => useAudioStore.getState().setLevel('mic', rms(c.samples)))
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
    const modelPath = 'models' // resolved by the transformer env inside the worker
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
  usePanelStore.getState().setCollapsed(settings.placement === 'strip')
  if (settings.placement === 'strip' && !MOCK) void api.windows.showStrip(true)
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
  usePanelStore.getState().setCollapsed(false)
  if (!MOCK) void api.windows.showStrip(false)
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
