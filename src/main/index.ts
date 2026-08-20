import { app, desktopCapturer, dialog, globalShortcut, ipcMain, net, protocol, session } from 'electron'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { repository } from './persistence'
import { downloadModels, modelsDir, modelsStatus } from './models'
import { permissionStatus, requestMicrophone, openScreenRecordingSettings } from './permissions'
import {
  allWindows,
  broadcast,
  createMainWindow,
  displayCount,
  getMainWindow,
  getStripWindow,
  hasWindows,
  openSecondScreenBank,
  setContentProtection,
  setView,
  setQuitting,
  showMain,
  showStrip,
  stripBounds
} from './windows'
import { installAppMenu, installTray, type AppActions } from './appMenu'
import type { Settings } from '../shared/types'
import type { StripState, ViewName } from '../shared/ipc'

// userData/models is served to the renderer (and its workers) over a
// privileged custom scheme — @xenova/transformers fetches model files, and a
// bare filesystem path is not fetchable from the renderer.
protocol.registerSchemesAsPrivileged([
  { scheme: 'lih-models', privileges: { supportFetchAPI: true, bypassCSP: true } }
])

// no dock bounce / focus steal when helper windows appear
if (process.platform === 'darwin') {
  app.dock?.hide()
  app.dock?.show() // keep the app in the dock, but windows use showInactive()
}

function registerIpc(): void {
  ipcMain.handle('bank:load', () => repository.loadBank())
  ipcMain.handle('bank:save', async (e, bank) => {
    await repository.saveBank(bank)
    // other windows reload so edits made on a second screen aren't stale
    for (const win of allWindows()) {
      if (win.webContents.id !== e.sender.id) win.webContents.send('bank:did-change')
    }
  })

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

  // ---- strip window bridge ----
  // the session-owning renderer publishes snapshots; main relays the latest to
  // the strip window (and primes fresh strip windows on request)
  let lastStripState: StripState | null = null
  ipcMain.on('strip:publish', (_e, s: StripState) => {
    lastStripState = s
    getStripWindow()?.webContents.send('strip:state', s)
  })
  ipcMain.handle('strip:get', () => lastStripState)
  ipcMain.handle('strip:expand', () => broadcast('command', 'strip-expand'))

  // ---- on-device models ----
  ipcMain.handle('models:status', () => modelsStatus())
  ipcMain.handle('models:download', async (e) => {
    try {
      await downloadModels((p) => e.sender.send('models:progress', p))
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
}

function registerShortcuts(actions: AppActions): void {
  // Global: during an interview the focus is on the meeting window, not on
  // this app — a shortcut that only works when the panel has focus is useless.
  globalShortcut.register('CommandOrControl+K', () => broadcast('command', 'find'))
  globalShortcut.register('CommandOrControl+Shift+H', () => broadcast('command', 'toggle-collapse'))
  globalShortcut.register('CommandOrControl+Shift+R', () => broadcast('command', 'recap'))
  globalShortcut.register('CommandOrControl+Shift+D', () => broadcast('command', 'diagnostics'))
  // Cmd+Shift+Q, not Cmd+Q: globalShortcut is system-wide, so registering
  // plain Cmd+Q would steal Quit from every other app. Plain Cmd+Q still works
  // via the app menu whenever this app has focus.
  globalShortcut.register('CommandOrControl+Shift+Q', actions.quit)
  // getting a lost window back without hunting for the tray
  globalShortcut.register('CommandOrControl+Shift+P', actions.showPanel)
}

app.whenReady().then(async () => {
  // system-audio loopback: route the renderer's getDisplayMedia through the
  // primary screen with loopback audio. Loopback is Windows-only in this
  // Electron; elsewhere the stream arrives without an audio track and the
  // capture path surfaces the platform instruction (see drivers/real.ts).
  session.defaultSession.setDisplayMediaRequestHandler(
    (_request, callback) => {
      desktopCapturer
        .getSources({ types: ['screen'] })
        // 'loopback' (not 'loopbackWithMute') — the candidate must keep
        // hearing the meeting
        .then((sources) => callback({ video: sources[0], audio: 'loopback' }))
        .catch(() => callback({} as Electron.Streams)) // empty → getDisplayMedia rejects
    },
    { useSystemPicker: false }
  )

  // serve userData/models over the privileged scheme registered above
  const dir = modelsDir()
  protocol.handle('lih-models', (req) => {
    const rel = decodeURIComponent(new URL(req.url).pathname)
    const file = join(dir, rel)
    if (!file.startsWith(dir)) return new Response(null, { status: 403 })
    return net.fetch(pathToFileURL(file).toString())
  })

  const settings = await repository.loadSettings()
  setContentProtection(settings.contentProtection)
  registerIpc()

  const actions: AppActions = {
    showPanel: () => showMain(),
    toggleCollapse: () => broadcast('command', 'toggle-collapse'),
    openFind: () => broadcast('command', 'find'),
    openRecap: () => broadcast('command', 'recap'),
    pause: () => broadcast('command', 'pause'),
    quit: () => {
      setQuitting()
      app.quit()
    }
  }
  installAppMenu(actions)
  installTray(actions)
  registerShortcuts(actions)

  await createMainWindow()
})

// clicking the dock icon (or the tray) must always be able to surface a window
app.on('activate', () => showMain())

app.on('before-quit', () => {
  setQuitting()
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})

app.on('window-all-closed', () => {
  // a *hidden* window still counts as a window, so this only fires once
  // everything is genuinely gone — quit rather than linger invisibly
  if (!hasWindows()) app.quit()
})
