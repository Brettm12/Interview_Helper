import { BrowserWindow, screen, shell } from 'electron'
import { join } from 'node:path'
import { repository } from './persistence'
import { VIEW_FRAMES, clampStripPosition, frameFor } from '../shared/frames'
import type { Settings } from '../shared/types'
import type { ViewName } from '../shared/ipc'

// Window management. One morphing main window (setup → armed → live → bank →
// recap all reuse it, resized/repositioned per view), plus the frameless
// share-safe strip and an optional second-screen bank window. The frame
// matrix itself is pure (frames.ts) and unit-tested.
//
// Desktop behaviour per the handoff: always-on-top at 'floating' level,
// visible across spaces, no dock activation on show, content protection on
// by default so helper windows are excluded from screen capture.

let mainWindow: BrowserWindow | null = null
let stripWindow: BrowserWindow | null = null
let secondScreenWindow: BrowserWindow | null = null
let protectionOn = true
let quitting = false
/** the renderer reports arm/end; close interception and the session-scoped
 *  shortcuts key off it (REVIEW.md H16/M19) */
let sessionActive = false

/** main tells us a quit is under way so window teardown stops resurrecting
 *  windows on the way out */
export function setQuitting(): void {
  quitting = true
}

function isQuitting(): boolean {
  return quitting
}

export function setSessionActive(on: boolean): void {
  sessionActive = on
}

export function isSessionActive(): boolean {
  return sessionActive
}

/** A crashed renderer must not sit there as a frozen last-painted frame that
 *  looks alive (REVIEW.md L17) — reload it and let the boot paths recover
 *  (the strip re-primes over strip:get; the session window finds the 20s
 *  snapshot). */
function guardRenderer(win: BrowserWindow): void {
  win.webContents.on('render-process-gone', (_e, details) => {
    console.warn('[windows] renderer gone:', details.reason)
    if (!win.isDestroyed() && details.reason !== 'clean-exit') {
      win.webContents.reload()
    }
  })
}

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

/** a window reference is only usable if it still exists — every caller below
 *  goes through this, because a destroyed BrowserWindow throws on .show() */
function live(win: BrowserWindow | null): BrowserWindow | null {
  return win != null && !win.isDestroyed() ? win : null
}

/** Reveal the main window and give it focus. The recovery path for the tray,
 *  the dock, and app.on('activate') — without it, a hidden main window plus a
 *  closed strip leaves the app running with nothing on screen. Recreates the
 *  window when it was closed: every recovery affordance used to silently
 *  no-op after a ⌘W, leaving a running, invisible app (REVIEW.md H16). */
export function showMain(): void {
  const win = live(mainWindow)
  if (!win) {
    if (!isQuitting()) void createMainWindow()
    return
  }
  live(stripWindow)?.hide()
  win.show()
  win.focus()
}

export async function createMainWindow(): Promise<BrowserWindow> {
  mainWindow = new BrowserWindow({
    ...baseWindowOptions(),
    ...VIEW_FRAMES.setup,
    resizable: true
  })
  mainWindow.on('ready-to-show', () => mainWindow?.show())
  // one habitual ⌘W used to destroy the session renderer — everything since
  // the last snapshot — with no way back (REVIEW.md H16): during a session,
  // close hides instead
  mainWindow.on('close', (e) => {
    if (!isQuitting() && sessionActive && mainWindow && !mainWindow.isDestroyed()) {
      e.preventDefault()
      mainWindow.hide()
    }
  })
  // drop the reference so nothing later calls .show() on a destroyed window
  mainWindow.on('closed', () => (mainWindow = null))
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })
  guardRenderer(mainWindow)
  mainWindow.setContentProtection(protectionOn)
  await loadInto(mainWindow, { window: 'main' })
  return mainWindow
}

/** morph the main window frame for a view — the matrix lives in frames.ts */
export function setView(view: ViewName, placement?: Settings['placement']): void {
  const win = live(mainWindow)
  if (!win) return
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const plan = frameFor(view, placement, display.workArea)

  if (plan.helper) {
    applyHelperBehaviour(win)
  } else {
    // ordinary windows again — undo the helper behaviour, including workspace
    // stickiness, which otherwise makes them follow across every Space forever
    win.setAlwaysOnTop(false)
    win.setVisibleOnAllWorkspaces(false)
  }
  win.setBounds(plan.bounds)
  if (plan.show === 'active') win.show()
  else if (plan.show === 'inactive') win.showInactive() // no focus steal
  // 'none': the strip is the visible surface; stay hidden until expand
}

export async function showStrip(show: boolean, stripPosition: Settings['stripPosition']): Promise<void> {
  if (!show) {
    live(stripWindow)?.hide()
    live(mainWindow)?.showInactive()
    return
  }
  if (!live(stripWindow)) {
    stripWindow = null
    // clamp the remembered position to a display that still exists — restoring
    // it verbatim after a monitor change opened the strip fully off-screen
    // while the main window hid behind it (REVIEW.md H14)
    const STRIP = { width: 366, height: 39 } // 340 content + 24 padding + 2 border
    const nearest = stripPosition
      ? screen.getDisplayMatching({ ...stripPosition, ...STRIP })
      : screen.getPrimaryDisplay()
    const wa = nearest.workArea
    const fallbackWa = screen.getPrimaryDisplay().workArea
    const pos = clampStripPosition(stripPosition, STRIP, wa, {
      x: fallbackWa.x + fallbackWa.width - STRIP.width - 14,
      y: fallbackWa.y + 14
    })
    stripWindow = new BrowserWindow({
      ...baseWindowOptions(),
      ...STRIP,
      x: pos.x,
      y: pos.y,
      resizable: false,
      skipTaskbar: true,
      hasShadow: false,
      transparent: true,
      backgroundColor: undefined
    })
    guardRenderer(stripWindow)
    applyHelperBehaviour(stripWindow)
    // if the strip is destroyed by any route, drop the ref AND bring the main
    // window back — otherwise the app is left running with nothing on screen
    stripWindow.on('closed', () => {
      stripWindow = null
      if (!isQuitting()) showMain()
    })
    // the strip remembers its position — persist on drag, debounced
    let moveTimer: ReturnType<typeof setTimeout> | null = null
    stripWindow.on('moved', () => {
      if (moveTimer) clearTimeout(moveTimer)
      moveTimer = setTimeout(() => {
        const pos = stripBounds()
        if (!pos) return
        // patch through the same serialized path as every other settings
        // writer — a full-object save here could revert a renderer edit
        // landing in the same instant (REVIEW.md L10)
        void repository
          .updateSettings({ stripPosition: pos })
          .then((merged) => broadcast('settings:did-change', merged))
          .catch(() => {})
      }, 500)
    })
    await loadInto(stripWindow, { window: 'strip' })
  }
  live(mainWindow)?.hide()
  live(stripWindow)?.showInactive()
}

export function stripBounds(): { x: number; y: number } | null {
  if (!live(stripWindow)) return null
  const b = stripWindow!.getBounds()
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
    guardRenderer(secondScreenWindow)
    secondScreenWindow.setContentProtection(protectionOn)
    await loadInto(secondScreenWindow, { window: 'bank' })
  }
  secondScreenWindow.show()
  return { ok: true }
}

export function setContentProtection(on: boolean): void {
  protectionOn = on
  for (const win of allWindows()) win.setContentProtection(on)
}

export function displayCount(): number {
  return screen.getAllDisplays().length
}

/** broadcast a command (global shortcut, tray, strip action) to every window */
export function broadcast(channel: string, ...args: unknown[]): void {
  for (const win of allWindows()) win.webContents.send(channel, ...args)
}

/** true while any window is still around — `window-all-closed` never fires for
 *  a merely *hidden* window, so quit decisions need this rather than a count */
export function hasWindows(): boolean {
  return allWindows().length > 0
}
