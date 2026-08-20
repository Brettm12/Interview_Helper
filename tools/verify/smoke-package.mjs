// Launch-test the *packaged* app, not the dev build. This is the check that
// catches packaging mistakes a dev run never sees: files missing from the
// asar, the preload path being wrong, the renderer bundle or bundled fonts
// not resolving, seed.json not shipping. Run after `npm run package`.
//   node tools/verify/smoke-package.mjs
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { repoRoot } from './lib.mjs'

const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'))

if (!process.env.DISPLAY && process.platform === 'linux') {
  if (spawnSync('which', ['xvfb-run']).status === 0) {
    const res = spawnSync('xvfb-run', ['-a', process.execPath, ...process.argv.slice(1)], {
      stdio: 'inherit',
      env: process.env
    })
    process.exit(res.status ?? 1)
  }
  console.error('no DISPLAY and no xvfb-run — cannot launch the packaged app')
  process.exit(1)
}

/** find the packaged executable for this platform under release/.
 *  electron-builder names the macOS .app and the Windows .exe after
 *  productName, but the Linux executable after the npm `name`. */
function packagedBinary() {
  const rel = join(repoRoot, 'release')
  if (!existsSync(rel)) return null
  if (process.platform === 'darwin') {
    const dir = readdirSync(rel).find((d) => d === 'mac' || d.startsWith('mac-'))
    if (!dir) return null
    const appDir = join(rel, dir)
    const app = readdirSync(appDir).find((d) => d.endsWith('.app'))
    if (!app) return null
    // macOS caps CFBundleExecutable at 15 chars, so the binary is a truncated
    // productName ("Live Interview") — read it rather than assume
    const macOS = join(appDir, app, 'Contents', 'MacOS')
    const [bin] = readdirSync(macOS)
    return bin ? join(macOS, bin) : null
  }
  if (process.platform === 'win32') {
    const dir = join(rel, 'win-unpacked')
    const exe = existsSync(dir) ? join(dir, `${pkg.productName}.exe`) : null
    return exe && existsSync(exe) ? exe : null
  }
  const bin = join(rel, 'linux-unpacked', pkg.name)
  return existsSync(bin) ? bin : null
}

const executablePath = packagedBinary()
if (!executablePath) {
  console.error('no packaged build found under release/ — run npm run package first')
  process.exit(1)
}
console.log(`launching ${executablePath}`)

const { _electron } = await import('playwright')
const app = await _electron.launch({
  executablePath,
  args: ['--no-sandbox'],
  env: { ...process.env, MOCK_SESSION: '1' }
})

try {
  const win = await app.firstWindow({ timeout: 30000 })
  await win.waitForLoadState('domcontentloaded')

  // renderer bundle + seed.json shipped and parsed
  await win.locator('.setup').waitFor({ timeout: 20000 })
  console.log('  ✓ renderer booted from asar')

  const title = ((await win.locator('.setup-header__title').textContent()) ?? '').trim()
  if (!title) throw new Error('setup title empty — seed.json may not have shipped')
  console.log(`  ✓ bank loaded from the packaged seed ("${title}")`)

  // preload/IPC alive: settings + permissions round-trip through main
  const apiOk = await win.evaluate(async () => {
    if (!window.api) return 'window.api missing (preload did not load)'
    const s = await window.api.settings.load()
    const m = await window.api.models.status()
    return typeof s.contentProtection === 'boolean' && typeof m.dir === 'string'
      ? 'ok'
      : 'ipc returned unexpected shapes'
  })
  if (apiOk !== 'ok') throw new Error(apiOk)
  console.log('  ✓ preload + IPC round-trip')

  // bundled fonts resolve inside the package (no network, no CDN)
  const fontOk = await win.evaluate(async () => {
    await document.fonts.ready
    return document.fonts.check('400 21px "Instrument Serif"')
  })
  if (!fontOk) throw new Error('Instrument Serif did not load from the package')
  console.log('  ✓ bundled fonts resolve offline')

  // --- ways out of the app ---
  // every window is frameless and always-on-top, so without these there is
  // genuinely no way to quit but Force Quit (regression from real use)
  const menu = await app.evaluate(async ({ Menu }) => {
    const m = Menu.getApplicationMenu()
    if (!m) return null
    const labels = []
    const walk = (items) => {
      for (const i of items) {
        labels.push(i.label)
        if (i.submenu) walk(i.submenu.items)
      }
    }
    walk(m.items)
    return labels
  })
  if (!menu) throw new Error('no application menu — Cmd+Q would not exist')
  if (!menu.some((l) => /quit/i.test(l ?? ''))) {
    throw new Error(`application menu has no Quit item: ${JSON.stringify(menu)}`)
  }
  console.log('  ✓ application menu offers Quit')

  const shortcuts = await app.evaluate(async ({ globalShortcut }) => ({
    quit: globalShortcut.isRegistered('CommandOrControl+Shift+Q'),
    show: globalShortcut.isRegistered('CommandOrControl+Shift+P'),
    // must NOT hijack plain Cmd+Q system-wide from every other app
    plainQ: globalShortcut.isRegistered('CommandOrControl+Q')
  }))
  if (!shortcuts.quit) throw new Error('no global quit shortcut registered')
  if (shortcuts.plainQ) throw new Error('plain Cmd+Q registered globally — that hijacks every other app')
  console.log('  ✓ global quit shortcut, without hijacking system Cmd+Q')

  // the zombie regression: hiding the main window and destroying the strip
  // used to leave a running, invisible, unquittable process
  const recovered = await app.evaluate(async ({ BrowserWindow }) => {
    const [main] = BrowserWindow.getAllWindows()
    main.hide()
    return new Promise((resolve) => {
      setTimeout(() => resolve(BrowserWindow.getAllWindows().some((w) => w.isVisible())), 300)
    })
  })
  if (recovered !== false) throw new Error('expected the window to be hidden for the recovery check')
  const restored = await app.evaluate(async ({ app: a, BrowserWindow }) => {
    a.emit('activate')
    return new Promise((resolve) => {
      setTimeout(() => resolve(BrowserWindow.getAllWindows().some((w) => w.isVisible())), 500)
    })
  })
  if (!restored) throw new Error('a hidden window could not be recovered — the zombie state is back')
  console.log('  ✓ hidden window recoverable (no invisible-zombie state)')

  console.log('\nPACKAGE SMOKE PASS')
} catch (err) {
  console.error(`\nPACKAGE SMOKE FAIL: ${err.message}`)
  process.exitCode = 1
} finally {
  await app.close().catch(() => {})
}
