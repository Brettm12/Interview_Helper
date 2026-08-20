import type { CSSProperties, ReactNode } from 'react'
import './primitives.css'

/** 7px (panel/setup) or 6px (strip) or 5px (point marker) status dot */
export function StatusDot({
  size = 7,
  color = 'var(--status-live)',
  style
}: {
  size?: 5 | 6 | 7
  color?: string
  style?: CSSProperties
}) {
  return (
    <div
      className="dot"
      style={{ width: size, height: size, background: color, ...style }}
    />
  )
}

/** standard 9.5px mono section label */
export function Label({
  children,
  crumb = false,
  style
}: {
  children: ReactNode
  crumb?: boolean
  style?: CSSProperties
}) {
  return (
    <div className={crumb ? 'label label--crumb' : 'label'} style={style}>
      {children}
    </div>
  )
}

/** the 44×2 covered-points bar; pct 0–100 */
export function ProgressBar({ pct, width = 44 }: { pct: number; width?: number }) {
  const clamped = Math.max(0, Math.min(100, pct))
  return (
    <div
      className="progress-bar"
      style={{
        width,
        background: `linear-gradient(90deg, var(--status-live) ${clamped}%, var(--track-progress) ${clamped}%)`
      }}
    />
  )
}

/** unsure-state auto-pick bar: 3px, amber fill on #26292e */
export function AutoPickBar({ pct }: { pct: number }) {
  return (
    <div className="autopick-track">
      <div className="autopick-fill" style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
    </div>
  )
}

/** 5-bar audio level meter (2.5px bars, bottom-aligned).
 *
 *  Heights come from the real smoothed input level. There used to be a 1.1s
 *  CSS "bob" animation running underneath, uncorrelated with the audio — it
 *  beat against the React updates and, because the meter was unmounted
 *  whenever the source went quiet, restarted from scratch on every flip. A
 *  meter that moves with your voice is honest; one that bobs on a timer is
 *  decoration that implies signal where there may be none. */
export function LevelMeter({
  heights = [6, 13, 9, 14, 5],
  color = 'var(--status-live)',
  live = false
}: {
  heights?: number[]
  color?: string
  live?: boolean
}) {
  const bars = heights.length > 0 ? heights : [2, 2, 2, 2, 2]
  return (
    <div className={live ? 'level-meter' : 'level-meter level-meter--idle'}>
      {bars.map((h, i) => (
        <div
          key={i}
          className="level-bar"
          style={{ height: Math.max(2, h), background: color }}
        />
      ))}
    </div>
  )
}

/** setup/recap stat card; warning variant per the token table */
export function StatCard({
  number,
  caption,
  warning = false,
  onClick
}: {
  number: ReactNode
  caption: string
  warning?: boolean
  onClick?: () => void
}) {
  return (
    <div
      className={warning ? 'stat-card stat-card--warn' : 'stat-card'}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
    >
      <div className="stat-card__num">{number}</div>
      <div className="stat-card__caption">{caption}</div>
    </div>
  )
}

/** story card. 'live' is the 2a panel card (15/16, body 1.45, metrics 12);
 *  'detail' is the 3a bank card (16/17, body 1.5, metrics 13). */
export function StoryCard({
  label,
  body,
  metrics,
  usedIn,
  variant = 'live'
}: {
  label: string
  body: string
  metrics: string[]
  usedIn?: number
  variant?: 'live' | 'detail'
}) {
  return (
    <div className={variant === 'detail' ? 'story-card story-card--detail' : 'story-card'}>
      {usedIn != null ? (
        <div className="story-card__head">
          <Label style={{ marginBottom: 0 }}>{label}</Label>
          <div className="story-card__used">used in {usedIn} answer{usedIn === 1 ? '' : 's'}</div>
        </div>
      ) : (
        <Label style={{ marginBottom: 9 }}>{label}</Label>
      )}
      <div className="story-card__body pretty">{body}</div>
      {metrics.length > 0 && (
        <div className="story-card__metrics">
          {metrics.map((m) => (
            <div key={m} className="metric-chip">
              {m}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export type PointState = 'covered' | 'current' | 'upcoming' | 'plain'

/** a key-point row in one of the live panel's three states.
 *  'plain' is the bank-detail variant: green dot, body text, no emphasis. */
export function PointRow({
  state,
  text,
  onClick
}: {
  state: PointState
  text: string
  onClick?: () => void
}) {
  return (
    <div className={`point-row point-row--${state}`} onClick={onClick}>
      {state === 'covered' ? (
        <div className="point-row__check">✓</div>
      ) : (
        <div
          className="point-row__dot"
          style={{
            background:
              state === 'upcoming' ? 'var(--dot-inactive)' : 'var(--status-live)'
          }}
        />
      )}
      <div className="point-row__text pretty">{text}</div>
    </div>
  )
}

/** trigger-phrase chip; dashed add/input variant via `dashed` */
export function PhraseChip({
  children,
  dashed = false,
  onRemove,
  onClick
}: {
  children: ReactNode
  dashed?: boolean
  onRemove?: () => void
  onClick?: () => void
}) {
  return (
    <div className={dashed ? 'phrase-chip phrase-chip--dashed' : 'phrase-chip'} onClick={onClick}>
      {children}
      {onRemove && (
        <span
          className="phrase-chip__x"
          onClick={(e) => {
            e.stopPropagation()
            onRemove()
          }}
        >
          ×
        </span>
      )}
    </div>
  )
}
