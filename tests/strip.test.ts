import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createStripPublisher, deriveStripState, stripStatesEqual } from '@/lib/strip'
import type { MatchSlice } from '@/state/sessionStore'
import type { StripState } from '@shared/ipc'
import type { Answer } from '@shared/types'

// The share-safe strip's one-line derivation + the IPC publish throttle.

const entry: Answer = {
  id: 'a-1',
  question: 'How do you prioritize?',
  sectionId: 'sec',
  loopIds: ['loop'],
  storyId: null,
  triggerPhrases: [],
  lastUsed: null,
  points: [
    { id: 'p1', text: 'First point' },
    { id: 'p2', text: 'Second point' },
    { id: 'p3', text: 'Third point' },
    { id: 'p4', text: 'Land on the relationship, not the win' }
  ]
}

const match = (over: Partial<MatchSlice>): MatchSlice => ({
  state: 'confident',
  entryId: 'a-1',
  candidates: [],
  autoPickAt: null,
  heard: null,
  ...over
})

const derive = (over: {
  match?: Partial<MatchSlice>
  coverage?: Record<string, string[]>
  entryAtCollapse?: string | null
}): StripState =>
  deriveStripState({
    entries: [entry],
    match: match(over.match ?? {}),
    coverage: over.coverage ?? {},
    entryAtCollapse: over.entryAtCollapse ?? 'a-1',
    protectionOn: true
  })

describe('deriveStripState', () => {
  it('shows the first uncovered point with its position as the counter', () => {
    expect(derive({})).toMatchObject({ variant: 'current', text: 'First point', counter: '1/4' })
    expect(derive({ coverage: { 'a-1': ['p1', 'p2'] } })).toMatchObject({
      variant: 'current',
      text: 'Third point',
      counter: '3/4'
    })
  })

  it('reads N/N and switches to queued on the last point', () => {
    expect(derive({ coverage: { 'a-1': ['p1', 'p2', 'p3'] } })).toMatchObject({
      variant: 'queued',
      text: 'Land on the relationship, not the win',
      counter: '4/4'
    })
    // everything covered keeps showing the last point
    expect(derive({ coverage: { 'a-1': ['p1', 'p2', 'p3', 'p4'] } })).toMatchObject({
      variant: 'queued',
      counter: '4/4'
    })
  })

  it('nudges "New:" when a different entry activated after collapse', () => {
    const s = derive({ entryAtCollapse: 'a-other' })
    expect(s.variant).toBe('new-question')
    expect(s.text).toBe('New: How do you prioritize?')
    expect(s.counter).toBeNull()
  })

  it('nudges on an ambiguous state with the heard phrase', () => {
    const s = derive({ match: { state: 'ambiguous', entryId: null, heard: 'how do you decide?' } })
    expect(s).toMatchObject({ variant: 'new-question', text: 'New: how do you decide?' })
  })

  it('falls back when nothing has matched yet', () => {
    const s = derive({ match: { entryId: null } })
    expect(s).toMatchObject({ variant: 'current', text: 'Listening — nothing matched yet', counter: null })
  })
})

describe('createStripPublisher', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  const state = (text: string): StripState => ({
    variant: 'current',
    text,
    counter: '1/4',
    protectionOn: true,
    paused: false
  })

  it('sends a changed state immediately and drops identical offers', () => {
    const sent: StripState[] = []
    const pub = createStripPublisher({ send: (s) => sent.push(s), minIntervalMs: 100 })
    pub.offer(state('a'))
    pub.offer(state('a'))
    expect(sent.map((s) => s.text)).toEqual(['a'])
    expect(stripStatesEqual(sent[0], state('a'))).toBe(true)
  })

  it('collapses a burst to leading + one trailing send carrying the latest', () => {
    const sent: string[] = []
    const pub = createStripPublisher({ send: (s) => sent.push(s.text), minIntervalMs: 100 })
    pub.offer(state('a')) // leading
    pub.offer(state('b')) // inside the window — queued
    pub.offer(state('c')) // replaces the queued state
    expect(sent).toEqual(['a'])
    vi.advanceTimersByTime(100)
    expect(sent).toEqual(['a', 'c'])
  })

  it('does not send a trailing state that circled back to the last sent one', () => {
    const sent: string[] = []
    const pub = createStripPublisher({ send: (s) => sent.push(s.text), minIntervalMs: 100 })
    pub.offer(state('a'))
    pub.offer(state('b'))
    pub.offer(state('a')) // back to what the strip already shows
    vi.advanceTimersByTime(200)
    expect(sent).toEqual(['a'])
  })
})

// REVIEW.md P2: pause closes the microphone. A strip still counting off your
// next point — under a live-green dot — says the opposite.
describe('paused strip', () => {
  const pausedDerive = (over: { match?: Partial<MatchSlice>; coverage?: Record<string, string[]> } = {}): StripState =>
    deriveStripState({
      entries: [entry],
      match: match(over.match ?? {}),
      coverage: over.coverage ?? {},
      entryAtCollapse: 'a-1',
      protectionOn: true,
      paused: true
    })

  it('says it is paused instead of showing the next point', () => {
    expect(pausedDerive()).toMatchObject({
      variant: 'current',
      text: 'Paused — mic is off',
      counter: null,
      paused: true
    })
  })

  it('wins over the new-question nudge — nothing is being heard to be new', () => {
    expect(pausedDerive({ match: { state: 'ambiguous', heard: 'and what about scale?' } })).toMatchObject({
      variant: 'current',
      text: 'Paused — mic is off',
      paused: true
    })
  })

  it('is a material change, so pausing publishes to the strip window', () => {
    const running = deriveStripState({
      entries: [entry],
      match: match({}),
      coverage: {},
      entryAtCollapse: 'a-1',
      protectionOn: true
    })
    expect(running.paused).toBe(false)
    expect(stripStatesEqual(running, pausedDerive())).toBe(false)
  })
})
