import { app, net } from 'electron'
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { access, mkdir, rename, stat, unlink } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import manifest from '../shared/models.json'
import { DEFAULT_WHISPER_MODEL, FALLBACK_WHISPER_MODEL } from '../shared/models'
import type { ModelProgress, ModelsStatus } from '../shared/ipc'

// On-device model files live in userData/models and are fetched once. A
// packaged user has no npm scripts, so the same manifest that drives
// `npm run fetch-models` also drives the in-app download offered on the
// setup screen — the only moment this app ever touches the network.
//
// Every file in the manifest carries a sha256 + byte size: a captive portal
// answering 200 with an HTML login page used to get renamed into place as a
// model file and pass every later check forever (REVIEW.md H12).

export function modelsDir(): string {
  return join(app.getPath('userData'), 'models')
}

const exists = (p: string): Promise<boolean> =>
  access(p).then(
    () => true,
    () => false
  )

interface ManifestFile {
  path: string
  sha256?: string
  bytes?: number
}

interface ManifestModel {
  id: string
  use: string
  files: ManifestFile[]
}

function models(): ManifestModel[] {
  return manifest.models.map((m) => ({
    id: m.id,
    use: m.use,
    files: (m.files as (string | ManifestFile)[]).map((f) =>
      typeof f === 'string' ? { path: f } : f
    )
  }))
}

/** the renderer supplies the whisper tier — validate it against the manifest
 *  rather than splicing arbitrary strings into filesystem paths (REVIEW.md L1) */
export function validWhisperModel(id: string | undefined): string {
  const known = models().some((m) => m.use === 'transcription' && m.id === id)
  return known && id ? id : DEFAULT_WHISPER_MODEL
}

/** The manifest entries needed for one choice of Whisper build: the selected
 *  transcription model, the tiny fallback (the worker's safety net has to
 *  actually be on disk to exist — REVIEW.md M16), and everything that isn't a
 *  transcription model. */
function required(whisperModel: string): ManifestModel[] {
  return models().filter(
    (m) =>
      m.use !== 'transcription' || m.id === whisperModel || m.id === FALLBACK_WHISPER_MODEL
  )
}

/** every manifest file present with the right size — config.json alone said
 *  "installed" while the 100MB weights were still missing (REVIEW.md H11) */
async function modelComplete(dir: string, m: ManifestModel): Promise<boolean> {
  for (const f of m.files) {
    const p = join(dir, m.id, f.path)
    try {
      const s = await stat(p)
      if (f.bytes != null && s.size !== f.bytes) return false
    } catch {
      return false
    }
  }
  return true
}

export async function modelsStatus(whisperModel?: string): Promise<ModelsStatus> {
  const dir = modelsDir()
  const model = validWhisperModel(whisperModel)
  const byId = new Map(models().map((m) => [m.id, m]))
  const whisperEntry = byId.get(model)
  const embedEntry = byId.get('Xenova/all-MiniLM-L6-v2')
  const whisper = whisperEntry ? await modelComplete(dir, whisperEntry) : false
  const embeddings = embedEntry ? await modelComplete(dir, embedEntry) : false
  return { dir, whisper, embeddings, whisperModel: model }
}

let activeDownload: AbortController | null = null

/** stop an in-flight download; the partial .part files stay for resume */
export function cancelDownload(): void {
  activeDownload?.abort()
}

async function sha256Of(path: string): Promise<string> {
  const hash = createHash('sha256')
  await new Promise<void>((resolve, reject) => {
    const s = createReadStream(path)
    s.on('data', (c) => hash.update(c))
    s.on('end', () => resolve())
    s.on('error', reject)
  })
  return hash.digest('hex')
}

/** integrity check used after download (and unit-tested directly) */
export async function verifyFile(
  path: string,
  expect: { sha256?: string; bytes?: number }
): Promise<{ ok: boolean; reason?: string }> {
  const s = await stat(path).catch(() => null)
  if (!s) return { ok: false, reason: 'missing' }
  if (expect.bytes != null && s.size !== expect.bytes) {
    return { ok: false, reason: `size ${s.size} != ${expect.bytes}` }
  }
  if (expect.sha256) {
    const digest = await sha256Of(path)
    if (digest !== expect.sha256) return { ok: false, reason: 'sha256 mismatch' }
  }
  return { ok: true }
}

/**
 * Download every missing model file, verified. Per-file: stream to a .part
 * (resuming with a Range request when a partial exists), then sha256 + size
 * check, then an atomic rename into place. Goes through Electron's net (the
 * Chromium stack), which honors system/OS proxies — Node's undici fetch did
 * not (REVIEW.md L15).
 */
export async function downloadModels(
  onProgress: (p: ModelProgress) => void,
  whisperModel?: string
): Promise<void> {
  const dir = modelsDir()
  const model = validWhisperModel(whisperModel)
  const jobs = required(model).flatMap((m) => m.files.map((f) => ({ id: m.id, file: f })))
  const abort = new AbortController()
  activeDownload = abort
  let done = 0
  try {
    for (const job of jobs) {
      done++
      const rel = `${job.id}/${job.file.path}`
      onProgress({ done, total: jobs.length, file: rel, loadedBytes: 0, totalBytes: job.file.bytes ?? 0 })
      const dest = join(dir, job.id, job.file.path)
      if (await exists(dest)) {
        const good = await verifyFile(dest, job.file)
        if (good.ok) continue
        // a bad file (interrupted install, portal page) is re-fetched
        await unlink(dest).catch(() => {})
      }
      await mkdir(dirname(dest), { recursive: true })
      const url = `${manifest.host}/${job.id}/resolve/main/${job.file.path}`
      const tmp = `${dest}.part`

      // resume: hash what we already have, then ask for the rest
      let offset = 0
      const partial = await stat(tmp).catch(() => null)
      if (partial && partial.size > 0) offset = partial.size

      const headers: Record<string, string> = {}
      if (offset > 0) headers.Range = `bytes=${offset}-`
      const res = await net.fetch(url, { headers, signal: abort.signal })
      if (res.status === 200 && offset > 0) offset = 0 // server ignored the range
      if (!(res.status === 200 || res.status === 206) || !res.body) {
        throw new Error(`${res.status} ${res.statusText} — ${rel}`)
      }
      const contentLength = Number(res.headers.get('content-length') ?? 0)
      const totalBytes = job.file.bytes ?? (contentLength ? offset + contentLength : 0)

      const out = createWriteStream(tmp, offset > 0 ? { flags: 'a' } : {})
      let loaded = offset
      let lastTick = 0
      const reader = res.body.getReader()
      try {
        for (;;) {
          const { done: eof, value } = await reader.read()
          if (eof) break
          loaded += value.length
          await new Promise<void>((resolve, reject) =>
            out.write(value, (err) => (err ? reject(err) : resolve()))
          )
          const now = Date.now()
          if (now - lastTick > 250) {
            lastTick = now
            onProgress({ done, total: jobs.length, file: rel, loadedBytes: loaded, totalBytes })
          }
        }
        await new Promise<void>((resolve, reject) =>
          out.end((err?: Error | null) => (err ? reject(err) : resolve()))
        )
        const good = await verifyFile(tmp, job.file)
        if (!good.ok) {
          await unlink(tmp).catch(() => {})
          throw new Error(`${rel} failed verification (${good.reason}) — check the connection and retry`)
        }
        await rename(tmp, dest)
        onProgress({ done, total: jobs.length, file: rel, loadedBytes: loaded, totalBytes })
      } catch (err) {
        // keep a cleanly-truncated .part for resume unless it failed checks
        out.destroy()
        throw err
      }
    }
  } catch (err) {
    // one stable message whether the abort landed mid-stream or mid-handshake
    if ((err as Error).name === 'AbortError') throw new Error('download cancelled')
    throw err
  } finally {
    if (activeDownload === abort) activeDownload = null
  }
}
