import { useEffect, useMemo } from 'react'
import RecapScreen from '../screens/recap/RecapScreen'
import type { RecapFixView, RecapRowView } from '../screens/contracts'
import { deriveRecap, exportNotes } from '../lib/recap'
import { useBankStore } from '../state/bankStore'
import { usePanelStore } from '../state/panelStore'
import { useSessionStore } from '../state/sessionStore'
import { api } from '../lib/api'

// Post-interview recap, derived from the finished SessionRecord (lib/recap is
// the pure derivation; this container adds navigation + persistence actions).

export default function RecapContainer(): JSX.Element | null {
  const record = useSessionStore((s) => s.lastSession)
  const saveError = useSessionStore((s) => s.saveError)
  const practice = useSessionStore((s) => s.practiceEntryId != null)
  // a dry run is ephemeral too: its record was never written, so offering
  // "Save to loop" would put the scripted fixture into real history
  const ephemeral = useSessionStore((s) => s.ephemeral)
  const bank = useBankStore((s) => s.bank)

  // a recovered (crashed-session) record has been surfaced now — clear the
  // flag on disk so it stops shadowing newer recaps at every boot forever
  // (REVIEW.md L9). The in-memory copy keeps it, so THIS view still says
  // RECOVERED.
  useEffect(() => {
    if (record?.incomplete && !ephemeral) {
      const { incomplete: _surfaced, ...cleared } = record
      void api.sessions.save(cleared).catch(() => {})
    }
  }, [record, ephemeral])

  const data = useMemo(
    () => (record && bank ? deriveRecap(record, bank) : null),
    [record, bank]
  )

  const doExport = (): void => {
    if (!record || !bank) return
    const loop = bank.loops.find((l) => l.id === record.loopId)
    void api.exportFile.saveNotes(
      `${loop?.shortName ?? 'interview'} — session notes.md`,
      exportNotes(record, bank)
    )
  }

  const doDelete = (): void => {
    if (!record) return
    void api.sessions.delete(record.id)
    useSessionStore.getState().setLastSession(null)
    useSessionStore.getState().reset()
    usePanelStore.getState().setView('setup')
  }

  // the footer advertises ⌘E export / ⌘⌫ delete — local to this view
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.metaKey || e.ctrlKey)) return
      if (e.key.toLowerCase() === 'e') {
        e.preventDefault()
        doExport()
      } else if (e.key === 'Backspace' && !ephemeral) {
        // nothing was written for a rehearsal, so there is nothing to delete
        // — and the write itself would touch sessions.json (REVIEW.md P10)
        e.preventDefault()
        doDelete()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (!record || !bank || !data) return null
  const loop = bank.loops.find((l) => l.id === record.loopId)
  const bankStore = useBankStore.getState()
  const panel = usePanelStore.getState()

  const openBankAt = (entryId: string | null, edit = false): void => {
    if (entryId) {
      bankStore.selectAnswer(entryId)
      if (edit) bankStore.startEdit(entryId)
    }
    panel.setView('bank')
  }

  const rows: RecapRowView[] = data.rows.map((r) => {
    const q = record.questions.find((x) => x.id === r.id)
    return {
      id: r.id,
      time: r.time,
      question: r.question,
      matched: r.matched,
      subLine: r.subLine,
      transcriptOff: r.transcriptOff,
      coveredPct: r.coveredPct,
      counter: r.counter,
      transcript: r.transcript,
      onAddToBank: r.matched
        ? null
        : () => {
            bankStore.startNew({
              question: r.question,
              // your own lines only — the same shape the "draft it" fix uses.
              // The interviewer's words are not yours to keep, quote, or feed
              // to anything downstream
              seedTranscript: q?.transcript
                ?.filter((l) => l.speaker === 'you')
                .map((l) => l.text)
                .join('\n')
            })
            panel.setView('bank')
          }
    }
  })

  const fixes: RecapFixView[] = data.fixes.map((f) => ({
    id: f.id,
    title: f.title,
    why: f.why,
    chip: f.chip,
    onAction: () => {
      if (f.kind === 'draft') {
        bankStore.startNew({ question: f.question, seedTranscript: f.excerpt })
        panel.setView('bank')
      } else if (f.kind === 'near-miss' && f.entryId) {
        // opens the editor on the answer that nearly came up, with the wording
        // that missed it sitting in the trigger box — uncommitted. Nothing
        // writes a phrase on the user's behalf (REVIEW.md C7/H13).
        bankStore.selectAnswer(f.entryId)
        bankStore.startEdit(f.entryId, { seedTriggerPhrase: f.question })
        panel.setView('bank')
      } else if (f.kind === 'long') {
        openBankAt(f.entryId, true)
      } else {
        // 'uncovered' opens the answer; 'override' lands on the detail where
        // the add-phrase chip lives
        openBankAt(f.entryId)
      }
    }
  }))

  return (
    <RecapScreen
      eyebrow={
        practice
          ? `PRACTICE · ${data.eyebrow}`
          : ephemeral
            ? `DRY RUN · ${data.eyebrow}`
            : record.incomplete
              ? `RECOVERED · ${data.eyebrow}`
              : data.eyebrow
      }
      title={loop?.name ?? 'Interview session'}
      sub={data.sub}
      stats={data.stats}
      rows={rows}
      fixes={fixes}
      practiceCount={ephemeral ? 0 : data.practiceEntryIds.length}
      notice={saveError}
      ephemeral={ephemeral}
      onDone={() => {
        useSessionStore.getState().reset()
        usePanelStore.getState().setView('bank')
      }}
      onDeleteSession={doDelete}
      onSaveToLoop={() => {
        // the record was already persisted when the session ended — Save
        // confirms and returns to setup with it kept
        void api.sessions.save(record)
        panel.setView('setup')
      }}
      onExport={doExport}
      onPractice={() => {
        bankStore.setFilter(data.practiceEntryIds)
        if (data.practiceEntryIds[0]) bankStore.selectAnswer(data.practiceEntryIds[0])
        panel.setView('bank')
      }}
    />
  )
}
