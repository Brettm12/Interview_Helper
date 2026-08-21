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
  setSessionActive,
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

// Test harnesses point this at a scratch directory so probes and e2e runs
// never touch (or inherit) a real bank/settings. Not a user-facing flag.
if (process.env.LIH_USER_DATA) {
  app.setPath('userData', process.env.LIH_USER_DATA)
}

// One instance only. A second launch used to run fully — sharing the JSON
// files last-writer-wins, with every global shortcut silently dead in the
// instance the user was actually looking at (REVIEW.md M18).
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => showMain())
}

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

  // extension is derived from the name so one handler serves session notes,
  // a markdown bank and a JSON bank backup
  ipcMain.handle('export:save-notes', async (_e, defaultName: string, contents: string) => {
    const win = getMainWindow()
    const ext = defaultName.split('.').pop() ?? 'md'
    const filters =
      ext === 'json'
        ? [{ name: 'JSON', extensions: ['json'] }]
        : [{ name: 'Markdown', extensions: ['md'] }]
    const { canceled, filePath } = await dialog.showSaveDialog(win!, {
      defaultPath: join(app.getPath('documents'), defaultName),
      filters
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

  // ---- session lifecycle ----
  // the renderer reports arm/end; the session chords register only for that
  // span, and close interception guards the session window (H16/M19/H15)
  ipcMain.handle('session:set-active', (_e, active: boolean) => {
    setSessionActive(active === true)
    if (active === true) {
      const failed = registerSessionShortcuts()
      return { failedShortcuts: failed }
    }
    unregisterSessionShortcuts()
    return { failedShortcuts: [] }
  })

  // the find overlay closed — hand key focus back toward the meeting app
  // (best effort; there is no reliable cross-platform "restore previous app")
  ipcMain.handle('windows:find-closed', () => {
    const win = getMainWindow()
    if (win && !win.isDestroyed()) win.blur()
  })

  // ---- on-device models ----
  ipcMain.handle('models:status', (_e, whisperModel?: string) => modelsStatus(whisperModel))
  ipcMain.handle('models:download', async (e, whisperModel?: string) => {
    try {
      await downloadModels((p) => e.sender.send('models:progress', p), whisperModel)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
}

// Global: during an interview the focus is on the meeting window, not on
// this app — a shortcut that only works when the panel has focus is useless.
// But global registrations are system-wide, so the session chords (⌘K in
// Slack/VS Code/Notion…) are only held WHILE a session runs, not for the
// whole app lifetime (REVIEW.md M19). Registration results are checked and
// surfaced — a silently-dead ⌘K is the panic path failing (REVIEW.md H15).

/** ⌘K focuses the session window: the find overlay needs real keyboard
 *  focus, or everything typed lands in the meeting app (REVIEW.md C1) */
function openFindFocused(): void {
  const win = getMainWindow()
  if (win && !win.isDestroyed() && !win.isVisible()) {
    // collapsed to the strip: surface the panel first (expand semantics)
    showMain()
  } else if (win && !win.isDestroyed()) {
    win.show()
    win.focus()
  }
  broadcast('command', 'find')
}

const SESSION_SHORTCUTS: [string, () => void][] = [
  ['CommandOrControl+K', openFindFocused],
  ['CommandOrControl+Shift+H', () => broadcast('command', 'toggle-collapse')],
  ['CommandOrControl+Shift+R', () => broadcast('command', 'recap')],
  ['CommandOrControl+Shift+D', () => broadcast('command', 'diagnostics')]
]

/** @returns accelerators that could NOT be registered (held by another app) */
function registerSessionShortcuts(): string[] {
  const failed: string[] = []
  for (const [accel, handler] of SESSION_SHORTCUTS) {
    let ok = false
    try {
      ok = globalShortcut.register(accel, handler)
    } catch {
      ok = false
    }
    if (!ok) failed.push(accel)
  }
  return failed
}

function unregisterSessionShortcuts(): void {
  for (const [accel] of SESSION_SHORTCUTS) globalShortcut.unregister(accel)
}

function registerAppShortcuts(actions: AppActions): void {
  // Cmd+Shift+Q, not Cmd+Q: globalShortcut is system-wide, so registering
  // plain Cmd+Q would steal Quit from every other app. Plain Cmd+Q still works
  // via the app menu whenever this app has focus.
  if (!globalShortcut.register('CommandOrControl+Shift+Q', actions.quit)) {
    console.warn('[shortcuts] CommandOrControl+Shift+Q is held by another app')
  }
  // getting a lost window back without hunting for the tray
  if (!globalShortcut.register('CommandOrControl+Shift+P', actions.showPanel)) {
    console.warn('[shortcuts] CommandOrControl+Shift+P is held by another app')
  }
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
    openFind: openFindFocused,
    openRecap: () => broadcast('command', 'recap'),
    pause: () => broadcast('command', 'pause'),
    quit: () => {
      setQuitting()
      app.quit()
    }
  }
  installAppMenu(actions)
  installTray(actions)
  registerAppShortcuts(actions)

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
