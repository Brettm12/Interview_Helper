import { app, dialog, globalShortcut, ipcMain } from 'electron'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { repository } from './persistence'
import { permissionStatus, requestMicrophone, openScreenRecordingSettings } from './permissions'
import {
  broadcast,
  createMainWindow,
  displayCount,
  getMainWindow,
  openSecondScreenBank,
  setContentProtection,
  setView,
  showStrip,
  stripBounds
} from './windows'
import type { Settings } from '../shared/types'
import type { ViewName } from '../shared/ipc'

// no dock bounce / focus steal when helper windows appear
if (process.platform === 'darwin') {
  app.dock?.hide()
  app.dock?.show() // keep the app in the dock, but windows use showInactive()
}

function registerIpc(): void {
  ipcMain.handle('bank:load', () => repository.loadBank())
  ipcMain.handle('bank:save', (_e, bank) => repository.saveBank(bank))

  ipcMain.handle('sessions:save', (_e, s) => repository.saveSession(s))
  ipcMain.handle('sessions:list', () => repository.listSessions())
  ipcMain.handle('sessions:delete', (_e, id) => repository.deleteSession(id))

  ipcMain.handle('settings:load', () => repository.loadSettings())
  ipcMain.handle('settings:save', (_e, s) => repository.saveSettings(s))

  ipcMain.handle('permissions:status', () => permissionStatus())
  ipcMain.handle('permissions:request-mic', () => requestMicrophone())
  ipcMain.handle('permissions:open-screen-settings', () => openScreenRecordingSettings())

  ipcMain.handle('windows:set-view', async (_e, view: ViewName, opts?: { placement?: Settings['placement'] }) => {
    setView(view, opts?.placement)
    if (view === 'live' && opts?.placement === 'strip') {
      const settings = await repository.loadSettings()
      await showStrip(true, settings.stripPosition)
    }
  })
  ipcMain.handle('windows:show-strip', async (_e, show: boolean) => {
    const settings = await repository.loadSettings()
    await showStrip(show, settings.stripPosition)
    if (!show) {
      const pos = stripBounds()
      if (pos) await repository.saveSettings({ ...settings, stripPosition: pos })
    }
  })
  ipcMain.handle('windows:open-second-screen-bank', () => openSecondScreenBank())
  ipcMain.handle('windows:set-content-protection', (_e, on: boolean) => setContentProtection(on))
  ipcMain.handle('windows:displays', () => ({ count: displayCount() }))

  ipcMain.handle('export:save-notes', async (_e, defaultName: string, contents: string) => {
    const win = getMainWindow()
    const { canceled, filePath } = await dialog.showSaveDialog(win!, {
      defaultPath: join(app.getPath('documents'), defaultName),
      filters: [{ name: 'Markdown', extensions: ['md'] }]
    })
    if (canceled || !filePath) return null
    await fs.writeFile(filePath, contents, 'utf8')
    return filePath
  })
}

function registerShortcuts(): void {
  // Global: during an interview the focus is on the meeting window, not on
  // this app — a shortcut that only works when the panel has focus is useless.
  globalShortcut.register('CommandOrControl+K', () => broadcast('command', 'find'))
  globalShortcut.register('CommandOrControl+Shift+H', () => broadcast('command', 'toggle-collapse'))
  globalShortcut.register('CommandOrControl+Shift+R', () => broadcast('command', 'recap'))
}

app.whenReady().then(async () => {
  const settings = await repository.loadSettings()
  setContentProtection(settings.contentProtection)
  registerIpc()
  registerShortcuts()
  await createMainWindow()
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})

app.on('window-all-closed', () => {
  app.quit()
})
