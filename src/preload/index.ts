import { contextBridge, ipcRenderer } from 'electron'
import type { HelperApi } from '../shared/ipc'

const api: HelperApi = {
  bank: {
    load: () => ipcRenderer.invoke('bank:load'),
    save: (bank) => ipcRenderer.invoke('bank:save', bank)
  },
  sessions: {
    save: (s) => ipcRenderer.invoke('sessions:save', s),
    list: () => ipcRenderer.invoke('sessions:list'),
    delete: (id) => ipcRenderer.invoke('sessions:delete', id)
  },
  settings: {
    load: () => ipcRenderer.invoke('settings:load'),
    save: (s) => ipcRenderer.invoke('settings:save', s)
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
    displays: () => ipcRenderer.invoke('windows:displays')
  },
  exportFile: {
    saveNotes: (name, contents) => ipcRenderer.invoke('export:save-notes', name, contents)
  },
  onCommand: (cb) => {
    const listener = (_e: unknown, cmd: 'find' | 'toggle-collapse' | 'recap' | 'strip-expand') => cb(cmd)
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
