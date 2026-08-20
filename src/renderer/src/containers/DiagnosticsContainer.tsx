import { useEffect, useState } from 'react'
import DiagnosticsPanel from '../screens/diagnostics/DiagnosticsPanel'
import { useAudioStore } from '../state/audioStore'
import { usePanelStore } from '../state/panelStore'
import { useSessionStore } from '../state/sessionStore'
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
  const [models, setModels] = useState<{ dir: string; whisper: boolean; embeddings: boolean } | null>(
    null
  )

  useEffect(() => {
    if (!open) return
    void api.models.status().then(setModels)
  }, [open])

  if (!open) return null

  const micPermission = permissions.microphone === 'granted'
  const screenPermission = permissions.screen === 'granted'
  const modelsMissing = models != null && !(models.whisper && models.embeddings)

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
        whisper: models == null ? 'checking…' : models.whisper ? 'installed' : 'not installed',
        whisperMissing: models != null && !models.whisper,
        embeddings: models == null ? 'checking…' : models.embeddings ? 'installed' : 'not installed',
        embeddingsMissing: models != null && !models.embeddings,
        dir: models?.dir ?? ''
      }}
      transcript={transcript
        .filter((t) => t.confirmed)
        .slice(-6)
        .map((t) => `${t.speaker}: ${t.text}`)}
      verdict={diagnose({ meeting, mic, micPermission, screenPermission, modelsMissing })}
      onClose={() => usePanelStore.getState().toggleDiagnostics()}
    />
  )
}
