import { useEffect, useMemo, useState } from 'react'
import type { Answer } from '@shared/types'
import BankScreen from '../screens/bank/BankScreen'
import EditorPane from '../screens/bank/EditorPane'
import StoriesPane from '../screens/bank/StoriesPane'
import ImportPane from '../screens/bank/ImportPane'
import CheckPane from '../screens/bank/CheckPane'
import type {
  BankDetailProps,
  BankGroupView,
  CheckFindingView,
  CheckPaneProps,
  ImportPreviewView
} from '../screens/contracts'
import {
  useBankStore,
  answersForLoop,
  starterAnswerIds,
  storyById,
  storyUsage
} from '../state/bankStore'
import { usePersistHealth } from '../state/persistHealth'
import { entriesToAnswers, parseBankText, serializeBank } from '../lib/bankIO'
import { checkQuestion, findCollisions, type Collision } from '../lib/bankCheck'
import { condense } from '../lib/condense'
import { HybridMatcher } from '../lib/matcher'
import { useSessionStore } from '../state/sessionStore'
import { normalize } from '../lib/text'
import { api } from '../lib/api'
import { embeddingsWarm, ensureEmbeddings, startSession } from './runtime'

// Question bank + entry editor, bound to the bank store. Selecting a loop
// filters the list; "Edit" swaps pane 3 to the editor; stories are shared
// entities so "used in N answers" is a live count.

let pointSeq = 0

function EditorContainer(): JSX.Element | null {
  const draft = useBankStore((s) => s.draft)
  const bank = useBankStore((s) => s.bank)
  const [condensing, setCondensing] = useState(false)
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
      excerpt={draft.seedTranscript?.split('\n').filter((l) => l.trim() !== '') ?? null}
      seedTriggerPhrase={draft.seedTriggerPhrase}
      onUseExcerptLine={(text) =>
        store.updateDraft({
          points: [...draft.points, { id: `p-draft-${pointSeq++}`, text }]
        })
      }
      condensing={condensing}
      // The prep-time "help me write this". Extractive on purpose: every
      // candidate generative model small enough to install invented details
      // about the user's own experience (tools/spike/llm-spike.mjs), and a
      // fabricated fact in prep material gets said out loud in the room.
      onCondenseExcerpt={
        draft.seedTranscript
          ? () => {
              setCondensing(true)
              void condense(draft.seedTranscript!, ensureEmbeddings())
                .then((lines) => {
                  const current = useBankStore.getState().draft
                  if (!current) return
                  store.updateDraft({
                    points: [
                      ...current.points,
                      ...lines.map((text) => ({ id: `p-draft-${pointSeq++}`, text }))
                    ]
                  })
                })
                .finally(() => setCondensing(false))
            }
          : null
      }
      // nothing to delete while the answer is still a draft
      onDelete={draft.answerId ? () => void store.deleteAnswer(draft.answerId!) : null}
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
      onDelete={
        storyDraft?.storyId ? () => void store.deleteStory(storyDraft.storyId!) : null
      }
      draftUsedIn={storyDraft?.storyId ? storyUsage(bank, storyDraft.storyId) : 0}
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
      starters={{
        count: bank ? starterAnswerIds(bank).length : 0,
        onRemove: () => {
          void store.removeStarterAnswers().then((n) => {
            setResult(n > 0 ? `Removed ${n} starter ${n === 1 ? 'answer' : 'answers'}.` : null)
          })
        }
      }}
      onClose={() => store.closeImport()}
    />
  )
}

/**
 * Bank check — the prep-time rehearsal of the live decision.
 *
 * Everything here runs the REAL matcher over the REAL encoder, because a
 * check that scores differently from the interview would be worse than no
 * check: it would send someone into the room confident about a bank that
 * behaves differently. So it warms the encoder on entry rather than answering
 * from bigram overlap and calling it a match, and it steps aside entirely
 * while a session is running — the interview gets the model.
 */
function CheckContainer(): JSX.Element | null {
  const bank = useBankStore((s) => s.bank)
  const blocked = useSessionStore((s) => s.status !== 'idle')
  const [text, setText] = useState('')
  const [result, setResult] = useState<ReturnType<typeof checkQuestion>>(null)
  const [findings, setFindings] = useState<Collision[]>([])
  const [warm, setWarm] = useState(() => embeddingsWarm())

  const entries = useMemo(
    () => (bank ? answersForLoop(bank, bank.activeLoopId) : []),
    [bank]
  )

  // warm on entry: embeddings only, never a speech model
  useEffect(() => {
    if (blocked || entries.length === 0) return
    const cache = ensureEmbeddings()
    if (!cache) {
      setWarm(true) // no worker in this build — the lexical path is all there is
      return
    }
    let live = true
    void cache.ensure([
      ...entries.map((e) => e.question),
      ...entries.flatMap((e) => e.triggerPhrases)
    ])
    const id = window.setInterval(() => {
      if (!live) return
      if (embeddingsWarm()) {
        setWarm(true)
        window.clearInterval(id)
      }
    }, 300)
    if (embeddingsWarm()) setWarm(true)
    return () => {
      live = false
      window.clearInterval(id)
    }
  }, [blocked, entries])

  // the collision report re-runs whenever the bank changes under it — a merge
  // or an edit made from these findings has to move the findings
  useEffect(() => {
    if (blocked || !warm || entries.length === 0) {
      setFindings([])
      return
    }
    setFindings(findCollisions(entries, new HybridMatcher(ensureEmbeddings())))
  }, [blocked, warm, entries])

  if (!bank) return null
  const store = useBankStore.getState()

  const openEntry = (entryId: string): void => {
    store.selectAnswer(entryId)
    store.startEdit(entryId)
  }

  const ask = (q: string): void => {
    setText(q)
    if (q.trim() === '') {
      setResult(null)
      return
    }
    const cache = ensureEmbeddings()
    const run = (): void => setResult(checkQuestion(q, entries, new HybridMatcher(cache)))
    if (cache) void cache.ensure([q]).then(run)
    else run()
  }

  const verdict: CheckPaneProps['result'] =
    result == null
      ? null
      : {
          verdict:
            result.state === 'confident'
              ? 'This goes straight up, on its own.'
              : result.state === 'ambiguous'
                ? 'You would get the pick-one card, and have to choose:'
                : 'Nothing would come up. Whatever is on screen stays there.',
          tone: result.state === 'confident' ? 'good' : result.state === 'ambiguous' ? 'unsure' : 'none',
          answers: result.rows.map((r) => ({
            entryId: r.entryId,
            question: r.question,
            onOpen: () => openEntry(r.entryId)
          })),
          onAddToBank:
            result.state === 'none'
              ? () => store.startNew({ question: text })
              : null
        }

  const findingViews: CheckFindingView[] = findings.map((f) => {
    const mine = entries.find((e) => e.id === f.entryId)
    return {
      id: `${f.entryId}-${f.withId}-${f.kind}`,
      question: mine?.question ?? f.entryId,
      detail: f.detail,
      // A shared phrase is fixed by taking it off one of them, which is an
      // edit — merging two answers because they share a phrase would be the
      // wrong repair. Nothing here ever writes a trigger phrase: both of the
      // trigger defects in the review were phrases written on the user's
      // behalf (REVIEW.md C7/H13).
      onMerge: f.kind === 'shared-phrase' ? null : () => void store.mergeAnswers(f.entryId, f.withId),
      mergeLabel: 'Merge them into one',
      onOpen: () => openEntry(f.entryId)
    }
  })

  return (
    <CheckPane
      text={text}
      onTextChange={ask}
      result={verdict}
      findings={findingViews}
      warming={!warm && !blocked}
      blocked={blocked}
      entryCount={entries.length}
      onClose={() => store.closeCheck()}
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
  const checkOpen = useBankStore((s) => s.checkOpen)

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
      editing={draft != null || storiesOpen || importOpen || checkOpen}
      editorSlot={
        draft != null ? (
          <EditorContainer />
        ) : importOpen ? (
          <ImportContainer />
        ) : checkOpen ? (
          <CheckContainer />
        ) : (
          <StoriesContainer />
        )
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
