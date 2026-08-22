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

  // ---- the bank check, reached the way a user reaches it -------------------
  // Prep-time rehearsal of the live decision. In this build there is no
  // embedding worker, so it answers on the lexical path — which is exactly
  // what a mock session matches on, so the two agree.
  await page.locator('.setup-action', { hasText: 'Check bank' }).click()
  await page.locator('.checker').waitFor()
  ok('bank check opens from the setup screen')

  await page
    .locator('.checker__input')
    .fill('Tell me about a time you handled a difficult employee relations case.')
  await page.locator('.checker__cta').click()
  await page.locator('.checker__verdict--good').waitFor()
  const matched = await page.locator('.checker__answer').first().textContent()
  if (!matched?.includes('employee relations')) throw new Error(`named "${matched}"`)
  ok('a question in the bank reads as a match, and names the answer')

  await page.locator('.checker__input').fill('What is your current notice period?')
  await page.locator('.checker__cta').click()
  await page.locator('.checker__verdict--none').waitFor()
  ok('a question the bank cannot answer says so')

  // the way out of a miss is one click, with the question carried over
  await page.locator('.checker__add').click()
  await page.locator('.editor-pane').waitFor()
  const carried = await page.locator('.editor-question').inputValue()
  if (carried !== 'What is your current notice period?') {
    throw new Error(`the editor opened on "${carried}"`)
  }
  ok('“write an answer for it” opens the editor on that question')

  // no numbers anywhere on the surface — a score invites tuning a bank
  // against a threshold, and means nothing without the distribution
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
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

  // ---- removal, in the real DOM --------------------------------------------
  // A two-press confirm that fires on the first press, or a delete that leaves
  // the pane pointing at an id that no longer exists, is the kind of thing
  // only a real click finds.
  const startCount = await page.evaluate(
    () => JSON.parse(localStorage.getItem('lih.bank')).answers.length
  )
  await page.locator('.bank-detail__action', { hasText: 'Edit' }).click()
  await page.locator('.editor-pane').waitFor()
  const doomed = await page.locator('.editor-question').inputValue()

  await page.locator('.editor-delete').click()
  await page.locator('.editor-delete.confirm--armed').waitFor()
  if ((await page.evaluate(() => JSON.parse(localStorage.getItem('lih.bank')).answers.length)) !== startCount) {
    throw new Error('the first press deleted the answer')
  }
  ok('the first press on Delete only arms it')

  await page.locator('.editor-delete').click()
  await page.locator('.editor-pane').waitFor({ state: 'detached' })
  const afterDelete = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('lih.bank')).answers.map((a) => a.question)
  )
  if (afterDelete.length !== startCount - 1) throw new Error('delete did not persist')
  if (afterDelete.includes(doomed)) throw new Error('the wrong answer went')
  ok('the second press deleted it, and it stayed deleted')

  // the pane has to land on a real entry, not an empty detail
  const detailQuestion = await page.locator('.bank-detail__question').textContent()
  if (!detailQuestion || !afterDelete.includes(detailQuestion.trim())) {
    throw new Error(`detail pane is showing "${detailQuestion}" after the delete`)
  }
  ok('the detail pane landed on an answer that still exists')

  // ---- the way out of the starter bank -------------------------------------
  await page.locator('.bank-side__link', { hasText: 'Import from a job post' }).click()
  await page.locator('.importer').waitFor()
  const removeStarters = page.locator('.importer__action', { hasText: 'untouched examples' })
  await removeStarters.waitFor()
  await removeStarters.click()
  await page.locator('.importer__action.confirm--armed').waitFor()
  await page.locator('.importer__action.confirm--armed').click()
  await page.locator('.importer__result').waitFor()
  const left = await page.evaluate(
    () => JSON.parse(localStorage.getItem('lih.bank')).answers.length
  )
  if (left !== 0) throw new Error(`${left} starter answers survived`)
  ok('the starter answers can be removed, and are')

  console.log('\nEDITOR PROBE PASS')
} catch (err) {
  console.error(`\nEDITOR PROBE FAIL: ${err.message}`)
  process.exitCode = 1
} finally {
  await browser.close()
  server.kill()
}
