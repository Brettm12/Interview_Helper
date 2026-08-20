import { BrowserWindow, screen, shell } from 'electron'
import { join } from 'node:path'
import { repository } from './persistence'
import type { Settings } from '../shared/types'
import type { ViewName } from '../shared/ipc'

// Window management. One morphing main window (setup → armed → live → bank →
// recap all reuse it, resized/repositioned per view), plus the frameless
// share-safe strip and an optional second-screen bank window.
//
// Desktop behaviour per the handoff: always-on-top at 'floating' level,
// visible across spaces, no dock activation on show, content protection on
// by default so helper windows are excluded from screen capture.

const VIEW_FRAMES: Record<ViewName, { width: number; height: number }> = {
  setup: { width: 880, height: 812 },
  armed: { width: 412, height: 400 },
  live: { width: 412, height: 836 },
  bank: { width: 1280, height: 812 },
  recap: { width: 880, height: 812 }
}

let mainWindow: BrowserWindow | null = null
let stripWindow: BrowserWindow | null = null
let secondScreenWindow: BrowserWindow | null = null
let protectionOn = true

function rendererUrl(query: Record<string, string>): { url?: string; file?: string; query: Record<string, string> } {
  const dev = process.env['ELECTRON_RENDERER_URL']
  if (dev) {
    const u = new URL(dev)
    Object.entries(query).forEach(([k, v]) => u.searchParams.set(k, v))
    return { url: u.toString(), query }
  }
  return { file: join(__dirname, '../renderer/index.html'), query }
}

function baseWindowOptions(): Electron.BrowserWindowConstructorOptions {
  return {
    show: false,
    frame: false,
    backgroundColor: '#16181b',
    webPreferences: {
      // electron-vite emits an ESM preload (package "type": "module")
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false
    }
  }
}

function applyHelperBehaviour(win: BrowserWindow): void {
  win.setAlwaysOnTop(true, 'floating')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  win.setContentProtection(protectionOn)
}

async function loadInto(win: BrowserWindow, query: Record<string, string>): Promise<void> {
  const target = rendererUrl(query)
  if (target.url) await win.loadURL(target.url)
  else await win.loadFile(target.file!, { query: target.query })
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}

export function getStripWindow(): BrowserWindow | null {
  return stripWindow
}

export function allWindows(): BrowserWindow[] {
  return [mainWindow, stripWindow, secondScreenWindow].filter(
    (w): w is BrowserWindow => w != null && !w.isDestroyed()
  )
}

export async function createMainWindow(): Promise<BrowserWindow> {
  mainWindow = new BrowserWindow({
    ...baseWindowOptions(),
    ...VIEW_FRAMES.setup,
    resizable: true
  })
  mainWindow.on('ready-to-show', () => mainWindow?.show())
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })
  mainWindow.setContentProtection(protectionOn)
  await loadInto(mainWindow, { window: 'main' })
  return mainWindow
}

/** morph the main window frame for a view */
export function setView(view: ViewName, placement?: Settings['placement']): void {
  if (!mainWindow) return
  const frame = VIEW_FRAMES[view]
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const wa = display.workArea

  if (view === 'live' && placement !== 'strip') {
    // docked right: a separate always-on-top panel against the right edge of
    // the display — it resizes nothing else
    const bounds = { x: wa.x + wa.width - 412, y: wa.y, width: 412, height: wa.height }
    applyHelperBehaviour(mainWindow)
    mainWindow.setBounds(bounds)
    mainWindow.showInactive() // no focus steal from the meeting
    return
  }

  if (view === 'armed') {
    applyHelperBehaviour(mainWindow)
    mainWindow.setBounds({
      x: wa.x + wa.width - frame.width - 14,
      y: wa.y + 14,
      width: frame.width,
      height: frame.height
    })
    mainWindow.showInactive()
    return
  }

  mainWindow.setAlwaysOnTop(false)
  mainWindow.setBounds({
    x: wa.x + Math.round((wa.width - frame.width) / 2),
    y: wa.y + Math.round((wa.height - frame.height) / 2),
    width: frame.width,
    height: frame.height
  })
  mainWindow.show()
}

export async function showStrip(show: boolean, stripPosition: Settings['stripPosition']): Promise<void> {
  if (!show) {
    stripWindow?.hide()
    mainWindow?.showInactive()
    return
  }
  if (!stripWindow) {
    const display = screen.getPrimaryDisplay()
    const wa = display.workArea
    // 340px strip content + 24px padding + 2px border (the mock is content-box)
    stripWindow = new BrowserWindow({
      ...baseWindowOptions(),
      width: 366,
      height: 39,
      x: stripPosition?.x ?? wa.x + wa.width - 366 - 14,
      y: stripPosition?.y ?? wa.y + 14,
      resizable: false,
      skipTaskbar: true,
      hasShadow: false,
      transparent: true,
      backgroundColor: undefined
    })
    applyHelperBehaviour(stripWindow)
    // the strip remembers its position — persist on drag, debounced
    let moveTimer: ReturnType<typeof setTimeout> | null = null
    stripWindow.on('moved', () => {
      if (moveTimer) clearTimeout(moveTimer)
      moveTimer = setTimeout(() => {
        const pos = stripBounds()
        if (!pos) return
        void repository
          .loadSettings()
          .then((s) => repository.saveSettings({ ...s, stripPosition: pos }))
      }, 500)
    })
    await loadInto(stripWindow, { window: 'strip' })
  }
  mainWindow?.hide()
  stripWindow.showInactive()
}

export function stripBounds(): { x: number; y: number } | null {
  if (!stripWindow) return null
  const b = stripWindow.getBounds()
  return { x: b.x, y: b.y }
}

export async function openSecondScreenBank(): Promise<{ ok: boolean; error?: string }> {
  const displays = screen.getAllDisplays()
  if (displays.length < 2) {
    return { ok: false, error: 'Only one display connected — second screen needs two.' }
  }
  const primary = screen.getPrimaryDisplay()
  const other = displays.find((d) => d.id !== primary.id)!
  if (!secondScreenWindow) {
    secondScreenWindow = new BrowserWindow({
      ...baseWindowOptions(),
      x: other.workArea.x + Math.round((other.workArea.width - 1280) / 2),
      y: other.workArea.y + Math.round((other.workArea.height - 812) / 2),
      width: 1280,
      height: 812
    })
    secondScreenWindow.on('closed', () => (secondScreenWindow = null))
    secondScreenWindow.setContentProtection(protectionOn)
    await loadInto(secondScreenWindow, { window: 'bank' })
  }
  secondScreenWindow.show()
  return { ok: true }
}

export function setContentProtection(on: boolean): void {
  protectionOn = on
  for (const win of [mainWindow, stripWindow, secondScreenWindow]) {
    win?.setContentProtection(on)
  }
}

export function displayCount(): number {
  return screen.getAllDisplays().length
}

/** broadcast a command (global shortcut, strip action) to every window */
export function broadcast(channel: string, ...args: unknown[]): void {
  for (const win of [mainWindow, stripWindow, secondScreenWindow]) {
    win?.webContents.send(channel, ...args)
  }
}
