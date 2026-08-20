import { create } from 'zustand'
import type { Answer, Bank, Story } from '@shared/types'
import { api } from '../lib/api'

// Bank data + prep-surface UI state (selection, search, editing). Persisted
// through the repository behind window.api; every mutation saves.

export interface EditorDraft {
  answerId: string | null // null → creating a new answer
  question: string
  points: { id: string; text: string }[]
  storyId: string | null
  triggerPhrases: string[]
  sectionId: string
  /** transcript excerpt carried in when drafting from the recap */
  seedTranscript?: string
}

export interface StoryDraft {
  storyId: string | null // null → creating a new story
  title: string
  body: string
  metrics: string[]
}

interface BankState {
  bank: Bank | null
  loaded: boolean
  selectedAnswerId: string | null
  searchQuery: string
  /** non-null → pane 3 shows the editor */
  draft: EditorDraft | null
  /** filter applied when arriving via "fix these" / practice links */
  filterIds: string[] | null
  /** pane 3 shows the shared stories library */
  storiesOpen: boolean
  storyDraft: StoryDraft | null

  load(): Promise<void>
  selectLoop(id: string): void
  selectAnswer(id: string): void
  setSearch(q: string): void
  setFilter(ids: string[] | null): void

  startEdit(answerId: string): void
  startNew(prefill?: { question?: string; seedTranscript?: string }): void
  updateDraft(patch: Partial<EditorDraft>): void
  cancelEdit(): void
  saveEdit(): Promise<void>

  openStories(): void
  closeStories(): void
  selectStory(id: string): void
  newStory(): void
  updateStoryDraft(patch: Partial<StoryDraft>): void
  saveStoryDraft(): Promise<void>

  addTrigger(answerId: string, phrase: string): Promise<void>
  removeTrigger(answerId: string, phrase: string): Promise<void>
  markLastUsed(answerId: string, info: Answer['lastUsed']): Promise<void>
}

let draftSeq = 0

export const useBankStore = create<BankState>((set, get) => ({
  bank: null,
  loaded: false,
  selectedAnswerId: null,
  searchQuery: '',
  draft: null,
  filterIds: null,
  storiesOpen: false,
  storyDraft: null,

  load: async () => {
    const bank = await api.bank.load()
    set({
      bank,
      loaded: true,
      selectedAnswerId:
        get().selectedAnswerId ?? bank.answers.find((a) => a.loopIds.includes(bank.activeLoopId))?.id ?? null
    })
  },

  selectLoop: (id) => {
    const { bank } = get()
    if (!bank) return
    const next = { ...bank, activeLoopId: id }
    set({
      bank: next,
      selectedAnswerId: next.answers.find((a) => a.loopIds.includes(id))?.id ?? null,
      filterIds: null
    })
    void api.bank.save(next)
  },

  selectAnswer: (id) => set({ selectedAnswerId: id, draft: null, storiesOpen: false }),
  setSearch: (q) => set({ searchQuery: q }),
  setFilter: (ids) => set({ filterIds: ids }),

  startEdit: (answerId) => {
    const a = get().bank?.answers.find((x) => x.id === answerId)
    if (!a) return
    set({
      storiesOpen: false,
      draft: {
        answerId: a.id,
        question: a.question,
        points: a.points.map((p) => ({ ...p })),
        storyId: a.storyId,
        triggerPhrases: [...a.triggerPhrases],
        sectionId: a.sectionId
      }
    })
  },

  startNew: (prefill) => {
    const bank = get().bank
    set({
      storiesOpen: false,
      draft: {
        answerId: null,
        question: prefill?.question ?? '',
        points: [],
        storyId: null,
        triggerPhrases: [],
        sectionId: bank?.sections[0]?.id ?? 'sec-behavioural',
        seedTranscript: prefill?.seedTranscript
      }
    })
  },

  updateDraft: (patch) => {
    const d = get().draft
    if (d) set({ draft: { ...d, ...patch } })
  },

  cancelEdit: () => set({ draft: null }),

  saveEdit: async () => {
    const { bank, draft } = get()
    if (!bank || !draft) return
    const points = draft.points.filter((p) => p.text.trim() !== '')
    let answers: Answer[]
    let selectedId: string
    if (draft.answerId) {
      selectedId = draft.answerId
      answers = bank.answers.map((a) =>
        a.id === draft.answerId
          ? {
              ...a,
              question: draft.question.trim(),
              points,
              storyId: draft.storyId,
              triggerPhrases: draft.triggerPhrases,
              sectionId: draft.sectionId
            }
          : a
      )
    } else {
      selectedId = `a-new-${Date.now()}-${draftSeq++}`
      answers = [
        ...bank.answers,
        {
          id: selectedId,
          question: draft.question.trim(),
          sectionId: draft.sectionId,
          loopIds: [bank.activeLoopId],
          storyId: draft.storyId,
          triggerPhrases: draft.triggerPhrases,
          lastUsed: null,
          points
        }
      ]
    }
    const next = { ...bank, answers }
    set({ bank: next, draft: null, selectedAnswerId: selectedId })
    await api.bank.save(next)
  },

  addTrigger: async (answerId, phrase) => {
    const bank = get().bank
    if (!bank) return
    const p = phrase.trim()
    if (!p) return
    const next = {
      ...bank,
      answers: bank.answers.map((a) =>
        a.id === answerId && !a.triggerPhrases.includes(p)
          ? { ...a, triggerPhrases: [...a.triggerPhrases, p] }
          : a
      )
    }
    set({ bank: next })
    await api.bank.save(next)
  },

  removeTrigger: async (answerId, phrase) => {
    const bank = get().bank
    if (!bank) return
    const next = {
      ...bank,
      answers: bank.answers.map((a) =>
        a.id === answerId ? { ...a, triggerPhrases: a.triggerPhrases.filter((t) => t !== phrase) } : a
      )
    }
    set({ bank: next })
    await api.bank.save(next)
  },

  // ---- shared stories library (pane 3) ----

  openStories: () => set({ storiesOpen: true, draft: null, storyDraft: null }),
  closeStories: () => set({ storiesOpen: false, storyDraft: null }),

  selectStory: (id) => {
    const story = get().bank?.stories.find((s) => s.id === id)
    if (!story) return
    set({
      storyDraft: {
        storyId: story.id,
        title: story.title,
        body: story.body,
        metrics: [...story.metrics]
      }
    })
  },

  newStory: () => set({ storyDraft: { storyId: null, title: '', body: '', metrics: [] } }),

  updateStoryDraft: (patch) => {
    const d = get().storyDraft
    if (d) set({ storyDraft: { ...d, ...patch } })
  },

  saveStoryDraft: async () => {
    const { bank, storyDraft } = get()
    if (!bank || !storyDraft || storyDraft.title.trim() === '') return
    const value = {
      title: storyDraft.title.trim(),
      body: storyDraft.body.trim(),
      metrics: storyDraft.metrics
    }
    // stories are shared entities — editing one updates every answer that
    // references it (answers point at the id, so nothing else changes)
    const stories = storyDraft.storyId
      ? bank.stories.map((s) => (s.id === storyDraft.storyId ? { ...s, ...value } : s))
      : [...bank.stories, { id: `story-new-${Date.now()}-${draftSeq++}`, ...value }]
    const next = { ...bank, stories }
    set({ bank: next, storyDraft: null })
    await api.bank.save(next)
  },

  markLastUsed: async (answerId, info) => {
    const bank = get().bank
    if (!bank) return
    const next = {
      ...bank,
      answers: bank.answers.map((a) => (a.id === answerId ? { ...a, lastUsed: info } : a))
    }
    set({ bank: next })
    await api.bank.save(next)
  }
}))

// ---- derived helpers (plain functions over the store state) ----

export function answersForLoop(bank: Bank, loopId: string): Answer[] {
  return bank.answers.filter((a) => a.loopIds.includes(loopId))
}

export function storyById(bank: Bank, id: string | null): Story | null {
  return id ? (bank.stories.find((s) => s.id === id) ?? null) : null
}

/** live count for "used in N answers" */
export function storyUsage(bank: Bank, storyId: string): number {
  return bank.answers.filter((a) => a.storyId === storyId).length
}
