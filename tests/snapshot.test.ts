import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionEngine } from '@/lib/engine'
import { MockTranscriber } from '@/lib/drivers/mock'
import { useBankStore } from '@/state/bankStore'
import { useSessionStore } from '@/state/sessionStore'

// Crash-resilience snapshots: interim records carry `incomplete`, share the
// final record's id (so end() cleanly overwrites), and only include
// transcript excerpts when the recap toggle is on.

describe('session snapshots', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    useSessionStore.getState().reset()
  })

  async function playedEngine(keepTranscript: boolean): Promise<SessionEngine> {
    await useBankStore.getState().load()
    const them = new MockTranscriber('them')
    const you = new MockTranscriber('you')
    const engine = new SessionEngine(them, you)
    useSessionStore.getState().arm('loop-meridian', keepTranscript)
    them.emit({
      speaker: 'them',
      text: 'Tell me about a time you handled a really difficult employee relations case.',
      confirmed: true,
      t: 10
    })
    you.emit({
      speaker: 'you',
      text: 'The riskiest one was two complainants against one supervisor.',
      confirmed: true,
      t: 20
    })
    return engine
  }

  it('marks interim records incomplete with the final id, transcript on', async () => {
    const engine = await playedEngine(true)
    const snapshot = engine.buildRecord(true)
    expect(snapshot.incomplete).toBe(true)
    expect(snapshot.questions.length).toBeGreaterThan(0)
    expect(snapshot.questions[0].transcript?.length).toBeGreaterThan(0)

    const final = await engine.end()
    expect(final.id).toBe(snapshot.id)
    expect(final.incomplete).toBeUndefined()
  })

  it('never includes excerpts while the transcript toggle is off', async () => {
    const engine = await playedEngine(false)
    const snapshot = engine.buildRecord(true)
    expect(snapshot.transcriptKept).toBe(false)
    for (const q of snapshot.questions) expect(q.transcript).toBeUndefined()
    await engine.end()
  })
})
