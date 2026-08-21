import { useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { RecapRowView, RecapScreenProps, TranscriptLineView } from '../contracts'
import { Label, ProgressBar, StatCard } from '../../components/primitives'
import './recap.css'

/** transcript text with the matched phrase wrapped in a highlight span */
function lineNodes(line: TranscriptLineView): ReactNode {
  const { text, highlight } = line
  const at = highlight ? text.indexOf(highlight) : -1
  if (!highlight || at < 0) return text
  return (
    <>
      {text.slice(0, at)}
      <span className="recap-row__hl">{highlight}</span>
      {text.slice(at + highlight.length)}
    </>
  )
}

function RecapRow({ row }: { row: RecapRowView }): JSX.Element {
  const [open, setOpen] = useState(false)
  const [innerHeight, setInnerHeight] = useState(0)
  const innerRef = useRef<HTMLDivElement>(null)
  const expandable = row.transcript !== null && !row.transcriptOff
  const addToBank = row.onAddToBank

  // keep the measured natural height fresh (content is laid out even while
  // collapsed, so the first open animates from 0 to a real pixel height)
  useLayoutEffect(() => {
    if (innerRef.current) setInnerHeight(innerRef.current.offsetHeight)
  })

  const rowClass = [
    'recap-row',
    row.matched ? '' : 'recap-row--unmatched',
    expandable ? 'recap-row--expandable' : ''
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className={rowClass} onClick={expandable ? () => setOpen((o) => !o) : undefined}>
      <div className="recap-row__time">{row.time}</div>
      <div className="recap-row__mid">
        <div className="recap-row__question pretty">{row.question}</div>
        <div
          className={
            row.matched ? 'recap-row__sub pretty' : 'recap-row__sub recap-row__sub--unmatched pretty'
          }
        >
          {row.subLine}
        </div>
        {expandable && row.transcript && (
          <div className="recap-row__expand" style={{ height: open ? innerHeight : 0 }}>
            <div ref={innerRef} className="recap-row__transcript">
              {row.transcript.map((line, i) => (
                <div key={i} className="recap-row__tline pretty">
                  {line.speaker}: {lineNodes(line)}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      <div className="recap-row__right">
        {row.matched ? (
          <>
            {row.coveredPct !== null && <ProgressBar pct={row.coveredPct} />}
            {row.counter !== null && <div className="recap-row__counter">{row.counter}</div>}
          </>
        ) : (
          addToBank && (
            <button
              className="recap-row__add"
              onClick={(e) => {
                e.stopPropagation()
                addToBank()
              }}
            >
              Add to bank →
            </button>
          )
        )}
      </div>
    </div>
  )
}

/** Post-interview recap: stats, question-by-question, worth fixing. */
export default function RecapScreen(props: RecapScreenProps): JSX.Element {
  const {
    eyebrow,
    title,
    sub,
    stats,
    rows,
    fixes,
    practiceCount,
    notice,
    onDeleteSession,
    onSaveToLoop,
    onExport,
    onPractice
  } = props

  return (
    <div className="recap-screen">
      {notice != null && <div className="recap-notice pretty">{notice}</div>}
      <div className="recap-header">
        <div>
          <Label style={{ marginBottom: 10 }}>{eyebrow}</Label>
          <div className="recap-header__title">{title}</div>
          <div className="recap-header__sub pretty">{sub}</div>
        </div>
        <div className="recap-header__actions">
          <button className="recap-header__delete" onClick={onDeleteSession}>
            Delete session
          </button>
          <button className="cta" onClick={onSaveToLoop}>
            Save to loop
          </button>
        </div>
      </div>

      <div className="recap-body">
        <div className="recap-group">
          <Label>HOW IT WENT</Label>
          <div className="recap-stats">
            <StatCard
              number={stats.covered}
              caption={`points covered out of ${stats.totalPoints}`}
            />
            <StatCard number={stats.matched} caption="questions matched to your bank" />
            <StatCard
              number={stats.unmatched}
              caption="questions not in the bank at all"
              warning={stats.unmatched > 0}
            />
          </div>
        </div>

        <div className="recap-group">
          <Label>QUESTION BY QUESTION</Label>
          <div className="recap-qlist">
            {rows.map((row) => (
              <RecapRow key={row.id} row={row} />
            ))}
          </div>
        </div>

        <div className="recap-group">
          <Label>WORTH FIXING</Label>
          {fixes.length === 0 ? (
            <div className="recap-nothing pretty">
              Nothing to fix — every question matched and every point landed.
            </div>
          ) : (
            <div className="recap-fixes">
              {fixes.map((fix) => (
                <div key={fix.id} className="recap-fix">
                  <div>
                    <div className="recap-fix__title pretty">{fix.title}</div>
                    <div className="recap-fix__why pretty">{fix.why}</div>
                  </div>
                  <button className="chip" onClick={fix.onAction}>
                    {fix.chip}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="recap-privacy pretty">
          Transcript is on this machine only. Deleting the session removes it.
        </div>

        <div className="recap-footer">
          <div className="recap-footer__hints">
            <button className="footer-hint" onClick={onExport}>
              ⌘E export as notes
            </button>
            <button className="footer-hint" onClick={onDeleteSession}>
              ⌘⌫ delete session
            </button>
          </div>
          {practiceCount > 0 && (
            <button className="recap-footer__practice" onClick={onPractice}>
              Practice the {practiceCount} I missed →
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
