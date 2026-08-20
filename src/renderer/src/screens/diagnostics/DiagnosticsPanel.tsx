import type { DiagnosticsPanelProps, DiagnosticSourceView } from '../contracts'
import { Label, StatusDot } from '../../components/primitives'
import './diagnostics.css'

// ⌘⇧D. The instrument that answers "is it actually hearing anything?".
//
// The mic bug that prompted this was invisible: a quiet input fell under a
// fixed threshold, so the app buffered nothing, transcribed nothing and
// reported nothing — identical to a working app in a silent room. Everything
// here exists to turn "it's not working" into a specific, actionable cause.

function dotColor(s: DiagnosticSourceView): string {
  if (s.state === 'no-track') return 'var(--status-error)'
  return s.state === 'live' ? 'var(--status-live)' : 'var(--status-attention)'
}

function Row({ label, value, warn }: { label: string; value: string; warn?: boolean }): JSX.Element {
  return (
    <div className="diag-row">
      <span className="diag-row__label">{label}</span>
      <span className={warn ? 'diag-row__value diag-row__value--warn' : 'diag-row__value'}>
        {value}
      </span>
    </div>
  )
}

function Source({ source }: { source: DiagnosticSourceView }): JSX.Element {
  return (
    <div className="diag-source">
      <div className="diag-source__head">
        <StatusDot size={7} color={dotColor(source)} />
        <div className="diag-source__name">{source.name}</div>
        <div className="diag-source__state">{source.state}</div>
      </div>
      <Row label="device" value={source.device ?? '—'} />
      <Row label="level" value={source.levelDb} />
      <Row
        label="segments"
        value={String(source.segments)}
        warn={source.state === 'live' && source.segments === 0}
      />
      {source.error != null && <Row label="error" value={source.error} warn />}
    </div>
  )
}

export default function DiagnosticsPanel(props: DiagnosticsPanelProps): JSX.Element {
  const { sources, models, transcript, verdict, onClose } = props

  return (
    <div className="diag">
      <div className="diag__head">
        <Label crumb>DIAGNOSTICS</Label>
        <button className="diag__close" onClick={onClose}>
          ×
        </button>
      </div>

      <div className="diag__body">
        {/* the plain-language answer first; the numbers below are the evidence */}
        <div className="diag__verdict pretty">{verdict}</div>

        <div className="diag__sources">
          {sources.map((s) => (
            <Source key={s.name} source={s} />
          ))}
        </div>

        <div className="diag-group">
          <Label>MODELS</Label>
          <Row label="speech" value={models.whisper} warn={models.whisperMissing} />
          <Row label="matching" value={models.embeddings} warn={models.embeddingsMissing} />
          <Row label="directory" value={models.dir || '—'} />
        </div>

        <div className="diag-group">
          <Label>LAST HEARD</Label>
          {transcript.length === 0 ? (
            <div className="diag__empty pretty">
              Nothing transcribed yet. If a source is live but this stays empty, the audio is
              reaching the app but not making it through transcription.
            </div>
          ) : (
            transcript.map((line, i) => (
              <div key={i} className="diag__line pretty">
                {line}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
