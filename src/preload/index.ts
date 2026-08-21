import { contextBridge, ipcRenderer } from 'electron'
import type { AppCommand, HelperApi, ModelProgress, StripState } from '../shared/ipc'
import type { Settings } from '../shared/types'

const api: HelperApi = {
  bank: {
    load: () => ipcRenderer.invoke('bank:load'),
    save: (bank) => ipcRenderer.invoke('bank:save', bank),
    onChanged: (cb) => {
      const listener = (): void => cb()
      ipcRenderer.on('bank:did-change', listener)
      return () => ipcRenderer.removeListener('bank:did-change', listener)
    }
  },
  sessions: {
    save: (s) => ipcRenderer.invoke('sessions:save', s),
    list: () => ipcRenderer.invoke('sessions:list'),
    delete: (id) => ipcRenderer.invoke('sessions:delete', id)
  },
  settings: {
    load: () => ipcRenderer.invoke('settings:load'),
    update: (patch) => ipcRenderer.invoke('settings:update', patch),
    onDidChange: (cb) => {
      const listener = (_e: unknown, s: Settings): void => cb(s)
      ipcRenderer.on('settings:did-change', listener)
      return () => ipcRenderer.removeListener('settings:did-change', listener)
    }
  },
  permissions: {
    status: () => ipcRenderer.invoke('permissions:status'),
    requestMicrophone: () => ipcRenderer.invoke('permissions:request-mic'),
    openScreenRecordingSettings: () => ipcRenderer.invoke('permissions:open-screen-settings')
  },
  windows: {
    setView: (view, opts) => ipcRenderer.invoke('windows:set-view', view, opts),
    showStrip: (show) => ipcRenderer.invoke('windows:show-strip', show),
    openSecondScreenBank: () => ipcRenderer.invoke('windows:open-second-screen-bank'),
    setContentProtection: (on) => ipcRenderer.invoke('windows:set-content-protection', on),
    displays: () => ipcRenderer.invoke('windows:displays'),
    findClosed: () => ipcRenderer.invoke('windows:find-closed')
  },
  session: {
    setActive: (active) => ipcRenderer.invoke('session:set-active', active)
  },
  exportFile: {
    saveNotes: (name, contents) => ipcRenderer.invoke('export:save-notes', name, contents)
  },
  strip: {
    publish: (s) => ipcRenderer.send('strip:publish', s),
    getState: () => ipcRenderer.invoke('strip:get'),
    onState: (cb) => {
      const listener = (_e: unknown, s: StripState): void => cb(s)
      ipcRenderer.on('strip:state', listener)
      return () => ipcRenderer.removeListener('strip:state', listener)
    },
    expand: () => ipcRenderer.invoke('strip:expand')
  },
  models: {
    status: (whisperModel) => ipcRenderer.invoke('models:status', whisperModel),
    download: (whisperModel) => ipcRenderer.invoke('models:download', whisperModel),
    cancelDownload: () => ipcRenderer.invoke('models:cancel-download'),
    onProgress: (cb) => {
      const listener = (_e: unknown, p: ModelProgress): void => cb(p)
      ipcRenderer.on('models:progress', listener)
      return () => ipcRenderer.removeListener('models:progress', listener)
    }
  },
  onCommand: (cb) => {
    const listener = (_e: unknown, cmd: AppCommand): void => cb(cmd)
    ipcRenderer.on('command', listener)
    return () => ipcRenderer.removeListener('command', listener)
  },
  env: {
    // `electron-vite dev --mode mock` reaches the vite-bundled preload as MODE
    mock:
      (import.meta as unknown as { env?: { MODE?: string } }).env?.MODE === 'mock' ||
      process.env.MOCK_SESSION === '1' ||
      process.argv.includes('--mock'),
    platform: process.platform
  }
}

contextBridge.exposeInMainWorld('api', api)
