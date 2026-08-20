// Pixel verification: screenshot each app gallery screen and its
// reference-harness counterpart, diff them, and gate the pinned screens.
// Requires a fresh `npm run build:web` (the npm script does it).
// Usage: node tools/verify/compare.mjs [name ...]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PNG } from 'pngjs'
import pixelmatch from 'pixelmatch'
import { launchBrowser, outDir, repoRoot, serveStatic, spawnServer } from './lib.mjs'

const APP_PORT = 4173
const REF_PORT = 4188
const APP = `http://127.0.0.1:${APP_PORT}`
const REF = `http://127.0.0.1:${REF_PORT}`

// screens gated at ≤ MAX_DIFF_PCT; the rest report only (setup carries the
// specified transcript-toggle addition; editor differs by the mock's fake
// caret; the 2c variant cards are dv-chrome-narrowed)
const GATED = ['live', 'unsure', 'find', 'bank', 'armed', 'strip']
const MAX_DIFF_PCT = 0.1

const PAIRS = [
  { name: 'live', app: `${APP}/?screen=live`, ref: `${REF}/ref/2a-live.html`, refSel: '[id="2a"] .dv-card', appSel: '.gallery-frame' },
  { name: 'unsure', app: `${APP}/?screen=unsure`, ref: `${REF}/ref/1a-live-and-unsure.html`, refSel: '[id="1a"] .dv-row > div:nth-child(2) .dv-card', appSel: '.gallery-frame' },
  { name: 'find', app: `${APP}/?screen=find`, ref: `${REF}/ref/2b-find.html`, refSel: '[id="2b"] .dv-card', appSel: '.gallery-frame' },
  { name: 'strip', app: `${APP}/?screen=strip`, ref: `${REF}/ref/2c-strip.html`, refSel: '[id="2c"] .dv-card', appSel: '.gallery-share', refNth: 0 },
  { name: 'strip-queued', app: `${APP}/?screen=strip-queued`, ref: `${REF}/ref/2c-strip.html`, refSel: '[id="2c"] .dv-card', appSel: '.strip', refNth: 1 },
  { name: 'strip-new', app: `${APP}/?screen=strip-new`, ref: `${REF}/ref/2c-strip.html`, refSel: '[id="2c"] .dv-card', appSel: '.strip', refNth: 2 },
  { name: 'bank', app: `${APP}/?screen=bank`, ref: `${REF}/ref/3a-bank.html`, refSel: '[id="3a"] .dv-card', appSel: '.gallery-frame' },
  { name: 'editor', app: `${APP}/?screen=editor`, ref: `${REF}/ref/3b-editor.html`, refSel: '[id="3b"] .dv-card', appSel: '.gallery-frame' },
  { name: 'setup', app: `${APP}/?screen=setup`, ref: `${REF}/ref/4a-setup.html`, refSel: '[id="4a"] .dv-card', appSel: '.gallery-frame' },
  { name: 'armed', app: `${APP}/?screen=armed`, ref: `${REF}/ref/4b-armed.html`, refSel: '[id="4b"] .dv-card', appSel: '.gallery-frame' }
]

// ---- reference harness pages: dv chrome neutralized, fonts aliased to the
// app's bundled files so both sides rasterize identical glyphs ----

const FONT_BASE = '/node_modules/@fontsource'
const HARNESS_HEAD = `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face { font-family: 'Instrument Serif'; src: url('${FONT_BASE}/instrument-serif/files/instrument-serif-latin-400-normal.woff2') format('woff2'); font-weight: 400; font-style: normal; }
@font-face { font-family: 'Instrument Serif'; src: url('${FONT_BASE}/instrument-serif/files/instrument-serif-latin-400-italic.woff2') format('woff2'); font-weight: 400; font-style: italic; }
@font-face { font-family: 'JetBrains Mono'; src: url('${FONT_BASE}/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff2') format('woff2'); font-weight: 400; }
@font-face { font-family: 'JetBrains Mono'; src: url('${FONT_BASE}/jetbrains-mono/files/jetbrains-mono-latin-500-normal.woff2') format('woff2'); font-weight: 500; }
@font-face { font-family: 'JetBrains Mono'; src: url('${FONT_BASE}/jetbrains-mono/files/jetbrains-mono-latin-700-normal.woff2') format('woff2'); font-weight: 700; }
body{margin:0;background:#0e0f11;padding:20px;-webkit-font-smoothing:antialiased}
.dv-card{box-sizing:border-box;background:#fff;border:1px solid rgba(0,0,0,.09);border-radius:10px;overflow:hidden}
.dv-olabel,.dv-sub{display:none}
.dv-opt{display:flex;flex-direction:column;gap:10px}
.dv-row{display:flex;gap:18px;align-items:flex-start}
/* the mock's inline styles say ui-monospace; the app bundles JetBrains Mono */
[style*="ui-monospace"]{font-family:'JetBrains Mono',ui-monospace,Menlo,monospace !important}
</style></head><body>`

function buildHarness() {
  const refDir = join(repoRoot, 'docs', 'reference')
  mkdirSync(join(outDir, 'ref'), { recursive: true })
  for (const f of [
    '1a-live-and-unsure.html',
    '2a-live.html',
    '2b-find.html',
    '2c-strip.html',
    '3a-bank.html',
    '3b-editor.html',
    '4a-setup.html',
    '4b-armed.html'
  ]) {
    const frag = readFileSync(join(refDir, f), 'utf8')
    writeFileSync(join(outDir, 'ref', f), `${HARNESS_HEAD}\n${frag}\n</body></html>`)
  }
}

function pad(png, w, h) {
  if (png.width === w && png.height === h) return png
  const out = new PNG({ width: w, height: h })
  for (let i = 0; i < out.data.length; i += 4) {
    out.data[i] = 14
    out.data[i + 1] = 15
    out.data[i + 2] = 17
    out.data[i + 3] = 255
  }
  PNG.bitblt(png, out, 0, 0, png.width, png.height, 0, 0)
  return out
}

const only = process.argv.slice(2)
const pairs = only.length ? PAIRS.filter((p) => only.includes(p.name)) : PAIRS

buildHarness()
mkdirSync(join(outDir, 'shots'), { recursive: true })
// the ref server also serves /node_modules fonts; the app server serves dist-web
const refServer = await serveStatic(repoRoot, REF_PORT)
const appServer = await spawnServer(
  'npx',
  ['vite', 'preview', '--config', 'web.vite.config.ts', '--port', String(APP_PORT), '--strictPort'],
  APP_PORT
)
// the harness pages live under tools/verify/.out/ref but are addressed as /ref
const refBase = `${REF}/tools/verify/.out`

const browser = await launchBrowser()
const page = await browser.newPage({ viewport: { width: 1560, height: 960 }, deviceScaleFactor: 1 })

let failed = false
const summary = []
try {
  for (const p of pairs) {
    await page.goto(p.app, { waitUntil: 'networkidle' })
    await page.waitForTimeout(400)
    const appShot = await page.locator(p.appSel).first().screenshot()

    await page.goto(p.ref.replace(REF, refBase), { waitUntil: 'networkidle' })
    await page.waitForTimeout(400)
    const refShot = await page.locator(p.refSel).nth(p.refNth ?? 0).screenshot()

    const a = PNG.sync.read(appShot)
    const r = PNG.sync.read(refShot)
    const w = Math.max(a.width, r.width)
    const h = Math.max(a.height, r.height)
    const ap = pad(a, w, h)
    const rp = pad(r, w, h)
    const diff = new PNG({ width: w, height: h })
    const bad = pixelmatch(ap.data, rp.data, diff.data, w, h, { threshold: 0.12 })
    writeFileSync(join(outDir, 'shots', `${p.name}-app.png`), PNG.sync.write(ap))
    writeFileSync(join(outDir, 'shots', `${p.name}-ref.png`), PNG.sync.write(rp))
    writeFileSync(join(outDir, 'shots', `${p.name}-diff.png`), PNG.sync.write(diff))
    const pct = (bad / (w * h)) * 100
    const gated = GATED.includes(p.name)
    const ok = !gated || (pct <= MAX_DIFF_PCT && a.width === r.width && a.height === r.height)
    if (!ok) failed = true
    summary.push({ name: p.name, app: `${a.width}x${a.height}`, ref: `${r.width}x${r.height}`, diffPct: Number(pct.toFixed(2)), gated, ok })
    console.log(
      `${ok ? '✓' : '✗'} ${p.name}: app ${a.width}x${a.height} ref ${r.width}x${r.height} diff ${pct.toFixed(2)}%${gated ? '' : ' (report only)'}`
    )
  }
} finally {
  writeFileSync(join(outDir, 'shots', 'summary.json'), JSON.stringify(summary, null, 2))
  await browser.close()
  appServer.kill()
  refServer.close()
}

if (failed) {
  console.error(`\nPixel gate failed — inspect tools/verify/.out/shots/*-diff.png`)
  process.exit(1)
}
console.log('\nPixel verification passed.')
