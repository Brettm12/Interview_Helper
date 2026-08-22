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
  /** the session is paused and the microphone is closed. A live-green dot
   *  over a dead mic is the one dishonest signal left in the app
   *  (REVIEW.md P2) */
  paused: boolean
}

/** What loadBank actually did — the renderer must be able to tell "your own
 *  bank" apart from a fallback. A corrupt bank.json silently replaced by the
 *  demo seed, then overwritten by the first save, destroyed real prep
 *  (REVIEW.md H8). */
export interface BankLoadResult {
  bank: Bank
  /** file = your bank; bak = restored from the automatic backup;
   *  seed = starter bank after a failed read; new = first run, nothing to read */
  source: 'file' | 'bak' | 'seed' | 'new'
  /** where the unreadable original was moved, when there was one */
  quarantinedPath?: string
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

/** one tick of a model download — enough to render "file 3/11 · 42 MB of
 *  110 MB" instead of a counter that sits frozen through a 100MB file */
export interface ModelProgress {
  /** 1-based index of the file being fetched */
  done: number
  total: number
  /** "Xenova/whisper-tiny.en/config.json" */
  file: string
  /** bytes landed for the CURRENT file (includes any resumed prefix) */
  loadedBytes: number
  /** from the manifest or Content-Length; 0 when unknown */
  totalBytes: number
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
    load(): Promise<BankLoadResult>
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
    /** patch semantics through main's read-merge-write: two writers (renderer
     *  saves vs main's strip-drag persistence) used to race full-object saves
     *  and silently revert each other (REVIEW.md L10). Resolves to the merged
     *  result. */
    update(patch: Partial<Settings>): Promise<Settings>
    /** settings changed (any writer) — stores refresh from this push */
    onDidChange(cb: (s: Settings) => void): () => void
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
    /** the ⌘K overlay closed — main blurs the panel so keys drift back toward
     *  the meeting app (focus was stolen deliberately so typing works) */
    findClosed(): Promise<void>
  }
  session: {
    /** the renderer's session armed/ended. Main scopes the global session
     *  shortcuts to this span and reports any accelerator another app holds —
     *  a silently dead ⌘K is the panic path failing. */
    setActive(active: boolean): Promise<{ failedShortcuts: string[] }>
  }
  exportFile: {
    /** save a text file next to the user's documents; returns the path.
     *  The extension on `defaultName` picks the dialog's filter — session
     *  notes and bank exports both come through here. */
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
    /** stop an in-flight download; verified files and resumable partials stay */
    cancelDownload(): Promise<void>
    /** progress while a download runs: "3/11 · Xenova/whisper-tiny.en/…" */
    onProgress(cb: (p: ModelProgress) => void): () => void
  }
  /** global shortcuts + strip actions forwarded from main */
  onCommand(cb: (cmd: AppCommand) => void): () => void
  readonly env: { mock: boolean; platform: string }
}
