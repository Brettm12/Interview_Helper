import { beforeEach, describe, expect, it } from 'vitest'
import seed from '@shared/seed.json'
import type { Bank } from '@shared/types'
import { api } from '@/lib/api'
import { starterAnswerIds, storyUsage, useBankStore } from '@/state/bankStore'

// Removal. The bank shipped with no delete of any kind: a mistyped answer was
// permanent, a story could not be retired, and the fifteen example entries sat
// in the active loop being scored against the interviewer's voice forever.

const pristine = (): Bank => structuredClone(seed) as Bank

describe('deleting from the bank', () => {
  beforeEach(async () => {
    await api.bank.save(pristine())
    useBankStore.setState({ selectedAnswerId: null, draft: null, filterIds: null, storyDraft: null })
    await useBankStore.getState().load()
  })

  it('removes the answer and persists it, so it stays gone', async () => {
    await useBankStore.getState().deleteAnswer('a-coach')
    expect(useBankStore.getState().bank!.answers.find((a) => a.id === 'a-coach')).toBeUndefined()
    const reloaded = await api.bank.load()
    expect(reloaded.bank.answers.find((a) => a.id === 'a-coach')).toBeUndefined()
  })

  it('lands the selection on something real instead of an empty pane', async () => {
    const store = useBankStore.getState()
    store.selectAnswer('a-coach')
    await store.deleteAnswer('a-coach')
    const selected = useBankStore.getState().selectedAnswerId
    expect(selected).not.toBe('a-coach')
    expect(useBankStore.getState().bank!.answers.some((a) => a.id === selected)).toBe(true)
  })

  it('closes the editor if it was editing the answer that just went', async () => {
    const store = useBankStore.getState()
    store.startEdit('a-coach')
    expect(useBankStore.getState().draft).not.toBeNull()
    await store.deleteAnswer('a-coach')
    expect(useBankStore.getState().draft).toBeNull()
  })

  it('leaves an editor open on a different answer alone', async () => {
    const store = useBankStore.getState()
    store.startEdit('a-policy')
    await store.deleteAnswer('a-coach')
    expect(useBankStore.getState().draft?.answerId).toBe('a-policy')
  })

  it('drops the id from a "fix these" filter rather than filtering to a ghost', async () => {
    const store = useBankStore.getState()
    store.setFilter(['a-coach', 'a-policy'])
    await store.deleteAnswer('a-coach')
    expect(useBankStore.getState().filterIds).toEqual(['a-policy'])
  })

  it('is inert for an id that is not there', async () => {
    const before = useBankStore.getState().bank!.answers.length
    await useBankStore.getState().deleteAnswer('a-nope')
    expect(useBankStore.getState().bank!.answers).toHaveLength(before)
  })
})

describe('deleting a shared story', () => {
  beforeEach(async () => {
    await api.bank.save(pristine())
    useBankStore.setState({ selectedAnswerId: null, draft: null, filterIds: null, storyDraft: null })
    await useBankStore.getState().load()
  })

  it('leaves no answer pointing at a story that no longer exists', async () => {
    const bank = useBankStore.getState().bank!
    const users = bank.answers.filter((a) => a.storyId === 'story-invest')
    expect(users.length).toBeGreaterThan(0) // the fixture has to be worth testing

    await useBankStore.getState().deleteStory('story-invest')
    const after = useBankStore.getState().bank!
    expect(after.stories.some((s) => s.id === 'story-invest')).toBe(false)
    expect(after.answers.filter((a) => a.storyId === 'story-invest')).toHaveLength(0)
    // the answers themselves stay — only the reference goes
    for (const a of users) expect(after.answers.some((x) => x.id === a.id)).toBe(true)
  })

  it('says how many answers a delete is about to touch', () => {
    const bank = useBankStore.getState().bank!
    expect(storyUsage(bank, 'story-invest')).toBe(
      bank.answers.filter((a) => a.storyId === 'story-invest').length
    )
  })

  it('closes the story editor and persists', async () => {
    const store = useBankStore.getState()
    store.selectStory('story-rif')
    await store.deleteStory('story-rif')
    expect(useBankStore.getState().storyDraft).toBeNull()
    const reloaded = await api.bank.load()
    expect(reloaded.bank.stories.some((s) => s.id === 'story-rif')).toBe(false)
  })
})

describe('getting out of the starter bank', () => {
  beforeEach(async () => {
    await api.bank.save(pristine())
    useBankStore.setState({ selectedAnswerId: null, draft: null, filterIds: null, storyDraft: null })
    await useBankStore.getState().load()
  })

  it('takes out every untouched example, and its now-unused stories', async () => {
    const before = useBankStore.getState().bank!.answers.length
    const n = await useBankStore.getState().removeStarterAnswers()
    expect(n).toBe(before)
    const after = useBankStore.getState().bank!
    expect(after.answers).toHaveLength(0)
    expect(after.stories).toHaveLength(0)
    // loops and sections are the user's own scaffolding and stay
    expect(after.loops.length).toBeGreaterThan(0)
    expect(after.sections.length).toBeGreaterThan(0)
  })

  it('keeps an example the user has rewritten — it is theirs now', async () => {
    const store = useBankStore.getState()
    store.startEdit('a-coach')
    store.updateDraft({ question: 'How do you coach a manager who is burning out their team?' })
    await store.saveEdit()

    await useBankStore.getState().removeStarterAnswers()
    const after = useBankStore.getState().bank!
    expect(after.answers.map((a) => a.id)).toEqual(['a-coach'])
  })

  it('keeps the user’s own answers, which live in the same loop', async () => {
    const store = useBankStore.getState()
    store.startNew({ question: 'Why do you want to leave your current role?' })
    store.updateDraft({ points: [{ id: 'p-x', text: 'Scope, not money' }] })
    await store.saveEdit()
    const mine = useBankStore.getState().selectedAnswerId!

    await useBankStore.getState().removeStarterAnswers()
    expect(useBankStore.getState().bank!.answers.map((a) => a.id)).toEqual([mine])
  })

  it('keeps a story the user attached to their own answer', async () => {
    const store = useBankStore.getState()
    store.startNew({ question: 'Tell me about a launch that went wrong.' })
    store.updateDraft({
      points: [{ id: 'p-y', text: 'We shipped the rollback first' }],
      storyId: 'story-invest'
    })
    await store.saveEdit()

    await useBankStore.getState().removeStarterAnswers()
    expect(useBankStore.getState().bank!.stories.map((s) => s.id)).toEqual(['story-invest'])
  })

  it('counts only the untouched ones, so the button can say what it will do', async () => {
    const store = useBankStore.getState()
    store.startEdit('a-coach')
    store.updateDraft({ points: [{ id: 'p-z', text: 'Rewritten in my own words' }] })
    await store.saveEdit()

    const bank = useBankStore.getState().bank!
    expect(starterAnswerIds(bank)).toHaveLength(bank.answers.length - 1)
    expect(starterAnswerIds(bank)).not.toContain('a-coach')
  })

  it('is inert once they are gone — the section stops offering itself', async () => {
    await useBankStore.getState().removeStarterAnswers()
    expect(starterAnswerIds(useBankStore.getState().bank!)).toHaveLength(0)
    expect(await useBankStore.getState().removeStarterAnswers()).toBe(0)
  })
})

// Merging is the remedy the bank check offers for two entries the matcher
// cannot separate. It has to be lossless in the direction that matters: the
// surviving entry keeps its own wording, and gains everything the other one
// had that it did not.
describe('merging two answers the matcher confuses', () => {
  beforeEach(async () => {
    await api.bank.save(pristine())
    useBankStore.setState({ selectedAnswerId: null, draft: null, filterIds: null, storyDraft: null })
    await useBankStore.getState().load()
  })

  it('keeps the survivor’s question and takes the other’s points', async () => {
    const before = useBankStore.getState().bank!
    const into = before.answers.find((a) => a.id === 'a-invest-run')!
    const from = before.answers.find((a) => a.id === 'a-informal')!

    await useBankStore.getState().mergeAnswers('a-invest-run', 'a-informal')
    const after = useBankStore.getState().bank!
    const merged = after.answers.find((a) => a.id === 'a-invest-run')!

    expect(after.answers.some((a) => a.id === 'a-informal')).toBe(false)
    expect(merged.question).toBe(into.question)
    expect(merged.points).toHaveLength(into.points.length + from.points.length)
    for (const p of from.points) expect(merged.points.map((x) => x.text)).toContain(p.text)
  })

  it('does not duplicate a point or a phrase both of them already had', async () => {
    const store = useBankStore.getState()
    await store.addTrigger('a-invest-run', 'harassment complaint')
    await store.addTrigger('a-informal', 'Harassment Complaint ')
    await useBankStore.getState().mergeAnswers('a-invest-run', 'a-informal')
    const merged = useBankStore.getState().bank!.answers.find((a) => a.id === 'a-invest-run')!
    const hits = merged.triggerPhrases.filter((p) => p.trim().toLowerCase() === 'harassment complaint')
    expect(hits).toHaveLength(1)
  })

  it('inherits a story only when the survivor had none', async () => {
    const store = useBankStore.getState()
    store.startEdit('a-invest-run')
    store.updateDraft({ storyId: null })
    await store.saveEdit()
    const donorStory = useBankStore.getState().bank!.answers.find((a) => a.id === 'a-informal')!.storyId

    await useBankStore.getState().mergeAnswers('a-invest-run', 'a-informal')
    expect(useBankStore.getState().bank!.answers.find((a) => a.id === 'a-invest-run')!.storyId).toBe(
      donorStory
    )
  })

  it('lands the selection on the survivor and persists', async () => {
    await useBankStore.getState().mergeAnswers('a-invest-run', 'a-informal')
    expect(useBankStore.getState().selectedAnswerId).toBe('a-invest-run')
    const reloaded = await api.bank.load()
    expect(reloaded.bank.answers.some((a) => a.id === 'a-informal')).toBe(false)
  })

  it('refuses to merge an entry into itself, or anything that is not there', async () => {
    const before = useBankStore.getState().bank!.answers.length
    await useBankStore.getState().mergeAnswers('a-coach', 'a-coach')
    await useBankStore.getState().mergeAnswers('a-coach', 'a-nope')
    expect(useBankStore.getState().bank!.answers).toHaveLength(before)
  })
})
