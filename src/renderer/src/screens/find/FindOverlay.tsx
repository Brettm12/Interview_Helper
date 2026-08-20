import type { KeyboardEvent, ReactNode } from 'react'
import type { FindOverlayProps } from '../contracts'
import './find.css'

/** first case-insensitive occurrence of `query` in `title`, wrapped in the
 *  green highlight span; plain text when the query is empty or absent */
function highlightTitle(title: string, query: string): ReactNode {
  if (query === '') return title
  const idx = title.toLowerCase().indexOf(query.toLowerCase())
  if (idx === -1) return title
  return (
    <>
      {title.slice(0, idx)}
      <span className="find-hl">{title.slice(idx, idx + query.length)}</span>
      {title.slice(idx + query.length)}
    </>
  )
}

const FindOverlay = (props: FindOverlayProps): JSX.Element => {
  const { query, matchCount, results, selectedIndex, onQueryChange, onMove, onPin, onClose } = props

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      onMove(1)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      onMove(-1)
    } else if (e.key === 'Enter') {
      onPin()
    } else if (e.key === 'Escape') {
      onClose()
    }
  }

  return (
    <div className="find-overlay">
      <div className="find-header">
        <div className="find-header__row">
          <div className="find-header__glyph">⌘K</div>
          <input
            className="find-header__input"
            type="text"
            value={query}
            autoFocus
            onChange={(e) => onQueryChange(e.target.value)}
            onKeyDown={handleKeyDown}
          />
        </div>
      </div>
      <div className="find-body">
        <div className="label find-count">
          {matchCount} {matchCount === 1 ? 'MATCH' : 'MATCHES'}
        </div>
        {results.map((r, i) => {
          const selected = i === selectedIndex
          const last = i === results.length - 1
          return (
            <div
              key={r.entryId}
              className={[
                'find-row',
                selected ? 'find-row--selected' : '',
                last ? 'find-row--last' : ''
              ]
                .filter(Boolean)
                .join(' ')}
              onClick={() => {
                onMove(i - selectedIndex)
                onPin()
              }}
            >
              <div
                className={
                  selected ? 'find-row__title find-row__title--selected pretty' : 'find-row__title pretty'
                }
              >
                {highlightTitle(r.title, query)}
              </div>
              {selected
                ? r.preview != null && (
                    <div className="find-row__preview pretty">{r.preview.join(' · ')}</div>
                  )
                : r.sub != null && <div className="find-row__sub">{r.sub}</div>}
            </div>
          )
        })}
        <div className="find-footer">
          <span>↑↓ move</span>
          <span>↵ pin it</span>
          <span>esc back to live</span>
        </div>
      </div>
    </div>
  )
}

export default FindOverlay
