// Electron-level check of the multi-window plumbing: launch the built app in
// mock mode, start the session, collapse to the strip WINDOW, and assert it
// renders live session state relayed over IPC (the strip runs in its own
// renderer with empty stores — this is exactly the seam that can silently
// break). Then expand from the strip and confirm the panel returns.
// Requires the production build (npm script runs it) and a display; headless
// Linux re-execs itself under xvfb-run.
import { existsSync } from 'node:fs'
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
  console.error('no DISPLAY and no xvfb-run — cannot run the Electron check')
  process.exit(1)
}

const { _electron } = await import('playwright')

const mainEntry = join(repoRoot, 'out', 'main', 'index.js')
if (!existsSync(mainEntry)) {
  console.error('out/main/index.js missing — run npm run build first')
  process.exit(1)
}

const stage = (name) => console.log(`  ${name}`)

const app = await _electron.launch({
  args: ['--no-sandbox', mainEntry],
  env: { ...process.env, MOCK_SESSION: '1' },
  cwd: repoRoot
})

try {
  const main = await app.firstWindow()
  await main.locator('.setup-cta:not(.setup-cta--disabled)').waitFor({ timeout: 20000 })
  stage('setup ready (mock levels reported)')
  await main.locator('.setup-cta').click()

  await main.getByText('ARMED · WAITING FOR THEM').waitFor({ timeout: 10000 })
  stage('armed')

  await main.locator('.live-panel').waitFor({ timeout: 30000 })
  await main.locator('.point-row').first().waitFor({ timeout: 20000 })
  stage('live panel matched')

  const stripPromise = app.waitForEvent('window', { timeout: 15000 })
  await main.getByText('Collapse').click()
  const strip = await stripPromise
  stage('strip window opened')

  // the strip renderer has empty stores — content must arrive over IPC
  await strip.locator('.strip__text').waitFor({ timeout: 10000 })
  const deadline = Date.now() + 10000
  let text = ''
  let counter = null
  while (Date.now() < deadline) {
    text = ((await strip.locator('.strip__text').textContent()) ?? '').trim()
    counter = await strip.locator('.strip__counter').count()
    if (text && text !== 'Listening — nothing matched yet' && counter > 0) break
    await new Promise((r) => setTimeout(r, 250))
  }
  if (!text || text === 'Listening — nothing matched yet') {
    throw new Error(`strip window never received session state (text: "${text}")`)
  }
  const counterText = ((await strip.locator('.strip__counter').textContent()) ?? '').trim()
  if (!/^\d+\/\d+$/.test(counterText)) throw new Error(`bad strip counter: "${counterText}"`)
  stage(`strip shows the current point over IPC ("${text}" · ${counterText})`)

  await strip.locator('.strip').click()
  await main.locator('.live-panel').waitFor({ timeout: 10000 })
  stage('expand from the strip returned the panel')

  console.log('\nELECTRON E2E PASS')
} catch (err) {
  console.error(`\nELECTRON E2E FAIL: ${err.message}`)
  process.exitCode = 1
} finally {
  await app.close().catch(() => {})
}
