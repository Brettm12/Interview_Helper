import { useEffect, useMemo, useState } from 'react'
import SetupScreen from '../screens/setup/SetupScreen'
import { useAudioStore } from '../state/audioStore'
import { useBankStore, answersForLoop } from '../state/bankStore'
import { usePanelStore } from '../state/panelStore'
import { useSettingsStore } from '../state/settingsStore'
import { api } from '../lib/api'
import { prepareAudio, startSession } from './runtime'

// Pre-interview setup. The status dots are a live signal and have to be
// honest: green only when a source is genuinely hearing something, amber when
// it is silent, and a distinct failure when there is no audio track at all.
// The levels arriving here are already smoothed and hysteretic (see
// createLevelMeter in runtime.ts) — this component must not re-derive
// liveness from an instantaneous value.

/** the design's five bar heights, scaled by the live level */
const BAR_PATTERN = [6, 13, 9, 14, 5]

export default function SetupContainer(): JSX.Element | null {
  const bank = useBankStore((s) => s.bank)
  // selectors, not the whole store: an unselected subscription re-rendered
  // this screen on every level tick of either stream
  const meeting = useAudioStore((s) => s.meeting)
  const mic = useAudioStore((s) => s.mic)
  const permissions = useAudioStore((s) => s.permissions)
  const meetingLabel = useAudioStore((s) => s.meetingLabel)
  const micLabel = useAudioStore((s) => s.micLabel)
  const settings = useSettingsStore()
  const [placementError, setPlacementError] = useState<string | null>(null)
  const [modelsNotice, setModelsNotice] = useState<string | null>(null)
  const [downloading, setDownloading] = useState(false)

  useEffect(() => {
    prepareAudio()
    void useAudioStore.getState().refreshPermissions()
    const id = window.setInterval(() => void useAudioStore.getState().refreshPermissions(), 3000)
    // the mock session never touches the models — no notice to show there
    let offProgress: (() => void) | null = null
    if (!api.env.mock) {
      void api.models.status().then((m) => {
        setModelsNotice(
          m.whisper && m.embeddings
            ? null
            : 'On-device models not installed — matching runs on the lexical fallback until they are.'
        )
      })
      offProgress = api.models.onProgress((p) =>
        setModelsNotice(`Downloading models — ${p.done}/${p.total} · ${p.file}`)
      )
    }
    return () => {
      window.clearInterval(id)
      offProgress?.()
    }
  }, [])

  const downloadModels = (): void => {
    setDownloading(true)
    void api.models.download().then((r) => {
      setDownloading(false)
      setModelsNotice(
        r.ok
          ? 'On-device models installed — semantic matching is on.'
          : `Model download failed: ${r.error ?? 'unknown error'}`
      )
    })
  }

  const meterFor = (level: number): number[] => {
    const scale = Math.min(1, level / 0.45)
    return BAR_PATTERN.map((h) => Math.max(2, h * (0.35 + 0.65 * scale)))
  }
  const meetingLevels = useMemo(() => meterFor(meeting.level), [meeting.level])
  const micLevels = useMemo(() => meterFor(mic.level), [mic.level])

  if (!bank) return null
  const loop = bank.loops.find((l) => l.id === bank.activeLoopId) ?? bank.loops[0]
  const answers = answersForLoop(bank, bank.activeLoopId)
  const noStoryIds = answers.filter((a) => a.storyId == null).map((a) => a.id)
  const storiesAttached = new Set(answers.map((a) => a.storyId).filter(Boolean)).size

  const screenOk = permissions.screen === 'granted'
  const micOk = permissions.microphone === 'granted'
  const meetingLive = meeting.state === 'live'
  const micLive = mic.state === 'live'

  // why-lines say which of the three failures this is, so a dead source can
  // never be mistaken for a working one
  const whyFor = (
    s: typeof meeting,
    permissionOk: boolean,
    permissionFix: string,
    working: string,
    waiting: string
  ): string => {
    if (!permissionOk) return permissionFix
    if (s.state === 'no-track') return s.error ?? 'no audio track — this source is not connected'
    if (s.state === 'live') return working
    return waiting
  }

  // A source that has ever been live is good enough to start: gating the CTA
  // on the *current* level meant a click landing in a speech pause hit an
  // undefined handler and was silently dropped.
  const startable =
    screenOk && micOk && meeting.state !== 'no-track' && mic.state !== 'no-track'

  const panel = usePanelStore.getState()

  return (
    <SetupScreen
      eyebrow={loop.startsIn ?? 'READY WHEN YOU ARE'}
      title={loop.name}
      sub={loop.detail}
      stats={{ answers: answers.length, stories: storiesAttached, noStory: noStoryIds.length }}
      meeting={{
        ok: meetingLive,
        failed: meeting.state === 'no-track',
        title: meeting.deviceLabel ?? meetingLabel,
        why: whyFor(
          meeting,
          screenOk,
          'grant Screen Recording in System Settings → Privacy & Security',
          'so it hears their questions',
          'connected, but nothing audible yet'
        ),
        levels: meetingLevels
      }}
      mic={{
        ok: micLive,
        failed: mic.state === 'no-track',
        title: mic.deviceLabel ?? micLabel,
        why: whyFor(
          mic,
          micOk,
          'grant Microphone access in System Settings → Privacy & Security',
          'so it can tick off points as you say them',
          'connected, but nothing audible yet'
        ),
        hasSignal: micLive,
        levels: micLevels
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
      modelsNotice={modelsNotice}
      onDownloadModels={
        !api.env.mock && !downloading && modelsNotice?.startsWith('On-device models not installed')
          ? downloadModels
          : null
      }
      canStart={startable}
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
