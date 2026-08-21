import type { DevicePickerView, SetupScreenProps } from '../contracts'
import { Label, LevelMeter, StatCard, StatusDot } from '../../components/primitives'
import './setup.css'

type Placement = SetupScreenProps['placement']

const PLACEMENTS: {
  id: Placement
  schem: 'docked' | 'strip' | 'second'
  title: string
  caption: string
}[] = [
  { id: 'docked', schem: 'docked', title: 'Docked right', caption: 'Full panel, resizes the call' },
  { id: 'strip', schem: 'strip', title: 'Floating strip', caption: 'One line, safe to share' },
  {
    id: 'second-screen',
    schem: 'second',
    title: 'Second screen',
    caption: 'Full bank, off the shared display'
  }
]

/** 52px placement schematic; the panel-block turns green when selected (via CSS) */
function Schematic({ kind }: { kind: 'docked' | 'strip' | 'second' }): JSX.Element {
  if (kind === 'docked') {
    return (
      <div className="setup-schem setup-schem--docked">
        <div className="setup-schem__stripes" />
        <div className="setup-schem__block" />
      </div>
    )
  }
  if (kind === 'strip') {
    return (
      <div className="setup-schem setup-schem--strip">
        <div className="setup-schem__stripes" />
        <div className="setup-schem__block" />
      </div>
    )
  }
  return (
    <div className="setup-schem setup-schem--second">
      <div className="setup-schem__block" />
      <div className="setup-schem__stripes" />
    </div>
  )
}

/** green when hearing, red when there's no track at all, amber when merely
 *  silent — three states, because they need three different reactions */
function dotColor(row: { ok: boolean; failed: boolean }): string {
  if (row.failed) return 'var(--status-error)'
  return row.ok ? 'var(--status-live)' : 'var(--status-attention)'
}

/** the row title, as a native select when the source has devices to choose
 *  between. Native so it behaves like every other menu on the machine and so
 *  a long device list doesn't have to fit inside a 380px panel. */
function RowTitle({ title, picker }: { title: string; picker?: DevicePickerView }): JSX.Element {
  if (!picker || picker.options.length === 0) {
    return <div className="setup-hear__title">{title}</div>
  }
  return (
    <select
      className="setup-hear__title setup-device"
      value={picker.value}
      onChange={(e) => picker.onChange(e.target.value)}
      aria-label={title}
    >
      {picker.options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

export default function SetupScreen(props: SetupScreenProps): JSX.Element {
  const {
    eyebrow,
    title,
    sub,
    stats,
    meeting,
    mic,
    model,
    keepTranscript,
    onToggleTranscript,
    placement,
    onPlacement,
    placementError,
    alert,
    modelsNotice,
    onDownloadModels,
    onCancelDownload,
    canStart,
    onStart,
    onEditBank,
    onFixNoStory,
    onTestMic,
    testLabel,
    onDryRun
  } = props

  return (
    <div className="setup">
      <div className="setup-header">
        <div>
          <Label style={{ marginBottom: 10 }}>{eyebrow}</Label>
          <div className="setup-header__title">{title}</div>
          <div className="setup-header__sub">{sub}</div>
        </div>
        <div
          className={canStart ? 'cta setup-cta' : 'cta setup-cta setup-cta--disabled'}
          onClick={canStart ? onStart : undefined}
        >
          Start listening
        </div>
      </div>

      <div className="setup-body">
        <div className="setup-group">
          <div className="setup-group__label-row">
            <Label>BANK LOADED</Label>
            <span className="action setup-action" onClick={onEditBank}>
              Edit bank
            </span>
          </div>
          <div className="setup-stats">
            <StatCard number={stats.answers} caption="answers ready" />
            <StatCard number={stats.stories} caption="stories attached" />
            {stats.noStory > 0 ? (
              <StatCard
                number={stats.noStory}
                caption="no story yet — fix now"
                warning
                onClick={onFixNoStory}
              />
            ) : (
              <StatCard number={stats.noStory} caption="all have stories" />
            )}
          </div>
        </div>

        <div className="setup-group">
          <Label>WHAT IT HEARS</Label>
          <div className="setup-hears">
            <div className="setup-hear">
              <StatusDot size={7} color={dotColor(meeting)} />
              <div className="setup-hear__main">
                <RowTitle title={meeting.title} picker={meeting.picker} />
                <div className="setup-hear__why">{meeting.why}</div>
              </div>
              {/* always mounted: unmounting it restarted the CSS animation and
                  turned every state flip into a visible pop */}
              <LevelMeter heights={meeting.levels ?? []} live={meeting.ok} />
            </div>
            <div className="setup-hear">
              <StatusDot size={7} color={dotColor(mic)} />
              <div className="setup-hear__main">
                <RowTitle title={mic.title} picker={mic.picker} />
                <div className="setup-hear__why">{mic.why}</div>
              </div>
              <LevelMeter heights={mic.levels ?? []} live={mic.ok} />
              <span className="action setup-action" onClick={onTestMic}>
                {testLabel ?? 'Test'}
              </span>
            </div>
            {model != null && (
              <div className="setup-hear">
                <div className="setup-hear__main">
                  <select
                    className="setup-hear__title setup-device"
                    value={model.value}
                    onChange={(e) => model.onChange(e.target.value)}
                    aria-label="Speech model"
                  >
                    {model.options.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                  <div className="setup-hear__why">{model.detail}</div>
                </div>
              </div>
            )}
            <div className="setup-hear">
              <div className="setup-hear__main">
                <div className="setup-hear__title">Keep a transcript for the recap</div>
                <div className="setup-hear__why">so you can see what you missed afterwards</div>
              </div>
              <div
                className={keepTranscript ? 'setup-toggle setup-toggle--on' : 'setup-toggle'}
                onClick={onToggleTranscript}
                role="switch"
                aria-checked={keepTranscript}
              >
                <div className="setup-toggle__knob" />
              </div>
            </div>
          </div>
          <div className="setup-privacy pretty">
            Audio stays on this machine. Nothing is recorded unless you turn on the recap.
          </div>
          {alert != null && <div className="setup-alert pretty">{alert}</div>}
          {modelsNotice != null && (
            <div className="setup-privacy pretty">
              {modelsNotice}
              {onDownloadModels != null && (
                <>
                  {' '}
                  <span className="action setup-models-action" onClick={onDownloadModels}>
                    Download now
                  </span>
                </>
              )}
              {onCancelDownload != null && (
                <>
                  {' '}
                  <span className="action setup-models-action" onClick={onCancelDownload}>
                    Cancel
                  </span>
                </>
              )}
            </div>
          )}
        </div>

        <div className="setup-group">
          <Label>WHERE THE PANEL SITS</Label>
          <div className="setup-placements">
            {PLACEMENTS.map((p) => (
              <div
                key={p.id}
                className={
                  placement === p.id
                    ? 'setup-placement setup-placement--selected'
                    : 'setup-placement'
                }
                onClick={() => onPlacement(p.id)}
              >
                <Schematic kind={p.schem} />
                <div className="setup-placement__title">{p.title}</div>
                <div className="setup-placement__caption">{p.caption}</div>
              </div>
            ))}
          </div>
          {placementError != null && (
            <div className="setup-placement-error pretty">{placementError}</div>
          )}
        </div>

        <div className="setup-footer">
          <div className="setup-footer__shortcuts">
            <span className="footer-hint">⌘K find answer</span>
            <span className="footer-hint">⌘⇧H hide panel</span>
            <span className="footer-hint">⌘⇧R recap after</span>
          </div>
          <span className="footer-hint setup-footer__dryrun" onClick={onDryRun}>
            Dry run · 2 min
          </span>
        </div>
      </div>
    </div>
  )
}
