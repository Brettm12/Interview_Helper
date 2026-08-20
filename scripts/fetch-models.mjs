#!/usr/bin/env node
// One-shot model fetch — the only step that ever needs the network. Downloads
// the Whisper + MiniLM model files into the app's userData/models directory so
// the app itself can stay fully offline. Usage:
//   npm run fetch-models [-- --dest /path/to/models]
import { createWriteStream, existsSync, mkdirSync } from 'node:fs'
import { rename, unlink } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

// matches Electron's app.getPath('userData') for package.json name
// "live-interview-helper" (no productName set)
const APP_NAME = 'live-interview-helper'

function defaultDest() {
  if (process.platform === 'darwin')
    return join(homedir(), 'Library', 'Application Support', APP_NAME, 'models')
  if (process.platform === 'win32')
    return join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), APP_NAME, 'models')
  return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), APP_NAME, 'models')
}

const destFlag = process.argv.indexOf('--dest')
const DEST = destFlag >= 0 ? process.argv[destFlag + 1] : defaultDest()

const MODELS = {
  'Xenova/whisper-tiny.en': [
    'config.json',
    'generation_config.json',
    'preprocessor_config.json',
    'tokenizer.json',
    'tokenizer_config.json',
    'onnx/encoder_model_quantized.onnx',
    'onnx/decoder_model_merged_quantized.onnx'
  ],
  'Xenova/all-MiniLM-L6-v2': [
    'config.json',
    'tokenizer.json',
    'tokenizer_config.json',
    'onnx/model_quantized.onnx'
  ]
}

async function fetchFile(model, file) {
  const dest = join(DEST, model, file)
  if (existsSync(dest)) {
    console.log(`  ✓ ${model}/${file} (already present)`)
    return
  }
  mkdirSync(dirname(dest), { recursive: true })
  const url = `https://huggingface.co/${model}/resolve/main/${file}`
  const res = await fetch(url)
  if (!res.ok || !res.body) throw new Error(`${res.status} ${res.statusText} — ${url}`)
  const tmp = `${dest}.part`
  await pipeline(Readable.fromWeb(res.body), createWriteStream(tmp))
  await rename(tmp, dest).catch(async (err) => {
    await unlink(tmp).catch(() => {})
    throw err
  })
  console.log(`  ↓ ${model}/${file}`)
}

console.log(`Fetching on-device models into ${DEST}\n`)
try {
  for (const [model, files] of Object.entries(MODELS)) {
    console.log(model)
    for (const file of files) await fetchFile(model, file)
  }
  console.log('\nDone. The app never needs the network again.')
} catch (err) {
  console.error(`\nFailed: ${err.message}`)
  console.error('Re-run to resume — files already downloaded are kept.')
  process.exit(1)
}
