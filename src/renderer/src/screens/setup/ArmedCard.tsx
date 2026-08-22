import type { ArmedCardProps } from '../contracts'
import { Label, StatusDot } from '../../components/primitives'
import './setup.css'

export default function ArmedCard(props: ArmedCardProps): JSX.Element {
  const { headline, openers, statusLeft, onPause } = props

  return (
    <div className="armed">
      <div className="armed-head">
        <StatusDot size={7} />
        <Label>ARMED · WAITING FOR THEM</Label>
      </div>
      <div className="armed-headline pretty">{headline}</div>
      <div className="armed-openers">
        <Label>MOST LIKELY OPENER</Label>
        {openers.map((opener, i) => (
          <div
            key={i}
            className={i === 0 ? 'armed-opener armed-opener--lead' : 'armed-opener'}
          >
            {opener}
          </div>
        ))}
      </div>
      <div className="armed-footer">
        <span className="footer-hint">{statusLeft}</span>
        <button type="button" className="footer-hint armed-footer__pause" onClick={onPause}>
          Pause
        </button>
      </div>
    </div>
  )
}
