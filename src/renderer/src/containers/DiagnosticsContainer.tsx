import { useEffect, useState } from 'react'
import DiagnosticsPanel from '../screens/diagnostics/DiagnosticsPanel'
import { useAudioStore } from '../state/audioStore'
import { usePanelStore } from '../state/panelStore'
import { useSessionStore } from '../state/sessionStore'
import { useSettingsStore } from '../state/settingsStore'
import { whisperTier } from '@shared/models'
import { diagnose, formatFloorDb, formatLevelDb } from '../lib/diagnose'
import { api } from '../lib/api'

export default function DiagnosticsContainer(): JSX.Element | null {
  const open = usePanelStore((s) => s.diagnosticsOpen)
  const meeting = useAudioStore((s) => s.meeting)
  const mic = useAudioStore((s) => s.mic)
  const permissions = useAudioStore((s) => s.permissions)
  const meetingLabel = useAudioStore((s) => s.meetingLabel)
  const micLabel = useAudioStore((s) => s.micLabel)
  const transcript = useSessionStore((s) => s.transcript)
  const whisperModel = useSettingsStore((s) => s.whisperModel)
  const [models, setModels] = useState<{ dir: string; whisper: boolean; embeddings: boolean } | null>(
    null
  )

  useEffect(() => {
    if (!open) return
    // the status has to be about the model actually selected — "some Whisper
    // is installed" is the answer that hid this class of failure before
    void api.models.status(whisperModel).then(setModels)
  }, [open, whisperModel])

  if (!open) return null

  const micPermission = permissions.microphone === 'granted'
  const screenPermission = permissions.screen === 'granted'
  const missingModels = {
    speech: models != null && !models.whisper,
    matching: models != null && !models.embeddings
  }

  return (
    <DiagnosticsPanel
      sources={[
        {
          name: 'Meeting audio',
          state: meeting.state,
          device: meeting.deviceLabel ?? meetingLabel,
          levelDb: formatLevelDb(meeting),
          floorDb: formatFloorDb(meeting),
          segments: meeting.segments,
          error: meeting.error
        },
        {
          name: 'Your mic',
          state: mic.state,
          device: mic.deviceLabel ?? micLabel,
          levelDb: formatLevelDb(mic),
          floorDb: formatFloorDb(mic),
          segments: mic.segments,
          error: mic.error
        }
      ]}
      models={{
        whisper: `${whisperTier(whisperModel).label} · ${
          models == null ? 'checking…' : models.whisper ? 'installed' : 'not installed'
        }`,
        whisperMissing: models != null && !models.whisper,
        embeddings: models == null ? 'checking…' : models.embeddings ? 'installed' : 'not installed',
        embeddingsMissing: models != null && !models.embeddings,
        dir: models?.dir ?? ''
      }}
      transcript={transcript
        .filter((t) => t.confirmed)
        .slice(-6)
        .map((t) => `${t.speaker}: ${t.text}`)}
      verdict={diagnose({ meeting, mic, micPermission, screenPermission, missingModels })}
      onClose={() => usePanelStore.getState().toggleDiagnostics()}
    />
  )
}
