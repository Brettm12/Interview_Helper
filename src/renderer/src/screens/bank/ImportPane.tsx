import type { ImportPaneProps } from '../contracts'
import { Label } from '../../components/primitives'
import './import.css'

// Import / export, in the bank's pane 3. No mock exists for this surface — it
// borrows the stories pane's header and the editor's field styles so it reads
// as part of the same app.
//
// The preview is the point. Merging pasted text blind into someone's prepared
// material the night before an interview is destructive in a way that is hard
// to undo, so nothing is added until they have seen the count and the first
// few questions the parser found.

const PLACEHOLDER = `Paste your prep notes, or a bank you exported earlier.

Tell me about a time you disagreed with your manager.
- Frame it as a data disagreement, not a personality one
- I brought a two-week test instead of an argument
> triggers: disagreed with your manager, pushed back
> story: Checkout redesign`

export default function ImportPane(props: ImportPaneProps): JSX.Element {
  const {
    text,
    onTextChange,
    preview,
    skipDuplicates,
    onSkipDuplicates,
    onImport,
    onExport,
    result,
    onClose
  } = props

  const canImport = preview != null && preview.importable > 0

  return (
    <div className="importer">
      <div className="importer__header">
        <Label crumb>IMPORT · EXPORT</Label>
        <span className="action importer__close" onClick={onClose}>
          Close
        </span>
      </div>

      <div className="importer__body">
        <div className="importer__group">
          <Label>PASTE NOTES</Label>
          <textarea
            className="importer__input"
            value={text}
            placeholder={PLACEHOLDER}
            spellCheck={false}
            onChange={(e) => onTextChange(e.target.value)}
          />
          <div className="importer__hint pretty">
            A question per line (or as a heading) with its points as bullets underneath. Everything
            stays on this machine.
          </div>
        </div>

        {preview != null && (
          <div className="importer__group">
            <Label>WHAT I FOUND</Label>
            {preview.problem != null ? (
              <div className="importer__problem pretty">{preview.problem}</div>
            ) : (
              <>
                <div className="importer__summary">{preview.summary}</div>
                {preview.warnings.map((w) => (
                  <div key={w} className="importer__warning pretty">
                    {w}
                  </div>
                ))}
                <div className="importer__sample">
                  {preview.sample.map((s, i) => (
                    <div key={i} className="importer__row">
                      <span className="importer__row-q">{s.question}</span>
                      <span className="importer__row-meta">
                        {s.duplicate ? 'already in your bank' : `${s.points} points`}
                      </span>
                    </div>
                  ))}
                </div>
                <div
                  className="importer__check"
                  role="checkbox"
                  aria-checked={skipDuplicates}
                  onClick={() => onSkipDuplicates(!skipDuplicates)}
                >
                  <span className={skipDuplicates ? 'importer__box importer__box--on' : 'importer__box'}>
                    {skipDuplicates ? '✓' : ''}
                  </span>
                  Skip questions I already have
                </div>
                <div
                  className={canImport ? 'cta importer__cta' : 'cta importer__cta importer__cta--off'}
                  onClick={canImport ? onImport : undefined}
                >
                  {canImport ? `Add ${preview.importable} to the bank` : 'Nothing to add'}
                </div>
              </>
            )}
          </div>
        )}

        <div className="importer__group">
          <Label>BACK UP THIS BANK</Label>
          <div className="importer__hint pretty">
            Your prepared material lives in one file. A copy somewhere else is the only thing that
            survives losing it.
          </div>
          <div className="importer__exports">
            <span className="action importer__action" onClick={() => onExport('md')}>
              Export as notes (.md)
            </span>
            <span className="action importer__action" onClick={() => onExport('json')}>
              Export a full backup (.json)
            </span>
          </div>
        </div>

        {result != null && <div className="importer__result pretty">{result}</div>}
      </div>
    </div>
  )
}
