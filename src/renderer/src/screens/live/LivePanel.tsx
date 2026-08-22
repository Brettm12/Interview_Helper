import { Fragment } from 'react'
import type { ReactNode } from 'react'
import type { LivePanelProps, TranscriptLineView } from '../contracts'
import { Label, StatusDot } from '../../components/primitives'
import MatchedBody from './MatchedBody'
import UnsureBody from './UnsureBody'
import './live.css'

/** index where the last `n` words of `text` begin (for the trailing-fade span) */
function trailingStartIndex(text: string, n: number): number {
  if (n <= 0) return text.length
  let i = text.length
  for (let w = 0; w < n && i > 0; w++) {
    while (i > 0 && text[i - 1] === ' ') i--
    while (i > 0 && text[i - 1] !== ' ') i--
  }
  return i
}

/** transcript text split into plain / highlighted / trailing-faded spans */
function transcriptSegments(t: TranscriptLineView): ReactNode {
  const { text, highlight } = t
  const trailStart = trailingStartIndex(text, t.trailingWords ?? 0)
  const hiStart = highlight ? text.indexOf(highlight) : -1
  const cutSet = new Set<number>([0, text.length, trailStart])
  if (highlight && hiStart >= 0) {
    cutSet.add(hiStart)
    cutSet.add(hiStart + highlight.length)
  }
  const cuts = [...cutSet].sort((a, b) => a - b)
  const nodes: ReactNode[] = []
  for (let i = 0; i < cuts.length - 1; i++) {
    const start = cuts[i]
    const end = cuts[i + 1]
    if (start >= end) continue
    let node: ReactNode = text.slice(start, end)
    if (highlight && hiStart >= 0 && start >= hiStart && end <= hiStart + highlight.length) {
      node = <span className="live-transcript__hl">{node}</span>
    }
    if (start >= trailStart) {
      node = <span className="live-transcript__trail">{node}</span>
    }
    nodes.push(<Fragment key={start}>{node}</Fragment>)
  }
  return nodes
}

function TranscriptLine({
  line,
  prefix = true
}: {
  line: TranscriptLineView
  /** the 1a unsure footer drops the speaker prefix */
  prefix?: boolean
}): JSX.Element {
  return (
    <div className="live-transcript__line pretty">
      {prefix ? `${line.speaker}: ` : ''}
      {transcriptSegments(line)}
    </div>
  )
}

/** The docked helper panel: header, matched/unsure body, transcript footer. */
export default function LivePanel(props: LivePanelProps): JSX.Element {
  const {
    mode,
    matched,
    unsure,
    transcript,
    transcriptVisible,
    paused,
    stale,
    notice,
    onToggleTranscript,
    onFind,
    onCollapse,
    onSearchBank
  } = props
  const isUnsure = mode === 'unsure'
  const showLine = transcriptVisible && transcript !== null

  return (
    <div className={stale ? 'live-panel live-panel--stale' : 'live-panel'}>
      {notice && <div className="live-notice pretty">{notice}</div>}
      <div className="live-panel__header">
        <div className="live-panel__status">
          <StatusDot
            size={7}
            color={
              // pause actually closes the tracks, so a green "Listening" here
              // is the last dishonest dot in the app (REVIEW.md P2); a stale
              // card is the same lie about a different fact
              paused
                ? 'var(--dot-inactive)'
                : isUnsure || stale
                  ? 'var(--status-attention)'
                  : 'var(--status-live)'
            }
          />
          <div className="live-panel__status-text">
            {paused
              ? 'Paused — mic is off'
              : stale
                ? 'Nothing matched'
                : isUnsure
                  ? 'Not sure which one'
                  : 'Listening'}
          </div>
        </div>
        {isUnsure ? (
          <button className="live-panel__header-action" onClick={onSearchBank}>
            Search bank
          </button>
        ) : (
          <div className="live-panel__actions">
            <button className="chip chip--mono" onClick={onFind}>
              ⌘K find
            </button>
            <button className="live-panel__header-action" onClick={onCollapse}>
              Collapse
            </button>
          </div>
        )}
      </div>

      {isUnsure
        ? unsure && <UnsureBody {...unsure} />
        : matched && <MatchedBody {...matched} />}

      {isUnsure ? (
        showLine &&
        transcript && (
          <div className="live-transcript">
            <TranscriptLine line={transcript} prefix={false} />
          </div>
        )
      ) : (
        <div className="live-transcript">
          <div
            className={
              showLine ? 'live-transcript__head live-transcript__head--open' : 'live-transcript__head'
            }
          >
            <Label>TRANSCRIPT</Label>
            <button className="live-transcript__toggle" onClick={onToggleTranscript}>
              {transcriptVisible ? 'hide' : 'show'}
            </button>
          </div>
          {showLine && transcript && <TranscriptLine line={transcript} />}
        </div>
      )}
    </div>
  )
}
