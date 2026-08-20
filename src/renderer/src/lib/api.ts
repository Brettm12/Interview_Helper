import type { HelperApi } from '@shared/ipc'
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
  stripPosition: null
}

function browserShim(): HelperApi {
  // storage: localStorage in the browser, a Map in tests (node env)
  const mem = new Map<string, string>()
  const storage =
    typeof localStorage !== 'undefined'
      ? localStorage
      : {
          getItem: (k: string) => mem.get(k) ?? null,
          setItem: (k: string, v: string) => void mem.set(k, v)
        }
  const read = <T,>(key: string, fallback: T): T => {
    try {
      const raw = storage.getItem(key)
      return raw ? (JSON.parse(raw) as T) : fallback
    } catch {
      return fallback
    }
  }
  const write = (key: string, value: unknown) => storage.setItem(key, JSON.stringify(value))

  const commandSubs = new Set<(cmd: 'find' | 'toggle-collapse' | 'recap' | 'strip-expand') => void>()
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
    }
    })

  return {
    bank: {
      load: async () => read<Bank>('lih.bank', seed as unknown as Bank),
      save: async (bank) => write('lih.bank', bank)
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
      save: async (s) => write('lih.settings', s)
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
      displays: async () => ({ count: 1 })
    },
    exportFile: {
      saveNotes: async (name, contents) => {
        if (typeof document === 'undefined') return name
        const blob = new Blob([contents], { type: 'text/markdown' })
        const a = document.createElement('a')
        a.href = URL.createObjectURL(blob)
        a.download = name
        a.click()
        URL.revokeObjectURL(a.href)
        return name
      }
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
