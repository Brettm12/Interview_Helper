import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionEngine } from '@/lib/engine'
import { MockTranscriber } from '@/lib/drivers/mock'
import { deriveRecap } from '@/lib/recap'
import { useSessionStore } from '@/state/sessionStore'
import { useBankStore } from '@/state/bankStore'
import { useSettingsStore } from '@/state/settingsStore'
import { TUNING } from '@shared/tuning'
import { usePanelStore } from '@/state/panelStore'
import { api } from '@/lib/api'
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

// ---- partial-driven matching ------------------------------------------------
// The panel used to wait for a confirmed segment, which costs the VAD's 750ms
// of silence plus a decode: the card landed 1.5–3s after the interviewer
// stopped asking, in the pause you were meant to be filling. Partials arrive
// while they are still speaking. The bar for acting on one is deliberately
// well above the confirmed bar — early is valuable, early and wrong is not.

describe('matching on in-flight partials', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    useSessionStore.getState().reset()
  })

  async function armed(): Promise<{ them: MockTranscriber; you: MockTranscriber; engine: SessionEngine }> {
    await useBankStore.getState().load()
    const them = new MockTranscriber('them')
    const you = new MockTranscriber('you')
    const engine = new SessionEngine(them, you)
    useSessionStore.getState().arm('loop-meridian', true)
    return { them, you, engine }
  }

  const partial = (them: MockTranscriber, text: string, t: number): void =>
    them.emit({ speaker: 'them', text, confirmed: false, t })
  const confirmed = (them: MockTranscriber, text: string, t: number): void =>
    them.emit({ speaker: 'them', text, confirmed: true, t })

  it('puts the card up before the question is finished', async () => {
    const { them } = await armed()
    partial(them, 'Tell me about a time you handled a really difficult employee relations case', 2)
    expect(useSessionStore.getState().match.entryId).toBe('a-er-case')
  })

  it('ignores a partial that is merely plausible', async () => {
    const { them } = await armed()
    // scores somewhere, but nowhere near the partial bar
    partial(them, 'so, a case, you know, the difficult sort of thing', 2)
    expect(useSessionStore.getState().match.entryId).toBeNull()
  })

  it('does not flip to a second entry inside the debounce window', async () => {
    const { them } = await armed()
    partial(them, 'Tell me about a time you handled a really difficult employee relations case', 2)
    const first = useSessionStore.getState().match.entryId
    partial(them, "I've got a manager who's burning their team out — how do you coach a manager in that spot?", 3)
    expect(useSessionStore.getState().match.entryId).toBe(first)
  })

  it('corrects the recorded wording when the full sentence arrives', async () => {
    const { them } = await armed()
    const half = 'Tell me about a time you handled a really difficult employee relations'
    const whole = `${half} case, start to finish.`
    partial(them, half, 2)
    confirmed(them, whole, 3)
    const qs = useSessionStore.getState().questions
    // one row, carrying the confirmed text — not a second row for the partial
    expect(qs).toHaveLength(1)
    expect(qs[0].question).toBe(whole)
    expect(qs[0].entryId).toBe('a-er-case')
  })

  it('leaves a pinned entry alone', async () => {
    const { them, engine } = await armed()
    engine.pinEntry('a-policy')
    partial(them, 'Tell me about a time you handled a really difficult employee relations case', 2)
    expect(useSessionStore.getState().match.entryId).toBe('a-policy')
  })
})

describe('turn boundaries in the scoring window', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    useSessionStore.getState().reset()
  })

  it('a long silence between their segments ends the turn', async () => {
    // only *your* speaking used to end a turn, so a question could be scored
    // together with preamble from a minute earlier
    await useBankStore.getState().load()
    const them = new MockTranscriber('them')
    const you = new MockTranscriber('you')
    new SessionEngine(them, you)
    useSessionStore.getState().arm('loop-meridian', true)

    them.emit({ speaker: 'them', text: 'Right. Okay. Good, thanks for that.', confirmed: true, t: 1 })
    // a gap far longer than windowGapSec
    them.emit({
      speaker: 'them',
      text: 'Tell me about a time you handled a really difficult employee relations case.',
      confirmed: true,
      t: 40
    })
    await vi.advanceTimersByTimeAsync(10)
    expect(useSessionStore.getState().match.entryId).toBe('a-er-case')
  })
})

describe('a partial that turns out to be wrong', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    useSessionStore.getState().reset()
  })

  it('does not let a later question patch the row the partial opened', async () => {
    // the partial marks a row as awaiting its confirmed wording. If the panel
    // then swaps to a different entry, that mark has to be dropped, or the
    // next confirmed segment rewrites the wrong question in the recap.
    await useBankStore.getState().load()
    const them = new MockTranscriber('them')
    const you = new MockTranscriber('you')
    const engine = new SessionEngine(them, you)
    useSessionStore.getState().arm('loop-meridian', true)

    them.emit({
      speaker: 'them',
      text: 'Tell me about a time you handled a really difficult employee relations case',
      confirmed: false,
      t: 2
    })
    const first = useSessionStore.getState().questions[0]
    expect(first.entryId).toBe('a-er-case')

    // a different entry takes over, by hand
    engine.pinEntry('a-coach')
    // ...and a confirmed segment lands on that one
    them.emit({ speaker: 'them', text: 'how do you coach a manager in that spot?', confirmed: true, t: 30 })
    await vi.advanceTimersByTimeAsync(10)

    const rows = useSessionStore.getState().questions
    const original = rows.find((q) => q.id === first.id)!
    expect(original.question).toBe(first.question)
  })
})

// ---- races found in review (REVIEW.md H3 H4 M2 M3 M4 M6 L12) ---------------

describe('question-record integrity under close-together events', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    useSessionStore.getState().reset()
  })

  const ER = 'Tell me about a time you handled a really difficult employee relations case.'
  const COACH = "I've got a manager who's burning their team out — how do you coach a manager in that spot?"
  const AMBIG = 'Say a harassment complaint lands on your desk — how do you run the investigation?'
  const UNMATCHED = "What's your approach to pay transparency conversations, when someone finds out a peer earns more?"

  async function armed(): Promise<{ them: MockTranscriber; you: MockTranscriber; engine: SessionEngine }> {
    await useBankStore.getState().load()
    const them = new MockTranscriber('them')
    const you = new MockTranscriber('you')
    const engine = new SessionEngine(them, you)
    useSessionStore.getState().arm('loop-meridian', true)
    return { them, you, engine }
  }
  const say = (t: MockTranscriber, text: string, at: number): void =>
    t.emit({ speaker: 'them', text, confirmed: true, t: at })

  it('an organic match for the NEXT question does not swallow a prior unmatched one (H3)', async () => {
    const { them } = await armed()
    say(them, UNMATCHED, 10)
    expect(useSessionStore.getState().questions).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(3000)
    say(them, ER, 40)
    const qs = [...useSessionStore.getState().questions].sort((a, b) => a.askedAtSec - b.askedAtSec)
    expect(qs).toHaveLength(2)
    expect(qs[0].entryId).toBeNull()
    expect(qs[0].question).toMatch(/pay transparency/i)
    expect(qs[1].entryId).toBe('a-er-case')
  })

  it('a ⌘K pin still resolves a just-heard unmatched question into one row', async () => {
    const { them, engine } = await armed()
    say(them, UNMATCHED, 10)
    engine.pinEntry('a-policy')
    const qs = useSessionStore.getState().questions
    expect(qs).toHaveLength(1)
    expect(qs[0].entryId).toBe('a-policy')
    expect(qs[0].pinnedViaFind).toBe(true)
  })

  it('a deferred swap is invalidated by a newer unsure question (H4)', async () => {
    const { them } = await armed()
    // session-clock gaps (> windowGapSec) keep each question its own turn;
    // the wall clock still packs them inside the 2.5s swap debounce
    say(them, ER, 2) // confident swap; debounce window opens
    expect(useSessionStore.getState().match.entryId).toBe('a-er-case')
    await vi.advanceTimersByTimeAsync(200)
    say(them, COACH, 20) // confident again, inside the debounce → deferred
    await vi.advanceTimersByTimeAsync(100)
    say(them, AMBIG, 40) // NEWER question goes ambiguous — countdown starts
    expect(useSessionStore.getState().match.state).toBe('ambiguous')

    // past the point where the deferred swap would have fired
    await vi.advanceTimersByTimeAsync(2600)
    const m = useSessionStore.getState().match
    expect(m.state).toBe('ambiguous') // the unsure card survived
    expect(m.entryId).toBe('a-er-case') // no stale flip to a-coach

    // and the countdown resolves the ambiguous question, not the stale swap
    await vi.advanceTimersByTimeAsync(4200)
    const resolved = useSessionStore.getState().match
    expect(resolved.state).toBe('confident')
    expect(['a-invest-run', 'a-informal']).toContain(resolved.entryId)
  })

  it('a user pick beats a warm rescore landing later (M2)', async () => {
    await useBankStore.getState().load()
    let release: () => void = () => {}
    const vecs: Record<string, number[]> = {
      [AMBIG]: [1, 0],
      'Walk me through how you run a harassment investigation.': [1, 0]
    }
    const { EmbeddingCache } = await import('@/lib/embeddings')
    const cache = new EmbeddingCache({
      ready: true,
      embed: (texts: string[]) =>
        new Promise((res) => {
          release = () => res(texts.map((t) => Float32Array.from(vecs[t] ?? [0, 1])))
        })
    })
    const them = new MockTranscriber('them')
    const you = new MockTranscriber('you')
    const engine = new SessionEngine(them, you, cache)
    useSessionStore.getState().arm('loop-meridian', true)

    say(them, AMBIG, 5) // cold: ambiguous on the twins, rescore scheduled
    expect(useSessionStore.getState().match.state).toBe('ambiguous')
    engine.pickCandidate('a-informal') // the user resolves it by hand
    expect(useSessionStore.getState().match.entryId).toBe('a-informal')

    release() // embeddings land, favouring a-invest-run overwhelmingly
    await vi.advanceTimersByTimeAsync(50)
    expect(useSessionStore.getState().match.entryId).toBe('a-informal') // their call stands
    expect(useSessionStore.getState().questions).toHaveLength(1)
  })

  it('a click racing the auto-pick does not record a second row (M3)', async () => {
    const { them, engine } = await armed()
    say(them, AMBIG, 10)
    expect(useSessionStore.getState().match.state).toBe('ambiguous')
    await vi.advanceTimersByTimeAsync(4200) // auto-pick fires first
    const picked = useSessionStore.getState().match.entryId
    expect(picked).not.toBeNull()
    engine.pickCandidate('a-informal') // the in-flight click lands late
    expect(useSessionStore.getState().match.entryId).toBe(picked)
    expect(useSessionStore.getState().questions).toHaveLength(1)
  })

  it('pause stops the auto-pick and keeps only the pre-pause tail (M4/M6)', async () => {
    const { them, you, engine } = await armed()
    say(them, ER, 2)
    say(them, AMBIG, 10)
    expect(useSessionStore.getState().match.state).toBe('ambiguous')

    engine.pause()
    useSessionStore.getState().setStatus('paused')
    await vi.advanceTimersByTimeAsync(6000)
    // nothing auto-picked while paused, no phantom row (the unresolved
    // ambiguous question records only when something resolves it)
    expect(useSessionStore.getState().match.state).toBe('ambiguous')
    expect(useSessionStore.getState().questions).toHaveLength(1)

    // the flushed mid-sentence tail (stamped before the pause) still lands...
    const before = useSessionStore.getState().transcript.length
    you.emit({ speaker: 'you', text: 'and that wrapped the case up.', confirmed: true, t: 10 })
    expect(useSessionStore.getState().transcript.length).toBe(before + 1)
    // ...but speech from after the pause does not
    you.emit({ speaker: 'you', text: 'this should be dropped.', confirmed: true, t: 200 })
    expect(useSessionStore.getState().transcript.length).toBe(before + 1)
  })

  it('an empty loop still records unmatched questions (L12)', async () => {
    await useBankStore.getState().load()
    const them = new MockTranscriber('them')
    const you = new MockTranscriber('you')
    new SessionEngine(them, you)
    useSessionStore.getState().arm('loop-that-does-not-exist', true)
    say(them, ER, 3)
    say(them, AMBIG, 8)
    const qs = useSessionStore.getState().questions
    expect(qs).toHaveLength(2)
    expect(qs.every((q) => q.entryId === null)).toBe(true)
  })
})

// ---- persistence semantics at the end of a session --------------------------

describe('session record durability', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    useSessionStore.getState().reset()
    useSessionStore.getState().setSaveError(null)
  })

  const ER = 'Tell me about a time you handled a really difficult employee relations case.'

  it('minute-5 excerpts survive an hour-long session (REVIEW.md H10)', async () => {
    await useBankStore.getState().load()
    const them = new MockTranscriber('them')
    const you = new MockTranscriber('you')
    const engine = new SessionEngine(them, you)
    useSessionStore.getState().arm('loop-meridian', true)

    // the opening question at minute 5, then ~55 minutes of talking: far more
    // confirmed lines than the UI's 200-entry rolling ring holds
    them.emit({ speaker: 'them', text: ER, confirmed: true, t: 300 })
    you.emit({ speaker: 'you', text: 'It started with two complaints about one supervisor.', confirmed: true, t: 310 })
    for (let i = 0; i < 500; i++) {
      you.emit({ speaker: 'you', text: `context line ${i} of the answer`, confirmed: true, t: 320 + i * 6 })
    }
    expect(useSessionStore.getState().transcript.length).toBeLessThanOrEqual(200) // the UI ring stays capped

    const record = await engine.end()
    const q = record.questions.find((x) => x.entryId === 'a-er-case')
    const texts = (q?.transcript ?? []).map((l) => l.text)
    // the ring-based derivation returned [] here — the first half of the
    // interview had scrolled out before the recap was built
    expect(texts).toContain(ER)
    expect(texts).toContain('It started with two complaints about one supervisor.')
    expect(texts.length).toBeGreaterThan(490)
  })

  it('a failed final save still tears down into the recap, visibly (REVIEW.md M5)', async () => {
    await useBankStore.getState().load()
    const them = new MockTranscriber('them')
    const you = new MockTranscriber('you')
    const engine = new SessionEngine(them, you)
    useSessionStore.getState().arm('loop-meridian', true)
    them.emit({ speaker: 'them', text: ER, confirmed: true, t: 3 })

    const originalSave = api.sessions.save
    api.sessions.save = () => Promise.reject(new Error('ENOSPC: disk full'))
    try {
      const record = await engine.end() // must NOT throw
      expect(record.questions.length).toBeGreaterThan(0)
      const s = useSessionStore.getState()
      expect(s.status).toBe('idle')
      expect(s.lastSession?.id).toBe(record.id)
      expect(s.saveError).toMatch(/disk full/)
      expect(usePanelStore.getState().view).toBe('recap')
    } finally {
      api.sessions.save = originalSave
    }
  })
})

// ---- auto-pick delay setting (REVIEW.md P5) ---------------------------------

describe('the unsure card honours the auto-pick setting', () => {
  const AMBIG = 'Say a harassment complaint lands on your desk — how do you run the investigation?'

  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    useSessionStore.getState().reset()
    useSettingsStore.setState({ autoPickSec: TUNING.autoPickSec })
  })

  async function ambiguous(): Promise<{ them: MockTranscriber; engine: SessionEngine }> {
    await useBankStore.getState().load()
    const them = new MockTranscriber('them')
    const you = new MockTranscriber('you')
    const engine = new SessionEngine(them, you)
    useSessionStore.getState().arm('loop-meridian', false)
    them.emit({ speaker: 'them', text: AMBIG, confirmed: true, t: 3 })
    expect(useSessionStore.getState().match.state).toBe('ambiguous')
    return { them, engine }
  }

  it('"never" leaves no deadline at all — the card waits for you', async () => {
    useSettingsStore.setState({ autoPickSec: null })
    await ambiguous()
    expect(useSessionStore.getState().match.autoPickAt).toBeNull()

    await vi.advanceTimersByTimeAsync(30_000)
    // still asking, nothing committed on its own, and no phantom question row
    expect(useSessionStore.getState().match.state).toBe('ambiguous')
    expect(useSessionStore.getState().questions).toHaveLength(0)
  })

  it('8s waits twice as long as the default before committing the leader', async () => {
    useSettingsStore.setState({ autoPickSec: 8 })
    await ambiguous()

    await vi.advanceTimersByTimeAsync(5000) // past the old 4s default
    expect(useSessionStore.getState().match.state).toBe('ambiguous')

    await vi.advanceTimersByTimeAsync(4000)
    expect(useSessionStore.getState().match.state).toBe('confident')
    expect(useSessionStore.getState().match.entryId).toBeTruthy()
  })

  it('a manual pick still resolves it while set to never', async () => {
    useSettingsStore.setState({ autoPickSec: null })
    const { engine } = await ambiguous()
    const leader = useSessionStore.getState().match.candidates[0].entryId
    engine.pickCandidate(leader)
    expect(useSessionStore.getState().match.state).toBe('confident')
    expect(useSessionStore.getState().match.entryId).toBe(leader)
  })
})

// ---- live pacing cue (REVIEW.md P9) ----------------------------------------

describe('mic time on the entry currently on screen', () => {
  const ER = 'Tell me about a time you handled a really difficult employee relations case.'

  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    useSessionStore.getState().reset()
  })

  it('accrues while you answer and resets when a new question takes the panel', async () => {
    await useBankStore.getState().load()
    const them = new MockTranscriber('them')
    const you = new MockTranscriber('you')
    const engine = new SessionEngine(them, you)
    useSessionStore.getState().arm('loop-meridian', false)

    them.emit({ speaker: 'them', text: ER, confirmed: true, t: 10 })
    expect(useSessionStore.getState().activeMicSec).toBe(0)

    you.emit({ speaker: 'you', text: 'Two complainants, one supervisor.', confirmed: true, t: 15 })
    you.emit({ speaker: 'you', text: 'I opened it the same afternoon.', confirmed: true, t: 100 })
    // ~85s of answering: real, but not yet worth interrupting anyone about
    expect(useSessionStore.getState().activeMicSec).toBeGreaterThan(80)
    expect(useSessionStore.getState().activeMicSec).toBeLessThan(TUNING.longAnswerSec)

    you.emit({ speaker: 'you', text: 'And that is roughly where it landed.', confirmed: true, t: 200 })
    expect(useSessionStore.getState().activeMicSec).toBeGreaterThan(TUNING.longAnswerSec)

    // the cue is about THIS answer — whatever takes the panel next starts
    // from zero, however it got there
    engine.pinEntry('a-coach')
    expect(useSessionStore.getState().activeMicSec).toBe(0)
  })
})
