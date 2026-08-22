import { useEffect, useMemo, useState } from 'react'
import type { Settings } from '@shared/types'
import SetupScreen from '../screens/setup/SetupScreen'
import { useAudioStore } from '../state/audioStore'
import { useBankStore, answersForLoop } from '../state/bankStore'
import { usePersistHealth } from '../state/persistHealth'
import { usePanelStore } from '../state/panelStore'
import { useSettingsStore } from '../state/settingsStore'
import { WHISPER_TIERS, whisperTier } from '@shared/models'
import { api } from '../lib/api'
import { onDeviceChange, suggestLoopback } from '../lib/devices'
import { prepareAudio, restartAudio, runMicTest, startSession } from './runtime'

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
  const devices = useAudioStore((s) => s.inputDevices)
  const micTest = useAudioStore((s) => s.micTest)
  const pipelineNotice = useAudioStore((s) => s.pipelineNotice)
  const saveProblem = usePersistHealth((s) => s.problem)
  const loadSource = useBankStore((s) => s.loadSource)
  const settings = useSettingsStore()
  const [placementError, setPlacementError] = useState<string | null>(null)
  const [modelsNotice, setModelsNotice] = useState<string | null>(null)
  // a separate flag, not a string test: the notice wording varies by which
  // model is missing, and gating the download action on its prefix meant the
  // offer quietly vanished for two of the three cases
  const [modelsIncomplete, setModelsIncomplete] = useState(false)
  const [downloading, setDownloading] = useState(false)

  // the two models fail differently, so one shared notice would send you
  // looking in the wrong place: a missing speech model means a smaller one
  // transcribes, a missing matching model means matching goes lexical
  const refreshModels = (whisperModel: string): void => {
    if (api.env.mock) return
    void api.models.status(whisperModel).then((m) => {
      const tier = whisperTier(whisperModel).label
      setModelsIncomplete(!(m.whisper && m.embeddings))
      setModelsNotice(
        m.whisper && m.embeddings
          ? null
          : !m.whisper && !m.embeddings
            ? 'On-device models not installed — matching runs on the lexical fallback until they are.'
            : !m.whisper
              ? `The ${tier} speech model is not downloaded — transcription will use the smaller one until it is.`
              : 'The matching model is not installed — matching runs on the lexical fallback until it is.'
      )
    })
  }

  useEffect(() => {
    prepareAudio()
    const audio = useAudioStore.getState()
    void audio.refreshPermissions()
    void audio.refreshDevices()
    const id = window.setInterval(() => void useAudioStore.getState().refreshPermissions(), 3000)
    // plugging in a headset mid-setup should populate the pickers, not require
    // a restart. Device *labels* also only appear once permission is granted,
    // so the first enumeration is often nameless.
    const offDevices = onDeviceChange(() => void useAudioStore.getState().refreshDevices())
    // the mock session never touches the models — no notice to show there
    let offProgress: (() => void) | null = null
    if (!api.env.mock) {
      refreshModels(useSettingsStore.getState().whisperModel)
      // byte-level progress: "file 3/11" alone froze for minutes on the 100MB
      // weight files, which reads as a hang (REVIEW.md M17)
      const mb = (n: number): string => `${Math.max(1, Math.round(n / 1048576))} MB`
      offProgress = api.models.onProgress((p) =>
        setModelsNotice(
          `Downloading models — file ${p.done}/${p.total} · ${p.file}` +
            (p.totalBytes > 0 ? ` · ${mb(p.loadedBytes)} of ${mb(p.totalBytes)}` : '')
        )
      )
    }
    return () => {
      window.clearInterval(id)
      offDevices()
      offProgress?.()
    }
  }, [])

  // labels arrive with microphone permission, so re-enumerate when it lands
  useEffect(() => {
    if (permissions.microphone === 'granted') void useAudioStore.getState().refreshDevices()
  }, [permissions.microphone])

  const downloadModels = (): void => {
    setDownloading(true)
    void api.models.download(settings.whisperModel).then((r) => {
      setDownloading(false)
      if (r.ok) setModelsIncomplete(false)
      setModelsNotice(
        r.ok
          ? 'On-device models installed — semantic matching is on.'
          : r.error === 'download cancelled'
            ? 'Download cancelled — finished files are kept, and it resumes where it stopped.'
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

  // options keep the row's name in front of the device name, so the picker
  // reads exactly like the title it replaced — "Your mic · MacBook Pro"
  const deviceOptions = (prefix: string): { value: string; label: string }[] =>
    devices.map((d) => ({ value: d.deviceId, label: `${prefix} · ${d.label}` }))

  // macOS can't capture system audio directly, so the meeting side depends on
  // a virtual cable. If one is installed, name it rather than making them
  // work out which of eight inputs is the right one.
  const loopback = suggestLoopback(devices)
  const meetingHint =
    meeting.state === 'no-track' && loopback
      ? ` “${loopback.label}” looks like the one.`
      : ''
  // constraints are fixed at getUserMedia time, so a new device means
  // re-acquiring the stream rather than reconfiguring the one we have
  const pickDevice = (patch: Partial<Settings>): void => {
    void settings.update(patch).then(restartAudio)
  }

  // the mic row's why-line is where the test result belongs: it's the line
  // that already answers "is this working", and putting it there means the
  // answer and the evidence sit together
  const micWhy =
    micTest.state === 'recording'
      ? 'listening… say a full sentence'
      : micTest.state === 'thinking'
        ? 'transcribing what you just said…'
        : micTest.state === 'done'
          ? `heard: “${micTest.text}”`
          : micTest.state === 'failed'
            ? (micTest.error ?? 'the test failed')
            : whyFor(
                mic,
                micOk,
                'grant Microphone access in System Settings → Privacy & Security',
                'so it can tick off points as you say them',
                'connected, but nothing audible yet'
              )

  const testLabel =
    micTest.state === 'recording'
      ? 'Listening…'
      : micTest.state === 'thinking'
        ? 'Thinking…'
        : micTest.state === 'idle'
          ? 'Test'
          : 'Test again'

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
        why:
          whyFor(
            meeting,
            screenOk,
            'grant Screen Recording in System Settings → Privacy & Security',
            'so it hears their questions',
            'connected, but nothing audible yet'
          ) + meetingHint,
        levels: meetingLevels,
        picker: api.env.mock
          ? undefined
          : {
              // '' is screen-capture loopback, which Electron only supports on
              // Windows; everywhere else the meeting has to arrive as an input
              options: [
                { value: '', label: 'Meeting audio · system capture' },
                ...deviceOptions('Meeting audio')
              ],
              value: settings.meetingDeviceId ?? '',
              onChange: (v) => pickDevice({ meetingDeviceId: v || null })
            }
      }}
      mic={{
        ok: micLive,
        failed: mic.state === 'no-track',
        title: mic.deviceLabel ?? micLabel,
        why: micWhy,
        hasSignal: micLive,
        levels: micLevels,
        picker: api.env.mock
          ? undefined
          : {
              options: [
                { value: '', label: 'Your mic · system default' },
                ...deviceOptions('Your mic')
              ],
              value: settings.micDeviceId ?? '',
              onChange: (v) => pickDevice({ micDeviceId: v || null })
            }
      }}
      model={
        api.env.mock
          ? undefined
          : {
              options: WHISPER_TIERS.map((t) => ({ value: t.id, label: `Speech model · ${t.label}` })),
              value: settings.whisperModel,
              onChange: (v) => {
                void settings.update({ whisperModel: v }).then(() => refreshModels(v))
              },
              detail: whisperTier(settings.whisperModel).detail
            }
      }
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
      autoPick={{
        options: [
          { value: '4', label: 'Unsure: picks for me after 4s' },
          { value: '8', label: 'Unsure: picks for me after 8s' },
          { value: 'never', label: 'Unsure: waits for me' }
        ],
        value: settings.autoPickSec == null ? 'never' : String(settings.autoPickSec),
        onChange: (v) => void settings.update({ autoPickSec: v === 'never' ? null : Number(v) }),
        detail:
          settings.autoPickSec == null
            ? 'the card stays up until you choose — nothing commits on its own'
            : 'it commits the leader when the countdown runs out'
      }}
      highLegibility={settings.highLegibility}
      onToggleLegibility={() => void settings.update({ highLegibility: !settings.highLegibility })}
      placementError={placementError}
      alert={
        saveProblem ??
        (loadSource === 'bak' || loadSource === 'seed'
          ? 'Your bank could not be read — check the Bank screen before starting.'
          : null)
      }
      modelsNotice={pipelineNotice ?? modelsNotice}
      onDownloadModels={
        !api.env.mock && !downloading && modelsIncomplete ? downloadModels : null
      }
      onCancelDownload={downloading ? () => void api.models.cancelDownload() : null}
      canStart={startable}
      onStart={() => startSession()}
      onEditBank={() => panel.setView('bank')}
      onFixNoStory={() => {
        useBankStore.getState().setFilter(noStoryIds)
        if (noStoryIds[0]) useBankStore.getState().selectAnswer(noStoryIds[0])
        panel.setView('bank')
      }}
      onTestMic={() => void runMicTest()}
      testLabel={testLabel}
      onDryRun={() => startSession({ dryRun: true })}
    />
  )
}
