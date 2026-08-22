import { describe, expect, it } from 'vitest'
import { isTypingTarget, unsureKeyAction } from '@/lib/keys'

// REVIEW.md P1: the unsure card gives you four seconds to choose between two
// or three candidates. Reaching for the mouse costs most of them, so 1/2/3
// pick and Esc dismisses — but a bare digit must be inert everywhere else,
// or typing "3 complaints" into ⌘K would swap the panel mid-interview.

const ctx = (over: Partial<Parameters<typeof unsureKeyAction>[1]> = {}) => ({
  unsure: true,
  findOpen: false,
  collapsed: false,
  typing: false,
  candidateCount: 3,
  ...over
})

describe('unsureKeyAction', () => {
  it('maps 1/2/3 to the ranked candidates', () => {
    expect(unsureKeyAction({ key: '1' }, ctx())).toEqual({ kind: 'pick', index: 0 })
    expect(unsureKeyAction({ key: '2' }, ctx())).toEqual({ kind: 'pick', index: 1 })
    expect(unsureKeyAction({ key: '3' }, ctx())).toEqual({ kind: 'pick', index: 2 })
  })

  it('Esc is "None of these"', () => {
    expect(unsureKeyAction({ key: 'Escape' }, ctx())).toEqual({ kind: 'none' })
  })

  it('ignores a digit with no candidate behind it', () => {
    expect(unsureKeyAction({ key: '3' }, ctx({ candidateCount: 2 }))).toBeNull()
    expect(unsureKeyAction({ key: '4' }, ctx())).toBeNull()
    expect(unsureKeyAction({ key: '0' }, ctx())).toBeNull()
  })

  it('does nothing unless the unsure card is what is on screen', () => {
    expect(unsureKeyAction({ key: '1' }, ctx({ unsure: false }))).toBeNull()
    expect(unsureKeyAction({ key: 'Escape' }, ctx({ unsure: false }))).toBeNull()
  })

  it('yields to the find overlay — Esc there means close the overlay', () => {
    expect(unsureKeyAction({ key: 'Escape' }, ctx({ findOpen: true }))).toBeNull()
    expect(unsureKeyAction({ key: '2' }, ctx({ findOpen: true }))).toBeNull()
  })

  it('does nothing while collapsed to the strip — there is nothing to read', () => {
    expect(unsureKeyAction({ key: '1' }, ctx({ collapsed: true }))).toBeNull()
  })

  it('never steals a keystroke from a text field', () => {
    expect(unsureKeyAction({ key: '1' }, ctx({ typing: true }))).toBeNull()
  })

  it('requires a bare press: no ⌘1, ⌥1, ⇧1 or ^1', () => {
    for (const mod of ['metaKey', 'ctrlKey', 'altKey', 'shiftKey'] as const) {
      expect(unsureKeyAction({ key: '1', [mod]: true }, ctx())).toBeNull()
    }
  })
})

describe('isTypingTarget', () => {
  it('recognises the elements that own their keystrokes', () => {
    expect(isTypingTarget({ tagName: 'INPUT' })).toBe(true)
    expect(isTypingTarget({ tagName: 'TEXTAREA' })).toBe(true)
    expect(isTypingTarget({ tagName: 'SELECT' })).toBe(true)
    expect(isTypingTarget({ tagName: 'DIV', isContentEditable: true })).toBe(true)
    expect(isTypingTarget({ tagName: 'DIV' })).toBe(false)
    expect(isTypingTarget(null)).toBe(false)
  })
})
