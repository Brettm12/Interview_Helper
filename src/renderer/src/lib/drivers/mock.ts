import type { AudioChunk, AudioSource, Segment, Transcriber } from '@shared/types'
import script from '../../fixtures/demo-session.json'

// Mock capture path: replays the scripted session from the JSON fixture with
// realistic (compressed) timing. Implements the same AudioSource/Transcriber
// interfaces as the real path, plus control events (⌘K override, collapse,
// session end) so the whole demo runs hands-free.

export type ControlEvent =
  | { kind: 'find-open'; at: number }
  | { kind: 'find-query'; at: number; query: string }
  | { kind: 'find-pin'; at: number; entryId: string }
  | { kind: 'collapse'; at: number }
  | { kind: 'expand'; at: number }
  | { kind: 'end'; at: number }

interface ScriptEvent {
  delay: number
  kind: string
  at: number
  text?: string
  confirmed?: boolean
  highlight?: string
  query?: string
  entryId?: string
}

const SPEED = Number(import.meta.env.VITE_MOCK_SPEED ?? '1') || 1

export class MockAudioSource implements AudioSource {
  private cb: ((c: AudioChunk) => void) | null = null
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(private stream: 'meeting' | 'mic') {}

  start(): void {
    // synthesize a gently varying level so the setup meters look alive
    let t = 0
    this.timer = setInterval(() => {
      t += 0.35
      const level = 0.25 + 0.22 * Math.abs(Math.sin(t + (this.stream === 'mic' ? 1.3 : 0)))
      const samples = new Float32Array(128).fill(level)
      this.cb?.({ stream: this.stream, samples, sampleRate: 16000, t: Date.now() })
    }, 180)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  onChunk(cb: (c: AudioChunk) => void): void {
    this.cb = cb
  }
}

export class MockTranscriber implements Transcriber {
  private cb: ((s: Segment) => void) | null = null

  constructor(private speaker: 'you' | 'them') {}

  push(_chunk: AudioChunk): void {
    // the mock ignores audio — segments come from the script
  }

  onSegment(cb: (s: Segment) => void): void {
    this.cb = cb
  }

  /** called by the driver */
  emit(s: Segment): void {
    this.cb?.(s)
  }
}

export interface MockDriver {
  meetingSource: AudioSource
  micSource: AudioSource
  meetingTranscriber: MockTranscriber
  micTranscriber: MockTranscriber
  /** the highlight phrase the fixture attaches to a segment, keyed by text */
  highlightFor(text: string): string | undefined
  onControl(cb: (e: ControlEvent) => void): void
  /** begin playback; returns a stop function */
  play(): () => void
}

export function createMockDriver(): MockDriver {
  const meetingTranscriber = new MockTranscriber('them')
  const micTranscriber = new MockTranscriber('you')
  const controlSubs: ((e: ControlEvent) => void)[] = []
  const highlights = new Map<string, string>()
  for (const e of script.events as ScriptEvent[]) {
    if (e.text && e.highlight) highlights.set(e.text, e.highlight)
  }

  let stopped = false
  let timer: ReturnType<typeof setTimeout> | null = null

  const play = () => {
    stopped = false
    const events = script.events as ScriptEvent[]
    let i = 0
    const step = () => {
      if (stopped || i >= events.length) return
      const e = events[i++]
      timer = setTimeout(() => {
        if (stopped) return
        if (e.kind === 'them' || e.kind === 'you') {
          const seg: Segment = {
            speaker: e.kind,
            text: e.text ?? '',
            confirmed: e.confirmed ?? true,
            t: e.at
          }
          if (e.kind === 'them') meetingTranscriber.emit(seg)
          else micTranscriber.emit(seg)
        } else {
          const ev = { kind: e.kind, at: e.at, query: e.query, entryId: e.entryId } as ControlEvent
          controlSubs.forEach((cb) => cb(ev))
        }
        step()
      }, e.delay / SPEED)
    }
    step()
    return () => {
      stopped = true
      if (timer) clearTimeout(timer)
    }
  }

  return {
    meetingSource: new MockAudioSource('meeting'),
    micSource: new MockAudioSource('mic'),
    meetingTranscriber,
    micTranscriber,
    highlightFor: (text) => highlights.get(text),
    onControl: (cb) => controlSubs.push(cb),
    play
  }
}
