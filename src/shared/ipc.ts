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

export interface HelperApi {
  bank: {
    load(): Promise<Bank>
    save(bank: Bank): Promise<void>
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
  /** global shortcuts + strip actions forwarded from main */
  onCommand(cb: (cmd: 'find' | 'toggle-collapse' | 'recap' | 'strip-expand') => void): () => void
  readonly env: { mock: boolean; platform: string }
}
