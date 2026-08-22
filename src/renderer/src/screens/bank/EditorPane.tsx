import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { DragEvent, KeyboardEvent } from 'react'
import type { EditorPaneProps } from '../contracts'
import { ConfirmButton, Label, PhraseChip } from '../../components/primitives'
import { editorKeyAction } from '../../lib/keys'
import './editor.css'

/** Entry editor pane — reference: docs/reference/3b-editor.html (handoff §6). */
const EditorPane = (props: EditorPaneProps): JSX.Element => {
  const {
    question,
    points,
    story,
    triggers,
    onQuestionChange,
    onPointChange,
    onPointAdd,
    onPointRemove,
    onPointsReorder,
    onTriggerAdd,
    onTriggerRemove,
    onSwapStory,
    dirty,
    onDelete,
    excerpt,
    onUseExcerptLine,
    onCondenseExcerpt,
    condensing,
    seedTriggerPhrase,
    onCancel,
    onSave
  } = props

  // -- auto-growing question textarea --
  const questionRef = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const el = questionRef.current
    if (el) {
      el.style.height = 'auto'
      el.style.height = `${el.scrollHeight}px`
    }
  }, [question])

  // -- local (uncommitted) input state --
  const [newPoint, setNewPoint] = useState('')
  // seeded from the recap's near-miss fix: the wording that failed to reach
  // this answer, sitting in the box for the user to cut down. It is not a
  // trigger phrase until they press Enter, and not saved until they save.
  const [newTrigger, setNewTrigger] = useState(seedTriggerPhrase ?? '')

  // -- drag reorder: row is draggable only while the handle is pressed --
  const [armedIndex, setArmedIndex] = useState<number | null>(null)
  const [dragFrom, setDragFrom] = useState<number | null>(null)
  const [dragOver, setDragOver] = useState<number | null>(null)

  const resetDrag = (): void => {
    setArmedIndex(null)
    setDragFrom(null)
    setDragOver(null)
  }

  // Esc on a draft with unsaved work asks once before throwing it away —
  // the same two-press shape as ending a session (REVIEW.md P6)
  const [discardArmed, setDiscardArmed] = useState(false)
  useEffect(() => {
    if (!discardArmed) return
    const id = window.setTimeout(() => setDiscardArmed(false), 2500)
    return () => window.clearTimeout(id)
  }, [discardArmed])

  // Bound on the window, not the pane: opening the editor leaves focus on the
  // button that opened it, so a handler on the pane div never sees the
  // keystroke. Only mounted while the editor is.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent): void => {
      const action = editorKeyAction(e, { dirty: dirty === true, discardArmed })
      if (!action) return
      if (action.kind === 'move') {
        // which point row has focus, straight from the DOM
        const attr = document.activeElement?.getAttribute('data-point-index')
        const from = attr == null ? -1 : Number(attr)
        const to = from + action.delta
        if (from < 0 || to < 0 || to >= points.length) return
        e.preventDefault()
        onPointsReorder(from, to)
        return
      }
      e.preventDefault()
      if (action.kind === 'save') onSave()
      else if (action.kind === 'arm-discard') setDiscardArmed(true)
      else {
        setDiscardArmed(false)
        onCancel()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [dirty, discardArmed, points.length, onPointsReorder, onSave, onCancel])

  const handlePointKeyDown = (e: KeyboardEvent<HTMLInputElement>, id: string): void => {
    if (e.key === 'Backspace' && e.currentTarget.value === '') {
      e.preventDefault()
      onPointRemove(id)
    }
  }

  const handleAddKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      const text = newPoint.trim()
      if (text !== '') {
        onPointAdd(text)
        setNewPoint('')
      }
    }
  }

  const handleTriggerKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      const text = newTrigger.trim()
      if (text !== '') {
        onTriggerAdd(text)
        setNewTrigger('')
      }
    }
  }

  return (
    <div className="editor-pane">
      <div className="editor-header">
        <Label crumb>EDITING</Label>
        <div className="editor-header__actions">
          {onDelete && (
            <ConfirmButton
              className="editor-delete"
              label="Delete"
              confirmLabel="Delete for good?"
              onConfirm={onDelete}
            />
          )}
          <button
            className={discardArmed ? 'editor-cancel editor-cancel--armed' : 'editor-cancel'}
            onClick={onCancel}
          >
            {discardArmed ? 'Esc again to discard' : 'Cancel'}
          </button>
          <button className="editor-save" onClick={onSave}>
            Save
          </button>
        </div>
      </div>

      <div className="editor-body">
        {/* -- question -- */}
        <div className="editor-field">
          <Label>QUESTION</Label>
          <textarea
            ref={questionRef}
            className="editor-question pretty"
            rows={1}
            value={question}
            onChange={(e) => onQuestionChange(e.target.value)}
          />
        </div>

        {/* -- key points -- */}
        <div className="editor-field">
          <div className="editor-points-head">
            <Label>KEY POINTS</Label>
            <div className="editor-drag-hint">drag to reorder</div>
          </div>
          <div className="editor-points">
            {points.map((p, i) => {
              const dropping = dragOver === i && dragFrom !== null && dragFrom !== i
              return (
                <div
                  key={p.id}
                  className={dropping ? 'editor-point editor-point--dropping' : 'editor-point'}
                  draggable={armedIndex === i}
                  onDragStart={(e: DragEvent<HTMLDivElement>) => {
                    if (armedIndex !== i) {
                      e.preventDefault()
                      return
                    }
                    setDragFrom(i)
                    e.dataTransfer.effectAllowed = 'move'
                    e.dataTransfer.setData('text/plain', '')
                  }}
                  onDragOver={(e: DragEvent<HTMLDivElement>) => {
                    if (dragFrom === null) return
                    e.preventDefault()
                    e.dataTransfer.dropEffect = 'move'
                    if (dragOver !== i) setDragOver(i)
                  }}
                  onDrop={(e: DragEvent<HTMLDivElement>) => {
                    e.preventDefault()
                    if (dragFrom !== null && dragFrom !== i) onPointsReorder(dragFrom, i)
                    resetDrag()
                  }}
                  onDragEnd={resetDrag}
                >
                  <div
                    className="editor-point__handle"
                    onMouseDown={() => setArmedIndex(i)}
                    onMouseUp={() => setArmedIndex(null)}
                  >
                    ⠿
                  </div>
                  <input
                    className="editor-point__input"
                    type="text"
                    data-point-index={i}
                    value={p.text}
                    onChange={(e) => onPointChange(p.id, e.target.value)}
                    onKeyDown={(e) => handlePointKeyDown(e, p.id)}
                  />
                </div>
              )
            })}
            <div className="editor-point-add">
              <input
                className="editor-point-add__input"
                type="text"
                placeholder="Add a point — keep it sayable in one breath"
                value={newPoint}
                onChange={(e) => setNewPoint(e.target.value)}
                onKeyDown={handleAddKeyDown}
              />
            </div>
          </div>
        </div>

        {/* -- what you said at the time --
            The recap has always handed the editor this excerpt and the editor
            has always thrown it away. It is the zero-model version of "help me
            write this": your own words, next to the field, one click from
            being a point you can edit. */}
        {excerpt != null && excerpt.length > 0 && (
          <div className="editor-field">
            <Label>WHAT YOU SAID AT THE TIME</Label>
            <div className="editor-excerpt">
              {excerpt.map((line, i) => (
                <button
                  key={i}
                  type="button"
                  className="editor-excerpt__line pretty"
                  onClick={() => onUseExcerptLine?.(line)}
                  title="Use this as a point"
                >
                  {line}
                </button>
              ))}
            </div>
            <div className="editor-excerpt__foot">
              <div className="editor-triggers-help pretty">
                Your side of it, from the session. Click a line to make it a point, then cut it
                down to something sayable.
              </div>
              {onCondenseExcerpt && (
                <button
                  type="button"
                  className="action editor-excerpt__condense"
                  onClick={onCondenseExcerpt}
                  disabled={condensing === true}
                >
                  {condensing ? 'Working…' : 'Make points from this'}
                </button>
              )}
            </div>
          </div>
        )}

        {/* -- story -- */}
        <div className="editor-field">
          <Label>STORY</Label>
          <div className="editor-story">
            <div className="editor-story__main">
              <div
                className={
                  story ? 'editor-story__name' : 'editor-story__name editor-story__name--none'
                }
              >
                {story ? story.title : 'No story attached'}
              </div>
              <div className="editor-story__sub">
                {story ? story.sub : 'pick one from the stories library'}
              </div>
            </div>
            <button className="action editor-story__action" onClick={onSwapStory}>
              {story ? 'Swap' : 'Pick'}
            </button>
          </div>
        </div>

        {/* -- trigger phrases -- */}
        <div className="editor-field">
          <Label>TRIGGER PHRASES</Label>
          <div className="editor-triggers">
            {triggers.map((t) => (
              <PhraseChip key={t} onRemove={() => onTriggerRemove(t)}>
                “{t}”
              </PhraseChip>
            ))}
            <PhraseChip dashed>
              <input
                className="editor-trigger-input"
                type="text"
                placeholder="type a phrase…"
                value={newTrigger}
                onChange={(e) => setNewTrigger(e.target.value)}
                onKeyDown={handleTriggerKeyDown}
              />
            </PhraseChip>
          </div>
          <div className="editor-triggers-help pretty">
            Matching is fuzzy — phrases only help when the wording is unusual.
          </div>
        </div>
      </div>
    </div>
  )
}

export default EditorPane
