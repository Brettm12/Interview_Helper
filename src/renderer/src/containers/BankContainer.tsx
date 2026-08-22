import { useMemo, useState } from 'react'
import type { Answer } from '@shared/types'
import BankScreen from '../screens/bank/BankScreen'
import EditorPane from '../screens/bank/EditorPane'
import StoriesPane from '../screens/bank/StoriesPane'
import ImportPane from '../screens/bank/ImportPane'
import type { BankDetailProps, BankGroupView, ImportPreviewView } from '../screens/contracts'
import { useBankStore, answersForLoop, storyById, storyUsage } from '../state/bankStore'
import { usePersistHealth } from '../state/persistHealth'
import { entriesToAnswers, parseBankText, serializeBank } from '../lib/bankIO'
import { normalize } from '../lib/text'
import { api } from '../lib/api'
import { startSession } from './runtime'

// Question bank + entry editor, bound to the bank store. Selecting a loop
// filters the list; "Edit" swaps pane 3 to the editor; stories are shared
// entities so "used in N answers" is a live count.

let pointSeq = 0

function EditorContainer(): JSX.Element | null {
  const draft = useBankStore((s) => s.draft)
  const bank = useBankStore((s) => s.bank)
  if (!draft || !bank) return null
  const store = useBankStore.getState()
  const story = storyById(bank, draft.storyId)

  // Esc must not throw away work silently. A new answer counts as dirty the
  // moment it has anything in it; an edit, when it differs from what is
  // stored (REVIEW.md P6).
  const stored = draft.answerId ? bank.answers.find((a) => a.id === draft.answerId) : null
  const points = draft.points.filter((p) => p.text.trim() !== '')
  const dirty = stored
    ? stored.question !== draft.question.trim() ||
      stored.sectionId !== draft.sectionId ||
      stored.storyId !== draft.storyId ||
      stored.triggerPhrases.join('\u0000') !== draft.triggerPhrases.join('\u0000') ||
      stored.points.map((p) => p.text).join('\u0000') !== points.map((p) => p.text).join('\u0000')
    : draft.question.trim() !== '' || points.length > 0 || draft.triggerPhrases.length > 0

  const swapStory = (): void => {
    // no picker modal in the design: Swap cycles through the shared library
    const ids = bank.stories.map((s) => s.id)
    if (ids.length === 0) return
    const at = draft.storyId ? ids.indexOf(draft.storyId) : -1
    store.updateDraft({ storyId: ids[(at + 1) % ids.length] })
  }

  return (
    <EditorPane
      question={draft.question}
      points={draft.points}
      story={
        story
          ? {
              title: story.title,
              sub: `from stories library · ${story.metrics.length} metrics attached`
            }
          : null
      }
      triggers={draft.triggerPhrases}
      onQuestionChange={(q) => store.updateDraft({ question: q })}
      onPointChange={(id, text) =>
        store.updateDraft({
          points: draft.points.map((p) => (p.id === id ? { ...p, text } : p))
        })
      }
      onPointAdd={(text) =>
        store.updateDraft({
          points: [...draft.points, { id: `p-draft-${pointSeq++}`, text }]
        })
      }
      onPointRemove={(id) =>
        store.updateDraft({ points: draft.points.filter((p) => p.id !== id) })
      }
      onPointsReorder={(from, to) => {
        const points = [...draft.points]
        const [moved] = points.splice(from, 1)
        points.splice(to, 0, moved)
        store.updateDraft({ points })
      }}
      onTriggerAdd={(t) => {
        const phrase = t.trim()
        if (phrase && !draft.triggerPhrases.includes(phrase)) {
          store.updateDraft({ triggerPhrases: [...draft.triggerPhrases, phrase] })
        }
      }}
      onTriggerRemove={(t) =>
        store.updateDraft({ triggerPhrases: draft.triggerPhrases.filter((x) => x !== t) })
      }
      onSwapStory={swapStory}
      dirty={dirty}
      onCancel={() => store.cancelEdit()}
      onSave={() => void store.saveEdit()}
    />
  )
}

function StoriesContainer(): JSX.Element | null {
  const bank = useBankStore((s) => s.bank)
  const storyDraft = useBankStore((s) => s.storyDraft)
  if (!bank) return null
  const store = useBankStore.getState()

  return (
    <StoriesPane
      rows={bank.stories.map((s) => {
        const used = storyUsage(bank, s.id)
        return {
          id: s.id,
          title: s.title,
          sub: `${s.metrics.length} metric${s.metrics.length === 1 ? '' : 's'} · used in ${used} answer${used === 1 ? '' : 's'}`
        }
      })}
      draft={storyDraft}
      onSelect={(id) => store.selectStory(id)}
      onNew={() => store.newStory()}
      onTitleChange={(title) => store.updateStoryDraft({ title })}
      onBodyChange={(body) => store.updateStoryDraft({ body })}
      onMetricAdd={(m) => {
        const d = useBankStore.getState().storyDraft
        if (d && !d.metrics.includes(m)) store.updateStoryDraft({ metrics: [...d.metrics, m] })
      }}
      onMetricRemove={(m) => {
        const d = useBankStore.getState().storyDraft
        if (d) store.updateStoryDraft({ metrics: d.metrics.filter((x) => x !== m) })
      }}
      onSave={() => void store.saveStoryDraft()}
      onClose={() => store.closeStories()}
    />
  )
}

/**
 * Import / export, bound to the bank store.
 *
 * The preview is recomputed on every keystroke and nothing is written until
 * the user commits: pasting into someone's prepared material the night before
 * an interview has to be reversible in their head before it happens.
 */
function ImportContainer(): JSX.Element {
  const bank = useBankStore((s) => s.bank)
  const store = useBankStore.getState()
  const [text, setText] = useState('')
  const [skipDuplicates, setSkipDuplicates] = useState(true)
  const [result, setResult] = useState<string | null>(null)

  const parsed = useMemo(
    () => (text.trim() ? parseBankText(text, bank?.answers ?? []) : null),
    [text, bank]
  )

  const importable = parsed
    ? parsed.entries.filter((e) => !(skipDuplicates && e.duplicateOf)).length
    : 0

  const preview: ImportPreviewView | null = parsed && {
    summary: `${parsed.entries.length} question${parsed.entries.length === 1 ? '' : 's'} · ${parsed.entries.reduce((n, e) => n + e.points.length, 0)} points`,
    warnings: [
      parsed.pointless > 0
        ? `${parsed.pointless} have no points — they will show as a card with nothing to strike through.`
        : '',
      parsed.duplicates > 0
        ? `${parsed.duplicates} look like questions you already have.`
        : ''
    ].filter(Boolean),
    sample: parsed.entries.slice(0, 6).map((e) => ({
      question: e.question,
      points: e.points.length,
      duplicate: e.duplicateOf != null
    })),
    problem: parsed.problem,
    importable
  }

  const doImport = (): void => {
    if (!bank || !parsed) return
    const chosen = parsed.entries.filter((e) => !(skipDuplicates && e.duplicateOf))
    const answers = entriesToAnswers(chosen, {
      loopId: bank.activeLoopId,
      // imports land in the first section; moving them is one edit, and
      // guessing a section from prose would be guessing
      sectionId: bank.sections[0]?.id ?? 'sec-imported',
      stories: bank.stories
    })
    void store.addAnswers(answers).then((n) => {
      setResult(`Added ${n} answer${n === 1 ? '' : 's'} to ${bank.loops.find((l) => l.id === bank.activeLoopId)?.shortName ?? 'this loop'}.`)
      setText('')
    })
  }

  const doExport = (format: 'md' | 'json'): void => {
    if (!bank) return
    const name = `interview-bank.${format}`
    void api.exportFile
      .saveNotes(name, serializeBank(bank, format))
      .then((path) => setResult(path ? `Saved to ${path}` : null))
  }

  // a complete backup can be restored exactly instead of flattened (M9)
  const doRestore = (): void => {
    if (!parsed?.fullBank) return
    void store.replaceBank(parsed.fullBank).then(() => {
      setResult('Bank restored from the backup.')
      setText('')
    })
  }

  return (
    <ImportPane
      text={text}
      onTextChange={(t) => {
        setText(t)
        setResult(null)
      }}
      preview={preview}
      skipDuplicates={skipDuplicates}
      onSkipDuplicates={setSkipDuplicates}
      onImport={doImport}
      onRestore={parsed?.fullBank ? doRestore : null}
      onExport={doExport}
      result={result}
      onClose={() => store.closeImport()}
    />
  )
}

export default function BankContainer(): JSX.Element | null {
  const bank = useBankStore((s) => s.bank)
  const loadSource = useBankStore((s) => s.loadSource)
  const quarantinedPath = useBankStore((s) => s.quarantinedPath)
  const saveProblem = usePersistHealth((s) => s.problem)
  const selectedAnswerId = useBankStore((s) => s.selectedAnswerId)
  const searchQuery = useBankStore((s) => s.searchQuery)
  const draft = useBankStore((s) => s.draft)
  const filterIds = useBankStore((s) => s.filterIds)
  const storiesOpen = useBankStore((s) => s.storiesOpen)
  const importOpen = useBankStore((s) => s.importOpen)

  const groups = useMemo<BankGroupView[]>(() => {
    if (!bank) return []
    let answers = answersForLoop(bank, bank.activeLoopId)
    if (filterIds) answers = answers.filter((a) => filterIds.includes(a.id))
    const q = normalize(searchQuery)
    if (q) {
      answers = answers.filter((a) => {
        const story = storyById(bank, a.storyId)
        return [a.question, ...a.points.map((p) => p.text), story?.title ?? '']
          .some((h) => normalize(h).includes(q))
      })
    }
    return bank.sections
      .map((sec) => ({
        sectionId: sec.id,
        sectionName: sec.name.toUpperCase(),
        rows: answers
          .filter((a) => a.sectionId === sec.id)
          .map((a) => ({
            id: a.id,
            question: a.question,
            pointsLabel: `${a.points.length} points`,
            storyTitle: storyById(bank, a.storyId)?.title ?? null,
            noStory: a.storyId == null
          }))
      }))
      .filter((g) => g.rows.length > 0)
  }, [bank, filterIds, searchQuery])

  if (!bank) return null
  const store = useBankStore.getState()
  const loopAnswers = answersForLoop(bank, bank.activeLoopId)
  const selected: Answer | null =
    loopAnswers.find((a) => a.id === selectedAnswerId) ??
    bank.answers.find((a) => a.id === selectedAnswerId) ??
    null

  let detail: BankDetailProps | null = null
  if (selected) {
    const section = bank.sections.find((s) => s.id === selected.sectionId)
    const story = storyById(bank, selected.storyId)
    detail = {
      crumb: `${(section?.name ?? '').toUpperCase()} · ASKED IN ${selected.loopIds.length} LOOP${selected.loopIds.length === 1 ? '' : 'S'}`,
      question: selected.question,
      points: selected.points,
      story: story
        ? {
            label: story.title,
            body: story.body,
            metrics: story.metrics,
            usedIn: storyUsage(bank, story.id)
          }
        : null,
      triggers: selected.triggerPhrases,
      lastUsed: selected.lastUsed
        ? `Last used · ${selected.lastUsed.loopName}, ${selected.lastUsed.date}`
        : null,
      lastUsedRight: selected.lastUsed
        ? `Covered ${selected.lastUsed.covered}/${selected.lastUsed.total} that time`
        : null,
      onEdit: () => store.startEdit(selected.id),
      // was startSession({ dryRun: true }) — which replayed the scripted HR
      // fixture, i.e. a demo of someone else's interview (REVIEW.md P10)
      onPractice: () => startSession({ practiceEntryId: selected.id }),
      onAddPhrase: (p) => void store.addTrigger(selected.id, p),
      onRemovePhrase: (p) => void store.removeTrigger(selected.id, p)
    }
  }

  const sections = bank.sections
    .map((sec) => ({
      id: sec.id,
      name: sec.name,
      count: loopAnswers.filter((a) => a.sectionId === sec.id).length
    }))
    .filter((s) => s.count > 0)

  // failing saves outrank the load story: "not being saved" is the one to act
  // on right now (REVIEW.md H8/H9)
  const kept = quarantinedPath ? ` The unreadable file was kept at ${quarantinedPath}.` : ''
  const banner =
    saveProblem ??
    (loadSource === 'bak'
      ? `Your bank could not be read — restored from the automatic backup.${kept}`
      : loadSource === 'seed'
        ? `Your bank could not be read — this is the STARTER bank, not your prep.${kept} Restore a JSON export via Import.`
        : null)

  return (
    <BankScreen
      banner={banner}
      loops={bank.loops.map((l) => ({ id: l.id, shortName: l.shortName }))}
      selectedLoopId={bank.activeLoopId}
      sections={sections}
      storiesCount={bank.stories.length}
      answerCount={loopAnswers.length}
      groups={groups}
      selectedAnswerId={selectedAnswerId}
      detail={detail}
      editing={draft != null || storiesOpen || importOpen}
      editorSlot={
        draft != null ? <EditorContainer /> : importOpen ? <ImportContainer /> : <StoriesContainer />
      }
      searchQuery={searchQuery}
      onSearch={(q) => store.setSearch(q)}
      onSelectLoop={(id) => store.selectLoop(id)}
      onSelectAnswer={(id) => store.selectAnswer(id)}
      onNewAnswer={() => store.startNew()}
      onImport={() => store.openImport()}
      onStories={() => store.openStories()}
    />
  )
}
