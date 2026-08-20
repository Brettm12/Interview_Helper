#!/usr/bin/env node
// One-shot model fetch — the only step that ever needs the network. Downloads
// the Whisper + MiniLM files into the app's userData/models directory so the
// app itself stays fully offline. The packaged app can do this from its setup
// screen instead; this script is for running from a source checkout.
//   npm run fetch-models [-- --dest /path/to/models]
import { createWriteStream, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { rename, unlink } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

const here = dirname(fileURLToPath(import.meta.url))
const manifest = JSON.parse(readFileSync(join(here, '..', 'src', 'shared', 'models.json'), 'utf8'))

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

// Only the Whisper tier actually in use, matching what the in-app downloader
// fetches — nobody should pull 145MB of a model they never select. `--all`
// gets every tier, and `--model <id>` picks one.
const modelFlag = process.argv.indexOf('--model')
const WHISPER = modelFlag >= 0 ? process.argv[modelFlag + 1] : manifest.defaultTranscription
const ALL = process.argv.includes('--all')
const wanted = manifest.models.filter(
  (m) => ALL || m.use !== 'transcription' || m.id === WHISPER
)
if (wanted.length === manifest.models.filter((m) => m.use !== 'transcription').length) {
  console.error(`No transcription model matches "${WHISPER}". Known ids:`)
  for (const m of manifest.models.filter((x) => x.use === 'transcription')) console.error(`  ${m.id}`)
  process.exit(1)
}

async function fetchFile(model, file) {
  const dest = join(DEST, model, file)
  if (existsSync(dest)) {
    console.log(`  ✓ ${model}/${file} (already present)`)
    return
  }
  mkdirSync(dirname(dest), { recursive: true })
  const url = `${manifest.host}/${model}/resolve/main/${file}`
  const res = await fetch(url)
  if (!res.ok || !res.body) throw new Error(`${res.status} ${res.statusText} — ${url}`)
  const tmp = `${dest}.part`
  try {
    await pipeline(Readable.fromWeb(res.body), createWriteStream(tmp))
    await rename(tmp, dest)
  } catch (err) {
    await unlink(tmp).catch(() => {})
    throw err
  }
  console.log(`  ↓ ${model}/${file}`)
}

console.log(`Fetching on-device models into ${DEST}\n`)
try {
  for (const model of wanted) {
    console.log(`${model.id}  (${model.use})`)
    for (const file of model.files) await fetchFile(model.id, file)
  }
  console.log('\nDone. The app never needs the network again.')
} catch (err) {
  console.error(`\nFailed: ${err.message}`)
  console.error('Re-run to resume — files already downloaded are kept.')
  process.exit(1)
}
