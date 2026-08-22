import { Fragment, useState } from 'react'
import type { KeyboardEvent } from 'react'
import type { BankDetailProps, BankScreenProps } from '../contracts'
import { Label, PhraseChip, PointRow, StoryCard } from '../../components/primitives'
import './bank.css'

/** pane 3 — entry detail (inner component of the bank screen) */
function BankDetail(props: BankDetailProps): JSX.Element {
  const {
    crumb,
    question,
    points,
    story,
    triggers,
    lastUsed,
    lastUsedRight,
    onEdit,
    onPractice,
    onAddPhrase
  } = props

  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')

  const closeInput = (): void => {
    setAdding(false)
    setDraft('')
  }

  const handleAddKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      const phrase = draft.trim()
      if (phrase !== '') onAddPhrase(phrase)
      closeInput()
    } else if (e.key === 'Escape') {
      closeInput()
    }
  }

  return (
    <>
      <div className="bank-detail__header">
        <Label crumb>{crumb}</Label>
        <div className="bank-detail__actions">
          <button type="button" className="action bank-detail__action" onClick={onEdit}>
            Edit
          </button>
          <button type="button" className="action bank-detail__action" onClick={onPractice}>
            Practice
          </button>
        </div>
      </div>
      <div className="bank-detail__body">
        <div className="bank-detail__question pretty">{question}</div>

        <div className="bank-detail__group">
          <Label>KEY POINTS</Label>
          {points.map((p) => (
            <PointRow key={p.id} state="plain" text={p.text} />
          ))}
        </div>

        {story != null && (
          <StoryCard
            label={`STORY · ${story.label}`}
            body={story.body}
            metrics={story.metrics}
            usedIn={story.usedIn}
            variant="detail"
          />
        )}

        <div className="bank-detail__group bank-detail__group--triggers">
          <Label>ALSO TRIGGERS ON</Label>
          {/* display-only chips per the 3a mock — removal lives in the editor */}
          <div className="bank-detail__chips">
            {triggers.map((t) => (
              <PhraseChip key={t}>“{t}”</PhraseChip>
            ))}
            {adding ? (
              <input
                className="bank-detail__add-input"
                type="text"
                value={draft}
                autoFocus
                placeholder="type a phrase…"
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={handleAddKeyDown}
              />
            ) : (
              <PhraseChip dashed onClick={() => setAdding(true)}>
                + add phrase
              </PhraseChip>
            )}
          </div>
        </div>

        <div className="bank-detail__footer">
          <span>{lastUsed ?? ''}</span>
          <span>{lastUsedRight ?? ''}</span>
        </div>
      </div>
    </>
  )
}

const BankScreen = (props: BankScreenProps): JSX.Element => {
  const {
    banner,
    loops,
    selectedLoopId,
    sections,
    storiesCount,
    answerCount,
    groups,
    selectedAnswerId,
    detail,
    editing,
    editorSlot,
    searchQuery,
    onSearch,
    onSelectLoop,
    onSelectAnswer,
    onNewAnswer,
    onImport,
    onStories
  } = props

  return (
    <div className="bank">
      {banner != null && <div className="bank-banner pretty">{banner}</div>}
      {/* ---- pane 1: loops + sections ---- */}
      <div className="bank-side">
        <div className="bank-side__title">Question bank</div>
        <div className="label bank-side__label">LOOPS</div>
        {loops.map((l) => (
          <button
            type="button"
            key={l.id}
            className={l.id === selectedLoopId ? 'bank-loop bank-loop--selected' : 'bank-loop'}
            onClick={() => onSelectLoop(l.id)}
          >
            {l.shortName}
          </button>
        ))}
        <div className="label bank-side__label bank-side__label--sections">SECTIONS</div>
        {sections.map((s) => (
          <div key={s.id} className="bank-section">
            <span>{s.name}</span>
            <span className="bank-section__count">{s.count}</span>
          </div>
        ))}
        <div className="bank-side__footer">
          <button type="button" className="bank-side__link" onClick={onImport}>
            Import from a job post
          </button>
          <button type="button" className="bank-side__link" onClick={onStories}>
            Stories library · {storiesCount}
          </button>
        </div>
      </div>

      {/* ---- pane 2: answer list ---- */}
      <div className="bank-list">
        <div className="bank-list__header">
          <input
            className="bank-list__search"
            type="text"
            value={searchQuery}
            placeholder={`Search ${answerCount} answers`}
            onChange={(e) => onSearch(e.target.value)}
          />
          <button type="button" className="chip bank-list__new" onClick={onNewAnswer}>
            New answer
          </button>
        </div>
        <div className="bank-list__scroll">
          {groups.map((g, gi) => (
            <Fragment key={g.sectionId}>
              <div
                className={
                  gi === 0
                    ? 'label bank-list__section bank-list__section--first'
                    : 'label bank-list__section'
                }
              >
                {g.sectionName}
              </div>
              {g.rows.map((r) => {
                const selected = r.id === selectedAnswerId
                return (
                  <button
                    type="button"
                    key={r.id}
                    className={selected ? 'bank-row bank-row--selected' : 'bank-row'}
                    onClick={() => onSelectAnswer(r.id)}
                  >
                    <div
                      className={
                        selected
                          ? 'bank-row__title bank-row__title--selected pretty'
                          : 'bank-row__title pretty'
                      }
                    >
                      {r.question}
                    </div>
                    {r.noStory ? (
                      <div className="bank-row__meta bank-row__meta--warn">
                        <span>no story yet</span>
                      </div>
                    ) : r.storyTitle != null ? (
                      <div className="bank-row__meta">
                        <span>{r.pointsLabel}</span>
                        <span>·</span>
                        <span>{r.storyTitle}</span>
                      </div>
                    ) : (
                      <div className="bank-row__meta">
                        <span>{r.pointsLabel}</span>
                      </div>
                    )}
                  </button>
                )
              })}
            </Fragment>
          ))}
        </div>
      </div>

      {/* ---- pane 3: entry detail / editor slot ---- */}
      <div className="bank-detail">
        {editing ? editorSlot : detail != null ? <BankDetail {...detail} /> : null}
      </div>
    </div>
  )
}

export default BankScreen
