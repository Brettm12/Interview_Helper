// Keyboard mappings as pure data, so the rules that decide whether a bare
// keypress means something are testable without a DOM.
//
// The live panel's rules are the fussy ones: during a session, single digits
// have to do something useful (the unsure card gives you four seconds to
// choose, and reaching for the mouse costs most of them) — while never firing
// when the ⌘K overlay is open, when the panel is collapsed to the strip, or
// when the keystroke belongs to a text field.

export interface KeyEventLike {
  key: string
  metaKey?: boolean
  ctrlKey?: boolean
  altKey?: boolean
  shiftKey?: boolean
}

const bare = (e: KeyEventLike): boolean =>
  !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey

/** does this element own the keystroke? (text fields, contenteditable) */
export function isTypingTarget(
  el: { tagName?: string; isContentEditable?: boolean } | null | undefined
): boolean {
  if (!el) return false
  if (el.isContentEditable) return true
  const tag = (el.tagName ?? '').toUpperCase()
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

// ---- unsure card (REVIEW.md P1) --------------------------------------------

export interface UnsureKeyContext {
  /** the unsure card is what's on screen */
  unsure: boolean
  /** the ⌘K overlay owns the keyboard */
  findOpen: boolean
  /** collapsed to the strip — the card is not visible to choose from */
  collapsed: boolean
  /** focus is inside a text field */
  typing: boolean
  candidateCount: number
}

export type UnsureKeyAction = { kind: 'pick'; index: number } | { kind: 'none' } | null

/**
 * `1`/`2`/`3` pick the nth candidate; `Esc` is "None of these".
 *
 * Deliberately hint-less on screen: visible badges would change the gated
 * unsure frame, and the countdown block already tells you a decision is
 * wanted. The setup screen documents the keys.
 */
export function unsureKeyAction(e: KeyEventLike, ctx: UnsureKeyContext): UnsureKeyAction {
  if (!ctx.unsure || ctx.findOpen || ctx.collapsed || ctx.typing) return null
  if (!bare(e)) return null
  if (e.key === 'Escape') return { kind: 'none' }
  const index = '123'.indexOf(e.key)
  if (index < 0 || index >= ctx.candidateCount) return null
  return { kind: 'pick', index }
}

// ---- entry editor (REVIEW.md P6) -------------------------------------------

export interface EditorKeyContext {
  /** the draft differs from what is stored — Esc would throw work away */
  dirty: boolean
  /** an Esc has already been pressed on a dirty draft and is awaiting the
   *  second one (same two-press shape as ending a session with ⌘⇧R) */
  discardArmed: boolean
}

export type EditorKeyAction =
  | { kind: 'save' }
  | { kind: 'cancel' }
  | { kind: 'arm-discard' }
  | { kind: 'move'; delta: -1 | 1 }
  | null

/**
 * Entering fifteen answers the night before is a hands-off-keyboard dance per
 * point without these: ⌘↵ saves, Esc cancels (twice when there is work to
 * lose), ⌥↑/⌥↓ move the focused point. ⌥-arrows are claimed deliberately —
 * the caller preventDefaults them, or the caret jumps a word instead.
 */
export function editorKeyAction(e: KeyEventLike, ctx: EditorKeyContext): EditorKeyAction {
  const mod = e.metaKey === true || e.ctrlKey === true
  if (e.key === 'Enter' && mod) return { kind: 'save' }
  if (e.key === 'Escape' && !mod && !e.altKey) {
    return ctx.dirty && !ctx.discardArmed ? { kind: 'arm-discard' } : { kind: 'cancel' }
  }
  if (e.altKey === true && !mod) {
    if (e.key === 'ArrowUp') return { kind: 'move', delta: -1 }
    if (e.key === 'ArrowDown') return { kind: 'move', delta: 1 }
  }
  return null
}
