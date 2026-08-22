// Drives the full mock session end to end in the browser build: setup →
// armed → confident match → coverage strikes → unsure + auto-pick → ⌘K
// override → collapse/expand → session end → recap → persistence. Runs at
// fixture speed (≈105s of scripted delays). Fails loudly on any missed stage.
import { launchBrowser, spawnServer } from './lib.mjs'

const PORT = 5199
const URL = `http://127.0.0.1:${PORT}/`

const server = await spawnServer(
  'npx',
  ['vite', '--config', 'web.vite.config.ts', '--mode', 'mock', '--port', String(PORT), '--strictPort'],
  PORT
)
const browser = await launchBrowser()
const page = await browser.newPage({ viewport: { width: 1560, height: 960 } })
page.setDefaultTimeout(30000)

let t0 = Date.now()
const stage = (name) => console.log(`${((Date.now() - t0) / 1000).toFixed(1)}s  ${name}`)

try {
  await page.goto(URL, { waitUntil: 'networkidle' })
  await page.evaluate(() => localStorage.clear())
  await page.reload({ waitUntil: 'networkidle' })
  t0 = Date.now()

  await page.getByText('Senior People Partner · Meridian Health · Round 2').waitFor()
  await page.getByText('no story yet — fix now').waitFor()
  stage('setup renders with loop + warning stat')

  await page.locator('.setup-toggle--transcript').click()
  if (!(await page.locator('.setup-toggle--on').count())) throw new Error('transcript toggle did not turn on')
  stage('transcript toggle on')

  await page.locator('.setup-cta:not(.setup-cta--disabled)').waitFor()
  stage('both sources report a level → Start enabled')

  // REVIEW.md P8: the primary control has to be reachable and operable from
  // the keyboard — it was a plain div, so it was neither. Focus it and press
  // Enter rather than clicking.
  const ctaTag = await page.locator('.setup-cta').evaluate((el) => el.tagName)
  if (ctaTag !== 'BUTTON') throw new Error(`Start listening is a <${ctaTag}>, not a button`)
  await page.locator('.setup-cta').focus()
  await page.keyboard.press('Enter')

  await page.getByText('ARMED · WAITING FOR THEM').waitFor()
  stage('armed card')

  await page.keyboard.press('Control+k')
  await page.locator('.find-overlay').waitFor()
  await page.keyboard.press('Escape')
  await page.locator('.find-overlay').waitFor({ state: 'detached' })
  stage('⌘K toggles find while armed')

  // REVIEW.md C5: clicking a row that is NOT the current selection must pin
  // THAT row — the old handler pinned whatever was selected before the click
  await page.keyboard.press('Control+k')
  await page.locator('.find-overlay').waitFor()
  await page.keyboard.type('policy')
  // 'rolling out a policy…' ranks first (selected); click the bend row below
  await page.locator('.find-row', { hasText: 'bend a policy' }).click()
  await page.locator('.find-overlay').waitFor({ state: 'detached' })
  await page
    .locator('.live-question', { hasText: 'What would you do if leadership asked you to bend a policy?' })
    .waitFor({ timeout: 10000 })
  stage('clicking a non-selected find row pinned that row (C5)')

  await page
    .getByText('Tell me about a time you handled a difficult employee relations case.')
    .first()
    .waitFor({ timeout: 20000 })
  stage('confident match swaps the panel')

  await page.locator('.point-row--covered').first().waitFor({ timeout: 40000 })
  stage('first point struck through')

  await page.getByText('TAP THE ONE THEY MEANT').waitFor({ timeout: 60000 })
  const candidates = await page.locator('.live-cand').count()
  if (candidates < 2) throw new Error(`expected ≥2 candidates, got ${candidates}`)
  await page.locator('.autopick-track').waitFor()
  stage(`unsure state with ${candidates} candidates + auto-pick bar`)

  // REVIEW.md P1: pressing 1 commits the leader without waiting out the
  // countdown or reaching for the mouse. (The 4s auto-pick itself is covered
  // over this same fixture in tests/engine.test.ts.)
  await page.keyboard.press('1')
  await page
    .locator('.live-question', { hasText: 'Walk me through how you run a harassment investigation.' })
    .waitFor({ timeout: 15000 })
  stage('keyboard pick (1) committed the leader')

  // The way back from a wrong swap: EARLIER rows re-pin that answer. The
  // engine side is covered in tests/engine.test.ts; this is here because the
  // failure mode is a handler that never reaches the real DOM.
  const earlier = page.locator('.live-earlier__row', { hasText: 'employee relations' }).first()
  await earlier.waitFor({ timeout: 20000 })
  await earlier.click()
  await page
    .locator('.live-question', {
      hasText: 'Tell me about a time you handled a difficult employee relations case.'
    })
    .waitFor({ timeout: 10000 })
  stage('EARLIER row resumed the answer, without ⌘K')

  // hand the panel back to where the fixture left it, from the other side
  await page.locator('.live-earlier__row', { hasText: 'harassment investigation' }).first().click()
  await page
    .locator('.live-question', { hasText: 'Walk me through how you run a harassment investigation.' })
    .waitFor({ timeout: 10000 })
  stage('and back again — the history works both ways')

  await page.locator('.find-overlay').waitFor({ timeout: 90000 })
  stage('fixture opened find')
  await page
    .locator('.live-question', { hasText: 'Tell me about rolling out a policy people hated.' })
    .waitFor({ timeout: 15000 })
  stage('find-pin overrode the matcher')

  await page.locator('.strip').waitFor({ timeout: 30000 })
  stage(`collapsed to strip ("${(await page.locator('.strip__text').textContent())?.trim()}")`)
  await page.locator('.live-panel').waitFor({ timeout: 30000 })
  stage('expanded back to the panel')

  await page.getByText('SESSION ENDED', { exact: false }).waitFor({ timeout: 90000 })
  await page.getByText('questions matched to your bank').waitFor()
  stage('recap opened automatically')

  const unmatched = await page.locator('.stat-card--warn .stat-card__num').textContent()
  stage(`unmatched stat card: ${unmatched} (warning variant)`)

  const fixTitles = await page.locator('.recap-fix__title').allTextContents()
  if (fixTitles.length < 2) throw new Error('recap flagged fewer than two fixes')
  stage(`${fixTitles.length} fixes flagged`)

  await page.locator('.recap-row--expandable').first().click()
  await page.locator('.recap-row__tline').first().waitFor()
  stage('row expands to the transcript excerpt')

  await page.getByText('Save to loop').click()
  await page.getByText('Senior People Partner · Meridian Health · Round 2').waitFor()
  stage('save-to-loop returns to setup')

  const lastUsed = await page.evaluate(() => {
    const bank = JSON.parse(localStorage.getItem('lih.bank'))
    return bank.answers.find((x) => x.id === 'a-er-case').lastUsed
  })
  if (!lastUsed) throw new Error('lastUsed was not stamped on the matched entry')
  const sessions = await page.evaluate(
    () => JSON.parse(localStorage.getItem('lih.sessions') ?? '[]').length
  )
  if (sessions !== 1) throw new Error(`expected 1 persisted session, got ${sessions}`)
  stage('lastUsed stamped + session persisted')

  console.log('\nE2E PASS')
} catch (err) {
  console.error(`\nE2E FAIL: ${err.message}`)
  process.exitCode = 1
} finally {
  await browser.close()
  server.kill()
}
