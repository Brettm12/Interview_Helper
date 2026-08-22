import type { MouseEvent } from 'react'
import type { StripProps } from '../contracts'
import { StatusDot } from '../../components/primitives'
import './strip.css'

/** Share-safe strip (reference 2c): the panel collapsed to a single line
 *  while screen-sharing. Whole strip expands; ▾ / "open" are the explicit
 *  no-drag affordances so clicks land on the frameless window. */
const Strip = (props: StripProps): JSX.Element => {
  const { variant, text, counter, overlay, protectionOn, protectionUnsupported, paused, onExpand } =
    props

  const expandFromAffordance = (e: MouseEvent<HTMLDivElement>): void => {
    e.stopPropagation()
    onExpand()
  }

  const className = [
    'strip',
    overlay ? 'strip--overlay' : '',
    variant === 'new-question' ? 'strip--new' : ''
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div
      className={className}
      title={
        // "share-safe" must not be claimed where the OS cannot deliver it
        // (REVIEW.md M21: setContentProtection is a no-op on Linux)
        protectionUnsupported
          ? 'Content protection is not supported on this OS — this window IS visible in shares'
          : protectionOn
            ? 'Excluded from screen capture'
            : 'Content protection off — this window is visible in shares'
      }
      onClick={onExpand}
    >
      <StatusDot
        size={6}
        color={
          // a live-green dot with the microphone closed is a lie (REVIEW.md P2)
          paused
            ? 'var(--dot-inactive)'
            : variant === 'new-question'
              ? 'var(--status-attention)'
              : 'var(--status-live)'
        }
      />
      <div className="strip__text">{text}</div>
      {variant !== 'new-question' && counter != null && (
        <div className="strip__counter">{counter}</div>
      )}
      {variant === 'current' && (
        <div className="strip__affordance strip__caret" onClick={expandFromAffordance}>
          ▾
        </div>
      )}
      {variant === 'new-question' && (
        <div className="strip__affordance strip__open" onClick={expandFromAffordance}>
          open
        </div>
      )}
    </div>
  )
}

export default Strip
