#!/usr/bin/env node
// One-shot model fetch — the only step that ever needs the network. Downloads
// the Whisper + MiniLM files into the app's userData/models directory so the
// app itself stays fully offline. The packaged app can do this from its setup
// screen instead; this script is for running from a source checkout.
//   npm run fetch-models [-- --dest /path/to/models]
// Every file is verified against the sha256 + size in src/shared/models.json
// before it is renamed into place, and interrupted downloads resume with a
// Range request (REVIEW.md H12/M17).
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { rename, unlink } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

const here = dirname(fileURLToPath(import.meta.url))
const manifest = JSON.parse(readFileSync(join(here, '..', 'src', 'shared', 'models.json'), 'utf8'))

// Node's fetch (undici) ignores HTTPS_PROXY by default — honor it when set,
// via undici's env proxy agent when available (REVIEW.md L15)
if (process.env.HTTPS_PROXY || process.env.https_proxy) {
  try {
    const { setGlobalDispatcher, EnvHttpProxyAgent } = await import('undici')
    setGlobalDispatcher(new EnvHttpProxyAgent())
  } catch {
    console.warn('HTTPS_PROXY is set but the undici proxy agent is unavailable — trying direct.')
  }
}

// must match Electron's app.getPath('userData'), which uses productName
const APP_NAME = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8')).productName

function defaultDest() {
  if (process.platform === 'darwin')
    return join(homedir(), 'Library', 'Application Support', APP_NAME, 'models')
  if (process.platform === 'win32')
    return join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), APP_NAME, 'models')
  return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), APP_NAME, 'models')
}

const destFlag = process.argv.indexOf('--dest')
const DEST = destFlag >= 0 ? process.argv[destFlag + 1] : defaultDest()

// The selected Whisper tier, the tiny fallback (the worker's safety net must
// actually exist on disk — REVIEW.md M16), and everything that isn't a
// transcription model. `--all` gets every tier, `--model <id>` picks one.
const modelFlag = process.argv.indexOf('--model')
const WHISPER = modelFlag >= 0 ? process.argv[modelFlag + 1] : manifest.defaultTranscription
const FALLBACK = 'Xenova/whisper-tiny.en'
const ALL = process.argv.includes('--all')
const wanted = manifest.models.filter(
  (m) => ALL || m.use !== 'transcription' || m.id === WHISPER || m.id === FALLBACK
)
if (!manifest.models.some((m) => m.use === 'transcription' && m.id === WHISPER)) {
  console.error(`No transcription model matches "${WHISPER}". Known ids:`)
  for (const m of manifest.models.filter((x) => x.use === 'transcription')) console.error(`  ${m.id}`)
  process.exit(1)
}

function sha256Of(path) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const s = createReadStream(path)
    s.on('data', (c) => hash.update(c))
    s.on('end', () => resolve(hash.digest('hex')))
    s.on('error', reject)
  })
}

async function verified(path, file) {
  if (!existsSync(path)) return false
  const size = statSync(path).size
  if (file.bytes != null && size !== file.bytes) return false
  if (file.sha256 && (await sha256Of(path)) !== file.sha256) return false
  return true
}

async function fetchFile(model, file) {
  const dest = join(DEST, model, file.path)
  if (await verified(dest, file)) {
    console.log(`  ✓ ${model}/${file.path} (already present)`)
    return
  }
  if (existsSync(dest)) {
    console.log(`  ✗ ${model}/${file.path} failed verification — re-downloading`)
    await unlink(dest)
  }
  mkdirSync(dirname(dest), { recursive: true })
  const url = `${manifest.host}/${model}/resolve/main/${file.path}`
  const tmp = `${dest}.part`
  let offset = existsSync(tmp) ? statSync(tmp).size : 0
  const headers = offset > 0 ? { Range: `bytes=${offset}-` } : {}
  const res = await fetch(url, { headers })
  if (res.status === 200 && offset > 0) offset = 0 // server ignored the range
  if (!(res.status === 200 || res.status === 206) || !res.body) {
    throw new Error(`${res.status} ${res.statusText} — ${url}`)
  }
  const out = createWriteStream(tmp, offset > 0 ? { flags: 'a' } : {})
  const reader = res.body.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    await new Promise((resolve, reject) => out.write(value, (e) => (e ? reject(e) : resolve())))
  }
  await new Promise((resolve, reject) => out.end((e) => (e ? reject(e) : resolve())))
  if (!(await verified(tmp, file))) {
    await unlink(tmp).catch(() => {})
    throw new Error(`${model}/${file.path} failed sha256/size verification — retry on a clean connection`)
  }
  await rename(tmp, dest)
  console.log(`  ↓ ${model}/${file.path}`)
}

console.log(`Fetching on-device models into ${DEST}\n`)
try {
  for (const model of wanted) {
    console.log(`${model.id}  (${model.use})`)
    for (const file of model.files) await fetchFile(model.id, file)
  }
  console.log('\nDone, all files verified. The app never needs the network again.')
} catch (err) {
  console.error(`\nFailed: ${err.message}`)
  console.error('Re-run to resume — verified files are kept, partial files continue where they stopped.')
  process.exit(1)
}
