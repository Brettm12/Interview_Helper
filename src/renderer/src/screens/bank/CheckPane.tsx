import { useState } from 'react'
import type { KeyboardEvent } from 'react'
import type { CheckPaneProps } from '../contracts'
import { Label } from '../../components/primitives'
import './check.css'

// Bank check, in the bank's pane 3. No mock exists for this surface — it
// borrows the importer's groups and the bank's row idiom.
//
// Nothing here shows a number. A similarity score on screen invites tuning a
// bank against a threshold, and the number is meaningless without the
// distribution behind it; what the user needs to know is what the panel would
// DO, said in the same words the panel uses.

export default function CheckPane(props: CheckPaneProps): JSX.Element {
  const { text, onTextChange, result, findings, warming, blocked, entryCount, onClose } = props
  const [draft, setDraft] = useState(text)

  const ask = (): void => onTextChange(draft)
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      ask()
    }
  }

  return (
    <div className="checker">
      <div className="checker__header">
        <Label crumb>BANK CHECK</Label>
        <button type="button" className="action checker__close" onClick={onClose}>
          Close
        </button>
      </div>

      {blocked ? (
        <div className="checker__body">
          <div className="checker__blocked pretty">
            Not while a session is running. This asks the same model the interview is using, and
            the interview gets it.
          </div>
        </div>
      ) : (
        <div className="checker__body">
          <div className="checker__group">
            <Label>WHAT WOULD THIS MATCH?</Label>
            <div className="checker__hint pretty">
              Paste a question you think they will ask. It is scored exactly the way it would be
              live, against the {entryCount} answers in this loop.
            </div>
            <textarea
              className="checker__input pretty"
              value={draft}
              rows={2}
              placeholder="Tell me about a time you had to deliver bad news to a team."
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKeyDown}
            />
            <button type="button" className="cta checker__cta" onClick={ask}>
              What comes up?
            </button>

            {warming && <div className="checker__warming pretty">Warming the matcher…</div>}

            {!warming && result != null && (
              <div className={`checker__verdict checker__verdict--${result.tone}`}>
                <div className="checker__verdict-line pretty">{result.verdict}</div>
                {result.answers.map((a) => (
                  <button
                    type="button"
                    key={a.entryId}
                    className="checker__answer pretty"
                    onClick={a.onOpen}
                  >
                    {a.question}
                  </button>
                ))}
                {result.onAddToBank && (
                  <button type="button" className="chip checker__add" onClick={result.onAddToBank}>
                    Write an answer for it →
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="checker__group">
            <Label>WORTH FIXING BEFORE THE DAY</Label>
            {warming ? (
              <div className="checker__warming pretty">Warming the matcher…</div>
            ) : findings.length === 0 ? (
              <div className="checker__hint pretty">
                Nothing is fighting with anything else. Every answer in this loop wins its own
                question clearly.
              </div>
            ) : (
              <div className="checker__findings">
                {findings.map((f) => (
                  <div key={f.id} className="checker__finding">
                    <div className="checker__finding-q pretty">{f.question}</div>
                    <div className="checker__finding-why pretty">{f.detail}</div>
                    <div className="checker__finding-actions">
                      {f.onMerge && (
                        <button type="button" className="chip" onClick={f.onMerge}>
                          {f.mergeLabel}
                        </button>
                      )}
                      <button type="button" className="action" onClick={f.onOpen}>
                        Open it
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
