import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AudioChunk } from '@shared/types'

// TranscriptionService against a stubbed Worker: the per-stream enable gate
// (REVIEW.md L4/C3 — the mic test must be able to open only its own stream and
// its cleanup must not kill a session), error surfacing (H2), and the crash
// restart budget (H2).

class FakeWorker {
  static instances: FakeWorker[] = []
  posted: { msg: Record<string, unknown> }[] = []
  onmessage: ((e: { data: unknown }) => void) | null = null
  onerror: ((e: { message?: string }) => void) | null = null
  terminated = false
  constructor() {
    FakeWorker.instances.push(this)
  }
  postMessage(msg: Record<string, unknown>): void {
    this.posted.push({ msg })
  }
  terminate(): void {
    this.terminated = true
  }
}

function chunk(): AudioChunk {
  return { stream: 'mic', samples: new Float32Array(16), sampleRate: 16000, t: 0 }
}

beforeEach(() => {
  FakeWorker.instances = []
  vi.stubGlobal('Worker', FakeWorker)
})
afterEach(() => {
  vi.unstubAllGlobals()
})

async function makeService() {
  const { TranscriptionService } = await import('@/lib/drivers/transcription')
  return new TranscriptionService('models', 'test-model')
}

const audioMsgs = (w: FakeWorker) => w.posted.filter((p) => p.msg.type === 'audio')

describe('TranscriptionService', () => {
  it('gates audio per stream — the mic test can open only its own stream', async () => {
    const svc = await makeService()
    const w = FakeWorker.instances[0]

    svc.push('you', chunk())
    expect(audioMsgs(w)).toHaveLength(0) // disabled: nothing forwarded

    svc.setEnabled(true, ['you'])
    svc.push('them', chunk())
    svc.push('you', chunk())
    const audio = audioMsgs(w)
    expect(audio).toHaveLength(1)
    expect(audio[0].msg.stream).toBe('you')
  })

  it('disabling one stream flushes only that stream', async () => {
    const svc = await makeService()
    const w = FakeWorker.instances[0]
    svc.setEnabled(true, ['you'])
    svc.setEnabled(false, ['you'])
    const flushes = w.posted.filter((p) => p.msg.type === 'flush')
    expect(flushes).toHaveLength(1)
    expect(flushes[0].msg.stream).toBe('you')
  })

  it('a session enable survives the mic test detaching (the C3 shape)', async () => {
    const svc = await makeService()
    const w = FakeWorker.instances[0]
    svc.setEnabled(true, ['you']) // mic test opens its stream
    svc.setEnabled(true) // session arms both — this is what the fixed
    // runMicTest finally-block now leaves alone
    svc.push('them', chunk())
    svc.push('you', chunk())
    expect(audioMsgs(w)).toHaveLength(2)
  })

  it('surfaces worker error messages through onError', async () => {
    const svc = await makeService()
    const w = FakeWorker.instances[0]
    const seen: string[] = []
    svc.onError((m) => seen.push(m))
    w.onmessage?.({ data: { type: 'error', message: 'transcription is falling behind' } })
    expect(seen).toEqual(['transcription is falling behind'])
  })

  it('restart() spawns a fresh worker, keeps the enabled state, and has a budget of two', async () => {
    const svc = await makeService()
    svc.setEnabled(true)
    expect(svc.restart()).toBe(true)
    expect(FakeWorker.instances).toHaveLength(2)
    expect(FakeWorker.instances[0].terminated).toBe(true)
    // the fresh worker got init and the enable gate still passes audio
    expect(FakeWorker.instances[1].posted[0].msg.type).toBe('init')
    svc.push('you', chunk())
    expect(audioMsgs(FakeWorker.instances[1])).toHaveLength(1)

    expect(svc.restart()).toBe(true)
    expect(svc.restart()).toBe(false) // budget spent — no crash loop
    expect(FakeWorker.instances).toHaveLength(3)
  })

  it('load-failed marks the service failed with the reason', async () => {
    const svc = await makeService()
    const w = FakeWorker.instances[0]
    const states: string[] = []
    svc.onStateChange((s) => states.push(s))
    w.onmessage?.({ data: { type: 'load-failed', message: 'no such model' } })
    expect(svc.state).toBe('failed')
    expect(svc.error).toBe('no such model')
    expect(states).toContain('failed')
  })
})

// Why runtime.ensureModels() refuses to swap the speech model while a session
// is running: the engine holds this service's transcribers, and disposing it
// does not make them throw — it makes them do nothing at all. Every later
// segment would vanish, for the rest of the interview, with a green dot up.
describe('a disposed service is silent, not loud', () => {
  it('swallows audio instead of failing when the engine keeps pushing', async () => {
    const svc = await makeService()
    const w = FakeWorker.instances[0]
    svc.setEnabled(true, ['them'])
    svc.push('them', chunk())
    const before = audioMsgs(w).length
    expect(before).toBeGreaterThan(0)

    svc.dispose()
    svc.push('them', chunk())
    svc.push('them', chunk())
    expect(audioMsgs(w)).toHaveLength(before) // nothing arrived, nothing threw
    expect(w.terminated).toBe(true)
  })
})
