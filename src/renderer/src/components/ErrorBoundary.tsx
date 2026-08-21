import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { useBankStore } from '../state/bankStore'
import { useSessionStore } from '../state/sessionStore'
import { api } from '../lib/api'

// The worst failure mode is a white screen mid-interview. This boundary reads
// the stores imperatively (zustand state survives a render crash) and falls
// back to a static list of the active entry's points, styled with base.css
// micro-classes only — no screens/ dependency, so a screen bug can't take the
// fallback down with it.

interface State {
  error: Error | null
}

export default class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[panel crash]', error, info.componentStack)
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children

    // The 366×39 strip window can't fit the panel fallback — it rendered one
    // clipped line with the recovery buttons out of reach (REVIEW.md L7).
    // One line, one action: get the full panel back.
    if (new URLSearchParams(window.location.search).get('window') === 'strip') {
      return (
        <div
          style={{
            padding: '10px 12px',
            font: '500 12.5px/1.3 var(--font-ui)',
            color: 'var(--status-attention)',
            cursor: 'pointer',
            whiteSpace: 'nowrap'
          }}
          onClick={() => void api.strip.expand()}
        >
          Strip hit an error — click to reopen the panel
        </div>
      )
    }

    const session = useSessionStore.getState()
    const bank = useBankStore.getState().bank
    const entry =
      session.match.entryId && bank
        ? (bank.answers.find((a) => a.id === session.match.entryId) ?? null)
        : null
    const covered = new Set(entry ? (session.coverage[entry.id] ?? []) : [])

    return (
      <div style={{ padding: '22px 18px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div className="label">PANEL HIT AN ERROR — YOUR POINTS ARE STILL HERE</div>
        {entry ? (
          <>
            <div style={{ font: '400 21px/1.32 var(--font-serif)', color: 'var(--text-primary)' }}>
              {entry.question}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {entry.points.map((p) => (
                <div
                  key={p.id}
                  style={{
                    font: '400 15.5px/1.42 var(--font-ui)',
                    color: 'var(--text-body)',
                    textDecoration: covered.has(p.id) ? 'line-through' : 'none',
                    opacity: covered.has(p.id) ? 0.4 : 1
                  }}
                >
                  {p.text}
                </div>
              ))}
            </div>
          </>
        ) : (
          <div style={{ font: '400 13.5px/1.4 var(--font-ui)', color: 'var(--text-muted)' }}>
            No answer was active.
          </div>
        )}
        <div style={{ display: 'flex', gap: 12, marginTop: 'auto' }}>
          <button className="footer-hint" onClick={() => this.setState({ error: null })}>
            Try again
          </button>
          <button className="footer-hint" onClick={() => window.location.reload()}>
            Reload panel
          </button>
        </div>
      </div>
    )
  }
}
