import type { SourceStatus } from '../state/audioStore'
import { TUNING } from '@shared/tuning'
import { dbfs } from './dsp/level'

// Turns capture state into one plain sentence naming the most likely problem.
// Pure so the reasoning is unit-testable — this is the code that has to be
// right when the app "isn't working" and nothing else can tell you why.

export interface DiagnoseInput {
  meeting: SourceStatus
  mic: SourceStatus
  micPermission: boolean
  screenPermission: boolean
  /** which on-device models are absent. Separate flags because they fail
   *  differently: no speech model means the smaller tier transcribes instead,
   *  no matching model means matching drops to the lexical path */
  missingModels: { speech: boolean; matching: boolean }
}

/** ordered most-actionable first: a hard failure beats a soft one, and a
 *  permission problem beats a signal problem because it explains it */
export function diagnose(input: DiagnoseInput): string {
  const { meeting, mic, micPermission, screenPermission, missingModels } = input

  if (!micPermission) {
    return 'Microphone permission is not granted, so nothing you say can be heard. Grant it in System Settings → Privacy & Security → Microphone.'
  }
  if (mic.state === 'no-track') {
    return `Your microphone failed to open${mic.error ? ` — ${mic.error}` : ''}. Pick a different input device and try again.`
  }
  if (meeting.state === 'no-track') {
    return `Meeting audio has no track${meeting.error ? ` — ${meeting.error}` : ''}. On macOS, Electron cannot capture system audio directly: route the meeting through a loopback device (BlackHole) and select it as the meeting input.`
  }
  if (!screenPermission) {
    return 'Screen Recording permission is not granted, so the meeting side cannot be captured. Grant it in System Settings → Privacy & Security → Screen Recording, then relaunch.'
  }

  // audio is arriving — is it usable?
  const micTooQuiet = mic.state === 'live' && dbfs(mic.level) < -45
  if (micTooQuiet) {
    // the headroom over the room is the number that actually predicts whether
    // speech will be detected — an absolute level alone doesn't
    const headroom =
      mic.floorDbfs == null
        ? ''
        : `, only ${Math.max(0, dbfs(mic.level) - mic.floorDbfs).toFixed(0)} dB above the room noise`
    return `Your microphone is very quiet (${dbfs(mic.level).toFixed(0)} dB${headroom}). Move closer, raise the input gain in System Settings → Sound, or pick a better input — quiet audio transcribes poorly.`
  }
  if (mic.state === 'live' && mic.segments === 0) {
    return 'Your microphone is producing audio but nothing has been transcribed yet. If this persists while you speak, transcription is not keeping up or the model failed to load.'
  }
  if (missingModels.speech && missingModels.matching) {
    return 'Neither on-device model is installed. Download them from the setup screen — until then transcription uses whatever smaller model is present and matching runs on the lexical fallback.'
  }
  if (missingModels.speech) {
    return 'The selected speech model is not installed, so transcription has fallen back to the smaller one. Download it from the setup screen for noticeably better accuracy.'
  }
  if (missingModels.matching) {
    return 'The matching model is not installed, so question matching is running on the lexical fallback. Download it from the setup screen.'
  }
  if (mic.state === 'silent' && meeting.state === 'silent') {
    return 'Both sources are connected but silent. That is expected before anyone speaks — say something and this should turn green.'
  }
  if (mic.state === 'silent') {
    return 'Your microphone is connected but silent. Say something; if it stays silent, check that the right input device is selected.'
  }
  if (meeting.state === 'silent') {
    return 'Meeting audio is connected but silent. That is expected until the other side speaks.'
  }
  return 'Both sources are live and transcribing. Everything is working.'
}

/** "−31 dB", or "—" for a source that isn't producing anything */
export function formatLevelDb(status: SourceStatus): string {
  if (status.state === 'idle' || status.state === 'no-track') return '—'
  const db = dbfs(status.level)
  return db <= -119 ? 'silent' : `${db.toFixed(0)} dB`
}

/** "−62 dB · speech opens at −53 dB" — the room, and the bar to clear it */
export function formatFloorDb(status: SourceStatus): string {
  if (status.floorDbfs == null || status.state === 'idle' || status.state === 'no-track') return '—'
  const openAt = Math.max(status.floorDbfs + TUNING.vadOpenDb, TUNING.vadAbsoluteOpenDbfs)
  return `${status.floorDbfs.toFixed(0)} dB · speech opens at ${openAt.toFixed(0)} dB`
}
