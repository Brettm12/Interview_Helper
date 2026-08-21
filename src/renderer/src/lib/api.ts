import type { AppCommand, HelperApi } from '@shared/ipc'
import { DEFAULT_WHISPER_MODEL } from '@shared/models'
import type { Bank, SessionRecord, Settings } from '@shared/types'
import seed from '@shared/seed.json'

// window.api is injected by the Electron preload. In the browser (dev:web /
// design verification) we shim the same contract on localStorage so every
// screen and the whole mock session are demoable without Electron.

declare global {
  interface Window {
    api?: HelperApi
  }
}

const DEFAULT_SETTINGS: Settings = {
  contentProtection: true,
  keepTranscript: false,
  placement: 'docked',
  stripPosition: null,
  micDeviceId: null,
  meetingDeviceId: null,
  whisperModel: DEFAULT_WHISPER_MODEL
}

function browserShim(): HelperApi {
  // storage: localStorage in the browser, a Map in tests (node env)
  const mem = new Map<string, string>()
  const storage =
    typeof localStorage !== 'undefined'
      ? localStorage
      : {
          getItem: (k: string) => mem.get(k) ?? null,
          setItem: (k: string, v: string) => void mem.set(k, v),
          removeItem: (k: string) => void mem.delete(k)
        }
  const read = <T,>(key: string, fallback: T): T => {
    try {
      const raw = storage.getItem(key)
      return raw ? (JSON.parse(raw) as T) : fallback
    } catch {
      return fallback
    }
  }
  const write = (key: string, value: unknown): void => {
    try {
      storage.setItem(key, JSON.stringify(value))
    } catch (err) {
      // localStorage quota — sessions are the only unbounded key: prune the
      // oldest half and retry once (REVIEW.md L20)
      if (key === 'lih.sessions' && Array.isArray(value) && value.length > 1) {
        const pruned = [...(value as SessionRecord[])]
          .sort((a, b) => a.startedAt - b.startedAt)
          .slice(Math.ceil(value.length / 2))
        try {
          storage.setItem(key, JSON.stringify(pruned))
          return
        } catch {
          // fall through to the store-level save guard
        }
      }
      throw err
    }
  }

  const commandSubs = new Set<(cmd: AppCommand) => void>()
  // mirrors main's bank:did-change relay so the reload path is unit-testable;
  // in the single browser window the saver simply re-loads its own save
  const bankSubs = new Set<() => void>()
  const settingsSubs = new Set<(s: Settings) => void>()
  if (typeof window !== 'undefined')
    window.addEventListener('keydown', (e) => {
    const mod = e.metaKey || e.ctrlKey
    if (!mod) return
    const k = e.key.toLowerCase()
    if (k === 'k' && !e.shiftKey) {
      e.preventDefault()
      commandSubs.forEach((cb) => cb('find'))
    } else if (k === 'h' && e.shiftKey) {
      e.preventDefault()
      commandSubs.forEach((cb) => cb('toggle-collapse'))
    } else if (k === 'r' && e.shiftKey) {
      e.preventDefault()
      commandSubs.forEach((cb) => cb('recap'))
    } else if (k === 'd' && e.shiftKey) {
      e.preventDefault()
      commandSubs.forEach((cb) => cb('diagnostics'))
    }
    })

  return {
    bank: {
      load: async () => {
        const raw = storage.getItem('lih.bank')
        if (raw == null) return { bank: seed as unknown as Bank, source: 'new' as const }
        try {
          return { bank: JSON.parse(raw) as Bank, source: 'file' as const }
        } catch {
          // mirror main's quarantine: stash the unreadable payload under a
          // timestamped key rather than silently overwriting it (REVIEW.md H8)
          const quarantinedPath = `lih.bank.corrupt-${Date.now()}`
          try {
            storage.setItem(quarantinedPath, raw)
            storage.removeItem('lih.bank')
          } catch {
            // stashing failed — leave the original in place
          }
          return { bank: seed as unknown as Bank, source: 'seed' as const, quarantinedPath }
        }
      },
      save: async (bank) => {
        write('lih.bank', bank)
        bankSubs.forEach((cb) => cb())
      },
      onChanged: (cb) => {
        bankSubs.add(cb)
        return () => bankSubs.delete(cb)
      }
    },
    sessions: {
      save: async (s) => {
        const all = read<SessionRecord[]>('lih.sessions', [])
        const i = all.findIndex((x) => x.id === s.id)
        if (i >= 0) all[i] = s
        else all.push(s)
        write('lih.sessions', all)
      },
      list: async () => read<SessionRecord[]>('lih.sessions', []),
      delete: async (id) => {
        write(
          'lih.sessions',
          read<SessionRecord[]>('lih.sessions', []).filter((s) => s.id !== id)
        )
      }
    },
    settings: {
      load: async () => ({ ...DEFAULT_SETTINGS, ...read<Partial<Settings>>('lih.settings', {}) }),
      update: async (patch) => {
        const merged = {
          ...DEFAULT_SETTINGS,
          ...read<Partial<Settings>>('lih.settings', {}),
          ...patch
        }
        write('lih.settings', merged)
        settingsSubs.forEach((cb) => cb(merged))
        return merged
      },
      onDidChange: (cb) => {
        settingsSubs.add(cb)
        return () => settingsSubs.delete(cb)
      }
    },
    permissions: {
      status: async () => ({ microphone: 'granted', screen: 'granted' }),
      requestMicrophone: async () => 'granted',
      openScreenRecordingSettings: async () => {}
    },
    windows: {
      setView: async () => {},
      showStrip: async () => {},
      openSecondScreenBank: async () => ({ ok: false, error: 'Only one display connected — second screen needs two.' }),
      setContentProtection: async () => {},
      displays: async () => ({ count: 1 }),
      findClosed: async () => {}
    },
    session: {
      setActive: async () => ({ failedShortcuts: [] })
    },
    exportFile: {
      saveNotes: async (name, contents) => {
        if (typeof document === 'undefined') return name
        const blob = new Blob([contents], {
          type: name.endsWith('.json') ? 'application/json' : 'text/markdown'
        })
        const a = document.createElement('a')
        a.href = URL.createObjectURL(blob)
        a.download = name
        a.click()
        URL.revokeObjectURL(a.href)
        return name
      }
    },
    strip: {
      // web renders the strip inline from local stores — nothing to bridge
      publish: () => {},
      getState: async () => null,
      onState: () => () => {},
      expand: async () => {
        commandSubs.forEach((cb) => cb('strip-expand'))
      }
    },
    models: {
      // mock mode never loads models
      status: async () => ({ dir: '', whisper: false, embeddings: false, whisperModel: '' }),
      download: async () => ({ ok: false, error: 'Models are only used by the desktop app.' }),
      cancelDownload: async () => {},
      onProgress: () => () => {}
    },
    onCommand: (cb) => {
      commandSubs.add(cb)
      return () => commandSubs.delete(cb)
    },
    env: { mock: true, platform: 'browser' }
  }
}

export const api: HelperApi =
  (typeof window !== 'undefined' ? window.api : undefined) ?? browserShim()
