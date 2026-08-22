import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { MatchedBodyProps } from '../contracts'
import { Label, PointRow, ProgressBar, StoryCard } from '../../components/primitives'
import './live.css'

/** Matched-state body: progress + question (crossfade/height swap), key points,
 *  story card, and the EARLIER history pushed to the bottom. */
export default function MatchedBody(props: MatchedBodyProps): JSX.Element {
  const { question, covered, total, pacing, points, onTogglePoint, story, earlier } = props

  // Question swap: pin the box height, crossfade old/new, animate to the new
  // height (~200ms ease-out), then release back to auto. No layout jump.
  const [shown, setShown] = useState(question)
  const [leaving, setLeaving] = useState<string | null>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const currentRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    if (question === shown) return
    const box = boxRef.current
    if (box) {
      // pin the outgoing height so the transition has a start value
      box.style.height = `${box.offsetHeight}px`
      void box.offsetHeight // flush so the pin is committed before the target
    }
    setLeaving(shown)
    setShown(question)
  }, [question, shown])

  useLayoutEffect(() => {
    if (leaving === null) return
    const box = boxRef.current
    const cur = currentRef.current
    if (box && cur) box.style.height = `${cur.offsetHeight}px`
  }, [shown, leaving])

  useEffect(() => {
    if (leaving === null) return
    const t = window.setTimeout(() => {
      setLeaving(null)
      if (boxRef.current) boxRef.current.style.height = 'auto'
    }, 200)
    return () => window.clearTimeout(t)
  }, [leaving])

  return (
    <div className="live-body">
      <div>
        <div className="live-progress">
          <ProgressBar pct={total > 0 ? (covered / total) * 100 : 0} />
          <Label>
            {covered} OF {total} COVERED{pacing ? ` · ${pacing}` : ''}
          </Label>
        </div>
        <div ref={boxRef} className="live-qbox">
          {leaving !== null && (
            <div key={`out-${leaving}`} className="live-question live-question--out pretty">
              {leaving}
            </div>
          )}
          <div
            key={shown}
            ref={currentRef}
            className={
              leaving !== null ? 'live-question live-question--in pretty' : 'live-question pretty'
            }
          >
            {shown}
          </div>
        </div>
      </div>

      <div className="live-points">
        {points.map((p) => (
          <PointRow key={p.id} state={p.state} text={p.text} onClick={() => onTogglePoint(p.id)} />
        ))}
      </div>

      {story && <StoryCard label={story.label} body={story.body} metrics={story.metrics} />}

      {earlier.length > 0 && (
        <div className="live-earlier">
          <Label>EARLIER</Label>
          {earlier.map((e) => (
            <div key={e.key} className="live-earlier__row">
              {e.question} · {e.time}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
