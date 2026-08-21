// Electron-level probes for the window/shortcut layer — the regressions the
// review found with ad-hoc scripts, made repeatable (REVIEW.md C6 H14 H16 M18).
// Requires the production build (out/) and a display; headless Linux re-execs
// under xvfb-run. Run: npm run build && node tools/verify/windows-probe.mjs
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { repoRoot } from './lib.mjs'

if (!process.env.DISPLAY && process.platform === 'linux') {
  const which = spawnSync('which', ['xvfb-run'])
  if (which.status === 0) {
    const res = spawnSync('xvfb-run', ['-a', process.execPath, ...process.argv.slice(1)], {
      stdio: 'inherit',
      env: process.env
    })
    process.exit(res.status ?? 1)
  }
  console.error('no DISPLAY and no xvfb-run — cannot run the windows probe')
  process.exit(1)
}

const { _electron } = await import('playwright')
const { mkdtempSync } = await import('node:fs').then((m) => m)
const { tmpdir } = await import('node:os')
const isolatedUserData = mkdtempSync(join(tmpdir(), 'lih-probe-'))
const mainEntry = join(repoRoot, 'out', 'main', 'index.js')
if (!existsSync(mainEntry)) {
  console.error('out/main/index.js missing — run npm run build first')
  process.exit(1)
}

const stage = (name) => console.log(`  ✓ ${name}`)
const fail = (msg) => {
  console.error(`\nWINDOWS PROBE FAIL: ${msg}`)
  process.exit(1)
}

async function launch() {
  return _electron.launch({
    args: ['--no-sandbox', mainEntry],
    env: { ...process.env, MOCK_SESSION: '1', LIH_USER_DATA: isolatedUserData },
    cwd: repoRoot
  })
}

/** window inventory from the main process, keyed by width */
async function windows(app) {
  return app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().map((w) => ({
      bounds: w.getBounds(),
      visible: w.isVisible(),
      alwaysOnTop: w.isAlwaysOnTop(),
      destroyed: w.isDestroyed()
    }))
  )
}

const app = await launch()
const win = await app.firstWindow()
const userData = await app.evaluate(({ app: a }) => a.getPath('userData'))

// ---- probe 1: strip placement — the live morph must not surface/steal ------
await win.locator('.setup-cta:not(.setup-cta--disabled)').waitFor({ timeout: 20000 })
await win.locator('.setup-placement', { hasText: 'Floating strip' }).click()
await win.locator('.setup-cta').click()
// armed + collapsed: the strip window appears, the main window hides
const stripUp = async () => (await windows(app)).some((w) => w.bounds.width === 366 && w.visible)
const deadline = Date.now() + 15000
while (!(await stripUp()) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 250))
if (!(await stripUp())) fail('strip window never appeared for strip placement')
stage('strip placement: collapsed to the strip window on start')

// wait past the first confident match (fixture ~5s) and assert the hidden
// session window kept helper behaviour and never surfaced (C6)
await new Promise((r) => setTimeout(r, 9000))
const afterMatch = await windows(app)
const mainW = afterMatch.find((w) => w.bounds.width !== 366)
if (!mainW) fail('main window vanished')
if (mainW.visible) fail(`main window surfaced during strip placement (C6): ${JSON.stringify(mainW)}`)
if (!mainW.alwaysOnTop) fail(`main window lost always-on-top during live morph (C6)`)
if (mainW.bounds.width !== 412) fail(`main window not on the live frame: ${JSON.stringify(mainW.bounds)}`)
stage('first match: session window stayed hidden, helper level kept, live frame applied (C6)')

// ---- probe 4: close interception during a session (H16) --------------------
await app.evaluate(({ BrowserWindow }) => {
  const main = BrowserWindow.getAllWindows().find((w) => w.getBounds().width !== 366)
  main.close()
})
await new Promise((r) => setTimeout(r, 500))
const afterClose = await windows(app)
if (!afterClose.some((w) => w.bounds.width !== 366 && !w.destroyed)) {
  fail('⌘W destroyed the session window mid-session (H16)')
}
stage('close during a session hides instead of destroying (H16)')
await app.evaluate(({ app: a }) => a.emit('activate'))
await new Promise((r) => setTimeout(r, 500))
if (!(await windows(app)).some((w) => w.visible)) fail('activate could not recover a window (H16)')
stage('activate recovers a visible window (H16)')

// ---- probe 3: single instance (M18) ----------------------------------------
let second = null
let secondDied = false
try {
  second = await launch()
  const exited = new Promise((resolve) => second.process().once('exit', () => resolve(true)))
  secondDied = await Promise.race([exited, new Promise((r) => setTimeout(() => r(false), 8000))])
} catch {
  secondDied = true // refused to even come up — the lock did its job
}
if (!secondDied) {
  await second?.close().catch(() => {})
  fail('a second instance ran alongside the first (M18)')
}
stage('second instance exits immediately (M18)')

await app.close().catch(() => {})

// ---- probe 2: off-screen strip position is clamped (H14) -------------------
mkdirSync(userData, { recursive: true })
const settingsPath = join(userData, 'settings.json')
const existing = existsSync(settingsPath) ? JSON.parse(readFileSync(settingsPath, 'utf8')) : {}
writeFileSync(
  settingsPath,
  JSON.stringify({
    contentProtection: true,
    keepTranscript: false,
    placement: 'strip',
    micDeviceId: null,
    meetingDeviceId: null,
    ...existing,
    stripPosition: { x: 4000, y: 4000 } // a monitor that no longer exists
  })
)
const app2 = await launch()
const win2 = await app2.firstWindow()
await win2.locator('.setup-cta:not(.setup-cta--disabled)').waitFor({ timeout: 20000 })
await win2.locator('.setup-cta').click()
const clampDeadline = Date.now() + 15000
let strip2 = null
while (Date.now() < clampDeadline) {
  strip2 = (await windows(app2)).find((w) => w.bounds.width === 366 && w.visible)
  if (strip2) break
  await new Promise((r) => setTimeout(r, 250))
}
if (!strip2) fail('strip window never appeared in the clamp probe')
const display = await app2.evaluate(({ screen }) => screen.getPrimaryDisplay().workArea)
const inArea =
  strip2.bounds.x >= display.x - 10 &&
  strip2.bounds.x + 120 <= display.x + display.width + 10 &&
  strip2.bounds.y >= display.y - 10 &&
  strip2.bounds.y <= display.y + display.height - 20
if (!inArea) fail(`strip restored off-screen (H14): ${JSON.stringify(strip2.bounds)} vs ${JSON.stringify(display)}`)
stage(`off-screen saved position clamped onto the display (H14): ${JSON.stringify(strip2.bounds)}`)
await app2.close().catch(() => {})

console.log('\nWINDOWS PROBE PASS')
