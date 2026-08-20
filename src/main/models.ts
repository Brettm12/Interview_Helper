import { app } from 'electron'
import { createWriteStream } from 'node:fs'
import { access, mkdir, rename, unlink } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import manifest from '../shared/models.json'
import { DEFAULT_WHISPER_MODEL } from '../shared/models'
import type { ModelsStatus } from '../shared/ipc'

// On-device model files live in userData/models and are fetched once. A
// packaged user has no npm scripts, so the same manifest that drives
// `npm run fetch-models` also drives the in-app download offered on the
// setup screen — the only moment this app ever touches the network.

export function modelsDir(): string {
  return join(app.getPath('userData'), 'models')
}

const exists = (p: string): Promise<boolean> =>
  access(p).then(
    () => true,
    () => false
  )

/** the manifest entries needed for one choice of Whisper build: the selected
 *  transcription model plus everything that isn't a transcription model. The
 *  other Whisper tiers are only fetched if you switch to them — nobody should
 *  download 145MB they never use. */
function required(whisperModel: string): typeof manifest.models {
  return manifest.models.filter((m) => m.use !== 'transcription' || m.id === whisperModel)
}

export async function modelsStatus(whisperModel = DEFAULT_WHISPER_MODEL): Promise<ModelsStatus> {
  const dir = modelsDir()
  const whisper = await exists(join(dir, whisperModel, 'config.json'))
  const embeddings = await exists(join(dir, 'Xenova/all-MiniLM-L6-v2', 'config.json'))
  return { dir, whisper, embeddings, whisperModel }
}

export interface ModelProgress {
  /** 1-based index of the file being fetched */
  done: number
  total: number
  /** "Xenova/whisper-tiny.en/config.json" */
  file: string
}

/** Download every missing model file. Resumable: anything already on disk is
 *  skipped, and partial writes go to a .part file that is renamed on success. */
export async function downloadModels(
  onProgress: (p: ModelProgress) => void,
  whisperModel = DEFAULT_WHISPER_MODEL
): Promise<void> {
  const dir = modelsDir()
  const jobs = required(whisperModel).flatMap((m) => m.files.map((f) => ({ id: m.id, file: f })))
  let done = 0
  for (const job of jobs) {
    done++
    const rel = `${job.id}/${job.file}`
    onProgress({ done, total: jobs.length, file: rel })
    const dest = join(dir, job.id, job.file)
    if (await exists(dest)) continue
    await mkdir(dirname(dest), { recursive: true })
    const url = `${manifest.host}/${job.id}/resolve/main/${job.file}`
    const res = await fetch(url)
    if (!res.ok || !res.body) throw new Error(`${res.status} ${res.statusText} — ${rel}`)
    const tmp = `${dest}.part`
    try {
      await pipeline(Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]), createWriteStream(tmp))
      await rename(tmp, dest)
    } catch (err) {
      await unlink(tmp).catch(() => {})
      throw err
    }
  }
}
