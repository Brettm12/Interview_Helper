import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/lib/api'
import { startBankSync } from '@/containers/runtime'
import { useBankStore } from '@/state/bankStore'

// Cross-window bank freshness: another window saving through the repository
// fires bank change notifications; this window reloads without losing its
// selection or an in-progress draft. (The browser shim mirrors main's
// bank:did-change relay, so the same path is exercised here.)

describe('bank sync', () => {
  let stop: (() => void) | null = null
  afterEach(() => {
    stop?.()
    stop = null
  })

  it('reloads on a remote save, preserving selection and draft', async () => {
    await useBankStore.getState().load()
    const store = useBankStore.getState()
    const original = useBankStore.getState().bank!

    store.selectAnswer('a-coach')
    store.startEdit('a-coach')
    stop = startBankSync()

    // simulate another window: change a different answer's question and save
    const remote = {
      ...original,
      answers: original.answers.map((a) =>
        a.id === 'a-policy' ? { ...a, question: 'Edited elsewhere?' } : a
      )
    }
    await api.bank.save(remote)

    await vi.waitFor(() => {
      const b = useBankStore.getState().bank!
      expect(b.answers.find((a) => a.id === 'a-policy')?.question).toBe('Edited elsewhere?')
    })
    expect(useBankStore.getState().selectedAnswerId).toBe('a-coach')
    expect(useBankStore.getState().draft?.answerId).toBe('a-coach')
  })
})
