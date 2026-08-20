import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionEngine } from '@/lib/engine'
import { MockTranscriber } from '@/lib/drivers/mock'
import { deriveRecap } from '@/lib/recap'
import { useSessionStore } from '@/state/sessionStore'
import { useBankStore } from '@/state/bankStore'
import script from '@/fixtures/demo-session.json'
import type { SessionRecord } from '@shared/types'

// End-to-end over the scripted fixture: the same path `npm run dev:mock`
// exercises — armed → confident match → coverage → ambiguous + auto-pick →
// unmatched question → ⌘K override → end → recap derivation.

interface ScriptEvent {
  delay: number
  kind: string
  at: number
  text?: string
  confirmed?: boolean
  query?: string
  entryId?: string
}

describe('SessionEngine over the demo fixture', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    useSessionStore.getState().reset()
  })

  async function runFixture(keepTranscript: boolean): Promise<SessionRecord> {
    await useBankStore.getState().load()
    const them = new MockTranscriber('them')
    const you = new MockTranscriber('you')
    const engine = new SessionEngine(them, you)
    useSessionStore.getState().arm('loop-meridian', keepTranscript)

    let record: SessionRecord | null = null
    let sawAmbiguous = false
    for (const e of script.events as ScriptEvent[]) {
      await vi.advanceTimersByTimeAsync(e.delay)
      if (e.kind === 'them') them.emit({ speaker: 'them', text: e.text!, confirmed: e.confirmed ?? true, t: e.at })
      else if (e.kind === 'you') you.emit({ speaker: 'you', text: e.text!, confirmed: e.confirmed ?? true, t: e.at })
      else if (e.kind === 'find-pin') engine.pinEntry(e.entryId!)
      else if (e.kind === 'end') record = await engine.end()
      if (useSessionStore.getState().match.state === 'ambiguous') sawAmbiguous = true
    }
    expect(sawAmbiguous).toBe(true)
    return record!
  }

  it('plays the scripted session end to end (transcript kept)', async () => {
    const record = await runFixture(true)
    const qs = [...record.questions].sort((a, b) => a.askedAtSec - b.askedAtSec)

    expect(qs).toHaveLength(6)
    // Q1: confident match, 3 of 4 covered
    expect(qs[0].entryId).toBe('a-er-case')
    expect(qs[0].coveredPointIds.sort()).toEqual(['p-erc-1', 'p-erc-2', 'p-erc-3'])
    // Q2: ambiguous → auto-picked leader after the 4s countdown
    expect(qs[1].entryId).toBe('a-invest-run')
    expect(qs[1].coveredPointIds.sort()).toEqual(['p-inv-2', 'p-inv-3'])
    // Q3: not in the bank
    expect(qs[2].entryId).toBeNull()
    expect(qs[2].question).toMatch(/pay transparency/i)
    // Q4: confident, fully covered, ran long
    expect(qs[3].entryId).toBe('a-coach')
    expect(qs[3].coveredPointIds.sort()).toEqual(['p-cch-1', 'p-cch-2', 'p-cch-3'])
    expect(qs[3].micSeconds).toBeGreaterThan(150)
    // Q5: pinned via ⌘K, 2 of 3 covered
    expect(qs[4].entryId).toBe('a-policy')
    expect(qs[4].pinnedViaFind).toBe(true)
    expect(qs[4].coveredPointIds.sort()).toEqual(['p-pol-1', 'p-pol-3'])
    // Q6: not in the bank
    expect(qs[5].entryId).toBeNull()

    // transcripts kept per question
    expect(qs[0].transcript?.length).toBeGreaterThan(0)

    // recap: all four fix kinds emerge from this session
    const bank = useBankStore.getState().bank!
    const recap = deriveRecap(record, bank)
    expect(recap.stats.matched).toBe(4)
    expect(recap.stats.unmatched).toBe(2)
    expect(recap.fixes.map((f) => f.kind)).toEqual(['draft', 'uncovered', 'long', 'override'])
    expect(recap.practiceEntryIds.sort()).toEqual(['a-er-case', 'a-invest-run', 'a-policy'])
  })

  it('keeps no transcript excerpts when the toggle is off, but the recap still works', async () => {
    const record = await runFixture(false)
    expect(record.transcriptKept).toBe(false)
    for (const q of record.questions) expect(q.transcript).toBeUndefined()
    const recap = deriveRecap(record, useBankStore.getState().bank!)
    expect(recap.rows.every((r) => r.transcript === null)).toBe(true)
    expect(recap.stats.matched).toBe(4)
  })
})
