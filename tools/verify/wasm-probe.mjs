// Offline proof of the on-device pipeline (REVIEW.md C2): launch the BUILT
// app with real drivers (no MOCK_SESSION), a fresh userData primed with real
// model files, and a black-hole proxy so nothing outside the machine is
// reachable — then require both inference workers to come up anyway. The old
// build fetched onnxruntime's .wasm from a CDN at this exact moment, so it
// died right here on any machine without internet.
//
// Needs a models directory in the fetch-models layout:
//   npm run fetch-models -- --dest /some/dir --model Xenova/whisper-tiny.en
//   LIH_MODELS_SRC=/some/dir node tools/verify/wasm-probe.mjs
// MiniLM is required; a whisper-tiny.en alongside it deepens the probe (the
// transcriber warms up with a real decode, proving its wasm too).
import { cpSync, existsSync, mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
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

const modelsSrc = process.env.LIH_MODELS_SRC ?? process.argv[2]
const miniLm = modelsSrc && join(modelsSrc, 'Xenova/all-MiniLM-L6-v2/onnx/model_quantized.onnx')
if (!modelsSrc || !existsSync(miniLm)) {
  console.error('LIH_MODELS_SRC must point at a models dir containing Xenova/all-MiniLM-L6-v2.')
  console.error('  npm run fetch-models -- --dest /some/dir --model Xenova/whisper-tiny.en')
  process.exit(1)
}
const hasWhisper = existsSync(
  join(modelsSrc, 'Xenova/whisper-tiny.en/onnx/encoder_model_quantized.onnx')
)

const mainEntry = join(repoRoot, 'out', 'main', 'index.js')
if (!existsSync(mainEntry)) {
  console.error('out/main/index.js missing — run npm run build first')
  process.exit(1)
}

const userData = mkdtempSync(join(tmpdir(), 'lih-wasm-'))
cpSync(modelsSrc, join(userData, 'models'), { recursive: true })

const stage = (name) => console.log(`  ${name}`)
const { _electron } = await import('playwright')

// --proxy-server at a dead port = simulated offline for every real host;
// the lih-models:// scheme is served by main's protocol handler and file
// reads never touch a proxy, so ONLY bundled/local resources can load
const app = await _electron.launch({
  args: ['--no-sandbox', '--proxy-server=127.0.0.1:1', mainEntry],
  env: { ...process.env, LIH_USER_DATA: userData },
  cwd: repoRoot
})

try {
  // count (and cancel) any attempt to reach the CDN the old build depended on
  await app.evaluate(({ session }) => {
    globalThis.__cdnHits = 0
    session.defaultSession.webRequest.onBeforeRequest(
      { urls: ['*://*.jsdelivr.net/*', '*://*.huggingface.co/*'] },
      (_details, callback) => {
        globalThis.__cdnHits++
        callback({ cancel: true })
      }
    )
  })
  stage('offline: dead proxy + CDN requests cancelled and counted')

  const page = await app.firstWindow()
  await page.locator('.setup-cta').waitFor({ timeout: 30000 })
  stage('setup rendered with real drivers')

  const poll = async (label, fn, want, timeoutMs) => {
    const deadline = Date.now() + timeoutMs
    for (;;) {
      const got = await fn()
      if (got === want) return
      if (Date.now() > deadline) throw new Error(`${label}: still "${got}" after ${timeoutMs}ms`)
      await new Promise((r) => setTimeout(r, 500))
    }
  }

  await poll(
    'embeddings worker',
    () => page.evaluate(() => window.__lihDebug?.embeddingsReady() ?? false),
    true,
    90000
  )
  stage('MiniLM pipeline is up on the bundled wasm')

  const dims = await page.evaluate(() => window.__lihDebug.embedSmoke())
  if (dims !== 384) throw new Error(`embedSmoke returned ${dims}, expected 384`)
  stage('real embedding produced offline (384 dims)')

  if (hasWhisper) {
    // fresh settings ask for the default (base.en) tier, which is NOT in this
    // userData — the worker must fall back to tiny.en (REVIEW.md M16) and its
    // warm-up decode proves the transcriber's wasm end to end
    await poll(
      'transcriber worker',
      () => page.evaluate(() => window.__lihDebug?.transcriberState() ?? 'idle'),
      'warm',
      120000
    )
    stage('whisper warm via the tiny.en fallback (real decode ran)')
  } else {
    stage('whisper skipped (no tiny.en next to MiniLM)')
  }

  const cdnHits = await app.evaluate(() => globalThis.__cdnHits)
  if (cdnHits !== 0) throw new Error(`${cdnHits} request(s) tried to reach the CDN`)
  stage('zero CDN requests')

  console.log('\nWASM PROBE PASS')
} catch (err) {
  console.error(`\nWASM PROBE FAIL: ${err.message}`)
  process.exitCode = 1
} finally {
  await app.close().catch(() => {})
}
