import type { UnsureBodyProps } from '../contracts'
import { AutoPickBar, Label } from '../../components/primitives'
import './live.css'

/** Unsure-state body: heard phrase, ranked candidate cards, and the
 *  auto-pick countdown block pushed to the bottom. */
export default function UnsureBody(props: UnsureBodyProps): JSX.Element {
  const { heard, candidates, countdownSec, countdownPct, onPick, onNone, onSearchBank } = props

  return (
    <div className="live-unsure">
      <div className="live-unsure__heard pretty">“{heard}”</div>
      <Label style={{ color: 'var(--text-dim)' }}>TAP THE ONE THEY MEANT</Label>

      {candidates.map((c, i) => (
        <div
          key={c.entryId}
          className={i === 0 ? 'live-cand live-cand--top' : 'live-cand'}
          onClick={() => onPick(c.entryId)}
        >
          <div className="live-cand__row">
            <div className="live-cand__title pretty">{c.title}</div>
            <div className="live-cand__pct">{Math.round(c.pct)}%</div>
          </div>
          <div className="live-cand__sub">{c.sub}</div>
        </div>
      ))}

      <div className="live-unsure__bottom">
        <div className="live-unsure__auto">
          <div className="live-unsure__auto-text">
            {countdownSec == null ? 'Keeps listening — waits for you' : 'Keeps listening — picks on its own'}
          </div>
          {countdownSec != null && <div className="live-unsure__count">{countdownSec}s</div>}
        </div>
        {countdownSec != null && <AutoPickBar pct={countdownPct} />}
        <div className="live-unsure__btns">
          <button className="live-unsure__btn" onClick={onNone}>
            None of these
          </button>
          <button className="live-unsure__btn" onClick={onSearchBank}>
            Search bank
          </button>
        </div>
      </div>
    </div>
  )
}
