import type { Bank, SessionRecord, Settings } from './types'

// The preload-exposed API surface. The browser shim (dev:web) implements the
// same contract on localStorage so every screen is demoable without Electron.

export type PermissionState = 'granted' | 'denied' | 'not-determined' | 'restricted' | 'unknown'

export interface PermissionsInfo {
  microphone: PermissionState
  screen: PermissionState
}

export type ViewName = 'setup' | 'armed' | 'live' | 'bank' | 'recap'

export interface DisplayInfo {
  count: number
}

/** snapshot of the strip's render state, computed by the session-owning
 *  renderer and relayed by main to the strip window */
export interface StripState {
  variant: 'current' | 'queued' | 'new-question'
  text: string
  /** "3/4" */
  counter: string | null
  protectionOn: boolean
}

export interface ModelsStatus {
  /** userData/models — shown in the setup notice */
  dir: string
  /** the *selected* Whisper build is present. Switching tiers can turn this
   *  false again, which is the point: it has to be about the model actually
   *  in use, not "some Whisper is installed" */
  whisper: boolean
  /** Xenova/all-MiniLM-L6-v2 present */
  embeddings: boolean
  /** which Whisper build the answer is about */
  whisperModel: string
}

/** localModelPath prefix served by main's privileged custom protocol */
export const MODELS_URL_PREFIX = 'lih-models://models'

/** commands main pushes to every renderer — global shortcuts, the app menu
 *  and the tray all funnel through here */
export type AppCommand =
  | 'find'
  | 'toggle-collapse'
  | 'recap'
  | 'strip-expand'
  | 'pause'
  | 'diagnostics'

export interface HelperApi {
  bank: {
    load(): Promise<Bank>
    save(bank: Bank): Promise<void>
    /** another window saved the bank — reload to stay fresh */
    onChanged(cb: () => void): () => void
  }
  sessions: {
    save(s: SessionRecord): Promise<void>
    list(): Promise<SessionRecord[]>
    delete(id: string): Promise<void>
  }
  settings: {
    load(): Promise<Settings>
    save(s: Settings): Promise<void>
  }
  permissions: {
    status(): Promise<PermissionsInfo>
    requestMicrophone(): Promise<PermissionState>
    openScreenRecordingSettings(): Promise<void>
  }
  windows: {
    /** morph the main window frame for a view (size/position/level) */
    setView(view: ViewName, opts?: { placement?: Settings['placement'] }): Promise<void>
    showStrip(show: boolean): Promise<void>
    openSecondScreenBank(): Promise<{ ok: boolean; error?: string }>
    setContentProtection(on: boolean): Promise<void>
    displays(): Promise<DisplayInfo>
  }
  exportFile: {
    /** write markdown next to the user's documents; returns the path */
    saveNotes(defaultName: string, contents: string): Promise<string | null>
  }
  /** strip window bridge: the session-owning renderer publishes snapshots,
   *  main relays them to the strip window */
  strip: {
    publish(s: StripState): void
    /** primes a fresh strip window with the last published state */
    getState(): Promise<StripState | null>
    onState(cb: (s: StripState) => void): () => void
    /** ask the session-owning window to expand back to the panel */
    expand(): Promise<void>
  }
  models: {
    status(whisperModel?: string): Promise<ModelsStatus>
    /** fetch the on-device models — the only network call the app makes */
    download(whisperModel?: string): Promise<{ ok: boolean; error?: string }>
    /** progress while a download runs: "3/11 · Xenova/whisper-tiny.en/…" */
    onProgress(cb: (p: { done: number; total: number; file: string }) => void): () => void
  }
  /** global shortcuts + strip actions forwarded from main */
  onCommand(cb: (cmd: AppCommand) => void): () => void
  readonly env: { mock: boolean; platform: string }
}
