// The entry editor's keyboard (REVIEW.md P6), against the real web build:
// ⌘↵ saves, Esc on a dirty draft asks before discarding, ⌥↓ reorders the
// focused point.
//
// Worth its own probe because the failure mode is silent data loss: a wrong
// `dirty` prop, or a handler bound where the keystroke never reaches it, and
// Esc quietly throws away an evening's edit. Both of those were real — the
// first version of this feature bound the handler to the pane div, which
// never has focus when the editor opens.
import { launchBrowser, spawnServer } from './lib.mjs'

const PORT = 5201
const server = await spawnServer(
  'npx',
  ['vite', '--config', 'web.vite.config.ts', '--mode', 'mock', '--port', String(PORT), '--strictPort'],
  PORT
)
const browser = await launchBrowser()
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
page.setDefaultTimeout(20000)
const ok = (m) => console.log(`  ✓ ${m}`)

try {
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' })
  await page.evaluate(() => localStorage.clear())
  await page.reload({ waitUntil: 'networkidle' })

  await page.getByText('Edit bank').click()
  await page.locator('.bank').waitFor()
  await page.locator('.bank-detail__action', { hasText: 'Edit' }).click()
  await page.locator('.editor-pane').waitFor()
  ok('editor open')

  // clean draft: Esc closes immediately, nothing to lose
  await page.keyboard.press('Escape')
  await page.locator('.editor-pane').waitFor({ state: 'detached' })
  ok('Esc on a clean draft cancels straight away')

  // dirty draft: first Esc asks, second discards
  await page.locator('.bank-detail__action', { hasText: 'Edit' }).click()
  const q = page.locator('.editor-question')
  const before = await q.inputValue()
  await q.click()
  await page.keyboard.type(' EDITED')
  await page.keyboard.press('Escape')
  await page.locator('.editor-cancel--armed').waitFor()
  if (await page.locator('.editor-pane').count() !== 1) throw new Error('first Esc closed a dirty draft')
  ok('first Esc on unsaved work asks instead of discarding')
  await page.keyboard.press('Escape')
  await page.locator('.editor-pane').waitFor({ state: 'detached' })
  ok('second Esc discards')

  // and the edit really was discarded
  await page.locator('.bank-detail__action', { hasText: 'Edit' }).click()
  if ((await page.locator('.editor-question').inputValue()) !== before) {
    throw new Error('discarded edit survived')
  }
  ok('the discarded edit did not persist')

  // ⌥↓ reorders the focused point, ⌘↵ saves
  const firstPoint = await page.locator('.editor-point__input').first().inputValue()
  await page.locator('.editor-point__input').first().click()
  await page.keyboard.press('Alt+ArrowDown')
  const nowSecond = await page.locator('.editor-point__input').nth(1).inputValue()
  if (nowSecond !== firstPoint) throw new Error(`⌥↓ did not move the point (row 2 is "${nowSecond}")`)
  ok('⌥↓ moved the focused point down')

  await page.keyboard.press('Control+Enter')
  await page.locator('.editor-pane').waitFor({ state: 'detached' })
  ok('⌘↵ saved and closed the editor')

  const saved = await page.evaluate(() => {
    const bank = JSON.parse(localStorage.getItem('lih.bank'))
    return bank.answers[0].points[1].text
  })
  if (saved !== firstPoint) throw new Error(`reorder was not saved (got "${saved}")`)
  ok('the reorder landed in the saved bank')

  console.log('\nEDITOR PROBE PASS')
} catch (err) {
  console.error(`\nEDITOR PROBE FAIL: ${err.message}`)
  process.exitCode = 1
} finally {
  await browser.close()
  server.kill()
}
