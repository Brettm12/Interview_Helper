import { useEffect, useMemo, useState } from 'react'
import SetupScreen from '../screens/setup/SetupScreen'
import { useAudioStore } from '../state/audioStore'
import { useBankStore, answersForLoop } from '../state/bankStore'
import { usePanelStore } from '../state/panelStore'
import { useSettingsStore } from '../state/settingsStore'
import { api } from '../lib/api'
import { prepareAudio, startSession } from './runtime'

// Pre-interview setup. The status dots are a live signal: green only when the
// permission is granted AND the source reports a level; missing permission
// turns the dot amber and the why-line becomes the fix instruction.

const LEVEL_FLOOR = 0.02
/** the design's five bar heights, scaled by the live level */
const BAR_PATTERN = [6, 13, 9, 14, 5]

export default function SetupContainer(): JSX.Element | null {
  const bank = useBankStore((s) => s.bank)
  const audio = useAudioStore()
  const settings = useSettingsStore()
  const [placementError, setPlacementError] = useState<string | null>(null)

  useEffect(() => {
    prepareAudio()
    void useAudioStore.getState().refreshPermissions()
    const id = window.setInterval(() => void useAudioStore.getState().refreshPermissions(), 3000)
    return () => window.clearInterval(id)
  }, [])

  const levels = useMemo(() => {
    const scale = Math.min(1, audio.meetingLevel / 0.45)
    return BAR_PATTERN.map((h) => Math.max(2, Math.round(h * (0.35 + 0.65 * scale))))
  }, [audio.meetingLevel])

  if (!bank) return null
  const loop = bank.loops.find((l) => l.id === bank.activeLoopId) ?? bank.loops[0]
  const answers = answersForLoop(bank, bank.activeLoopId)
  const noStoryIds = answers.filter((a) => a.storyId == null).map((a) => a.id)
  const storiesAttached = new Set(answers.map((a) => a.storyId).filter(Boolean)).size

  const screenOk = audio.permissions.screen === 'granted'
  const micOk = audio.permissions.microphone === 'granted'
  const meetingLive = screenOk && audio.meetingLevel > LEVEL_FLOOR
  const micLive = micOk && audio.micLevel > LEVEL_FLOOR

  const panel = usePanelStore.getState()

  return (
    <SetupScreen
      eyebrow={loop.startsIn ?? 'READY WHEN YOU ARE'}
      title={loop.name}
      sub={loop.detail}
      stats={{ answers: answers.length, stories: storiesAttached, noStory: noStoryIds.length }}
      meeting={{
        ok: meetingLive,
        title: audio.meetingLabel,
        why: screenOk
          ? meetingLive
            ? 'so it hears their questions'
            : 'waiting for sound from the meeting'
          : 'grant Screen Recording in System Settings → Privacy & Security',
        levels: meetingLive ? levels : null
      }}
      mic={{
        ok: micLive,
        title: audio.micLabel,
        why: micOk
          ? 'so it can tick off points as you say them'
          : 'grant Microphone access in System Settings → Privacy & Security',
        hasSignal: micLive
      }}
      keepTranscript={settings.keepTranscript}
      onToggleTranscript={() => void settings.update({ keepTranscript: !settings.keepTranscript })}
      placement={settings.placement}
      onPlacement={(p) => {
        setPlacementError(null)
        if (p === 'second-screen') {
          void api.windows.openSecondScreenBank().then((r) => {
            if (r.ok) void settings.update({ placement: p })
            else setPlacementError(r.error ?? 'Second screen is not available.')
          })
          return
        }
        void settings.update({ placement: p })
      }}
      placementError={placementError}
      canStart={meetingLive && micLive}
      onStart={() => startSession()}
      onEditBank={() => panel.setView('bank')}
      onFixNoStory={() => {
        useBankStore.getState().setFilter(noStoryIds)
        if (noStoryIds[0]) useBankStore.getState().selectAnswer(noStoryIds[0])
        panel.setView('bank')
      }}
      onTestMic={() => {
        if (!micOk) void api.permissions.requestMicrophone()
      }}
      onDryRun={() => startSession({ dryRun: true })}
    />
  )
}
