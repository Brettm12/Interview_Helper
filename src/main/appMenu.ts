import { app, Menu, nativeImage, Tray } from 'electron'
import type { MenuItemConstructorOptions } from 'electron'
import { TRAY_ICON_1X, TRAY_ICON_2X } from './trayIcon'

// Ways out of the app. Every window is frameless and always-on-top, so
// without these there is genuinely no way to quit except Force Quit — and
// because helper windows are shown with showInactive(), the app often has no
// keyboard focus for a menu accelerator to reach.
//
// Deliberately NOT registering Cmd+Q as a global shortcut: globalShortcut is
// system-wide, so that would hijack Quit in every other app on the machine.
// Cmd+Q works through the menu when focused; Cmd+Shift+Q is the global escape
// hatch that works when the panel is unfocused behind the meeting window.

export interface AppActions {
  showPanel(): void
  toggleCollapse(): void
  openFind(): void
  openRecap(): void
  pause(): void
  quit(): void
}

let tray: Tray | null = null

export function installAppMenu(actions: AppActions): void {
  const isMac = process.platform === 'darwin'

  const appMenu: MenuItemConstructorOptions = {
    label: app.getName(),
    submenu: [
      { role: 'about' },
      { type: 'separator' },
      { label: 'Show Panel', accelerator: 'CommandOrControl+Shift+P', click: actions.showPanel },
      { label: 'Pause Listening', click: actions.pause },
      { type: 'separator' },
      { role: 'hide' },
      { role: 'hideOthers' },
      { role: 'unhide' },
      { type: 'separator' },
      // plain Cmd+Q, the accelerator every macOS user reaches for first
      { label: `Quit ${app.getName()}`, accelerator: 'CommandOrControl+Q', click: actions.quit }
    ]
  }

  // the app's own shortcuts, listed so they're discoverable rather than
  // documented only in the README
  const sessionMenu: MenuItemConstructorOptions = {
    label: 'Session',
    submenu: [
      { label: 'Find Answer', accelerator: 'CommandOrControl+K', click: actions.openFind },
      { label: 'Hide / Show Panel', accelerator: 'CommandOrControl+Shift+H', click: actions.toggleCollapse },
      { label: 'End Session & Show Recap', accelerator: 'CommandOrControl+Shift+R', click: actions.openRecap },
      { type: 'separator' },
      { label: 'Pause Listening', click: actions.pause }
    ]
  }

  const editMenu: MenuItemConstructorOptions = {
    label: 'Edit',
    submenu: [
      { role: 'undo' },
      { role: 'redo' },
      { type: 'separator' },
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      { role: 'selectAll' }
    ]
  }

  const windowMenu: MenuItemConstructorOptions = {
    label: 'Window',
    submenu: [{ role: 'minimize' }, { role: 'close' }]
  }

  // Windows/Linux have no app menu, so Quit lives under File — without this
  // those platforms get a menu bar with no way out at all
  const fileMenu: MenuItemConstructorOptions = {
    label: 'File',
    submenu: [
      { label: 'Show Panel', accelerator: 'CommandOrControl+Shift+P', click: actions.showPanel },
      { type: 'separator' },
      { label: 'Quit', accelerator: 'CommandOrControl+Q', click: actions.quit }
    ]
  }

  Menu.setApplicationMenu(
    Menu.buildFromTemplate(
      isMac
        ? [appMenu, editMenu, sessionMenu, windowMenu]
        : [fileMenu, editMenu, sessionMenu, windowMenu]
    )
  )
}

/** Tray creation throws on Linux desktops with no system-tray daemon — a
 *  missing menu-bar icon must never stop the app from starting, since the
 *  menu and the global shortcut are still perfectly good ways out. */
export function installTray(actions: AppActions): Tray | null {
  try {
    return buildTray(actions)
  } catch (err) {
    console.warn('[tray] unavailable on this desktop:', err)
    return null
  }
}

function buildTray(actions: AppActions): Tray {
  const icon = nativeImage.createFromDataURL(TRAY_ICON_1X)
  icon.addRepresentation({ scaleFactor: 2, dataURL: TRAY_ICON_2X })
  // macOS recolours template images for light/dark menu bars
  icon.setTemplateImage(true)

  tray = new Tray(icon)
  tray.setToolTip('Live Interview Helper')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Show Panel', click: actions.showPanel },
      { label: 'Hide / Show Panel', click: actions.toggleCollapse },
      { type: 'separator' },
      { label: 'Pause Listening', click: actions.pause },
      { label: 'End Session & Show Recap', click: actions.openRecap },
      { type: 'separator' },
      { label: 'Quit', accelerator: 'CommandOrControl+Q', click: actions.quit }
    ])
  )
  // clicking the icon itself is the fastest way back to a lost window
  tray.on('click', actions.showPanel)
  return tray
}

/** keep a module reference so the Tray isn't garbage collected (it vanishes
 *  from the menu bar if it is) */
export function getTray(): Tray | null {
  return tray
}
