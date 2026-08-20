import { app } from 'electron'
import { createWriteStream } from 'node:fs'
import { access, mkdir, rename, unlink } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import manifest from '../shared/models.json'
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

export async function modelsStatus(): Promise<ModelsStatus> {
  const dir = modelsDir()
  const present = await Promise.all(
    manifest.models.map((m) => exists(join(dir, m.id, 'config.json')))
  )
  return {
    dir,
    whisper: present[0] ?? false,
    embeddings: present[1] ?? false
  }
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
export async function downloadModels(onProgress: (p: ModelProgress) => void): Promise<void> {
  const dir = modelsDir()
  const jobs = manifest.models.flatMap((m) => m.files.map((f) => ({ id: m.id, file: f })))
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
