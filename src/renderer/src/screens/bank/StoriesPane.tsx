import { useState } from 'react'
import type { KeyboardEvent } from 'react'
import type { StoriesPaneProps } from '../contracts'
import { ConfirmButton, Label } from '../../components/primitives'
import './stories.css'

// Shared stories library, living in the bank's pane 3. No mock exists for
// this surface — it borrows the editor's field styles (docs/reference/3b) and
// the bank's row idiom so it reads as part of the same app. Stories are
// shared entities: saving one updates every answer that references it.

const StoriesPane = (props: StoriesPaneProps): JSX.Element => {
  const {
    rows,
    draft,
    onSelect,
    onNew,
    onTitleChange,
    onBodyChange,
    onMetricAdd,
    onMetricRemove,
    onSave,
    onDelete,
    draftUsedIn = 0,
    onClose
  } = props

  const [newMetric, setNewMetric] = useState('')

  const handleMetricKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      const m = newMetric.trim()
      if (m !== '') {
        onMetricAdd(m)
        setNewMetric('')
      }
    }
  }

  return (
    <div className="stories-pane">
      <div className="stories-header">
        <Label crumb>STORIES LIBRARY · {rows.length}</Label>
        <div className="stories-header__actions">
          <button className="chip" onClick={onNew}>
            New story
          </button>
          <button className="stories-close" onClick={onClose}>
            Close
          </button>
        </div>
      </div>

      <div className="stories-body">
        <div className="stories-list">
          {rows.map((r) => {
            const selected = draft?.storyId === r.id
            return (
              <button
                type="button"
                key={r.id}
                className={selected ? 'stories-row stories-row--selected' : 'stories-row'}
                onClick={() => onSelect(r.id)}
              >
                <div className="stories-row__title">{r.title}</div>
                <div className="stories-row__sub">{r.sub}</div>
              </button>
            )
          })}
        </div>

        {draft != null && (
          <div className="stories-edit">
            <div className="stories-field">
              <Label>TITLE</Label>
              <input
                className="stories-title-input"
                type="text"
                value={draft.title}
                placeholder="Name the story — you'll pick it by this"
                onChange={(e) => onTitleChange(e.target.value)}
              />
            </div>

            <div className="stories-field">
              <Label>STORY</Label>
              <textarea
                className="stories-body-input pretty"
                rows={4}
                value={draft.body}
                placeholder="The story as you'd tell it — two or three sentences, ending on the result"
                onChange={(e) => onBodyChange(e.target.value)}
              />
            </div>

            <div className="stories-field">
              <Label>METRICS</Label>
              <div className="stories-metrics">
                {draft.metrics.map((m) => (
                  <div key={m} className="metric-chip stories-metric">
                    {m}
                    <button type="button" className="stories-metric__x" onClick={() => onMetricRemove(m)}>
                      ×
                    </button>
                  </div>
                ))}
                <input
                  className="stories-metric-input"
                  type="text"
                  value={newMetric}
                  placeholder="add a metric…"
                  onChange={(e) => setNewMetric(e.target.value)}
                  onKeyDown={handleMetricKeyDown}
                />
              </div>
            </div>

            <div className="stories-save-row">
              <div className="stories-note pretty">
                Shared story — saving updates every answer that uses it.
              </div>
              <div className="stories-save-row__actions">
                {onDelete && (
                  <ConfirmButton
                    className="stories-delete"
                    label="Delete"
                    confirmLabel={
                      draftUsedIn > 0
                        ? `Delete — clears it from ${draftUsedIn} ${draftUsedIn === 1 ? 'answer' : 'answers'}?`
                        : 'Delete for good?'
                    }
                    onConfirm={onDelete}
                  />
                )}
                <button className="stories-save" onClick={onSave}>
                  Save
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default StoriesPane
