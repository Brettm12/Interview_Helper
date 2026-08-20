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
  const bank = useBankStore((s) => s.bank)

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
      } else if (e.key === 'Backspace') {
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
              seedTranscript: q?.transcript?.map((l) => `${l.speaker}: ${l.text}`).join('\n')
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
      eyebrow={data.eyebrow}
      title={loop?.name ?? 'Interview session'}
      sub={data.sub}
      stats={data.stats}
      rows={rows}
      fixes={fixes}
      practiceCount={data.practiceEntryIds.length}
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
