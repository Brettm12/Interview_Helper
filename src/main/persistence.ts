import { app } from 'electron'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { ZodType } from 'zod'
import { DEFAULT_WHISPER_MODEL, isOfferedTier } from '../shared/models'
import { TUNING } from '../shared/tuning'
import { BankSchema, SessionRecordSchema, SettingsSchema } from '../shared/schema'
import type { BankLoadResult } from '../shared/ipc'
import type { Bank, SessionRecord, Settings } from '../shared/types'
import seed from '../shared/seed.json'

// Repository over three JSON files in userData, each validated with zod on
// read and written atomically (temp file + fsync + rename) so a crash — or a
// power cut — mid-interview can't corrupt the bank. A `.bak` of the last good
// state is kept per file, refreshed on every successful read AND write
// (REVIEW.md M11: a .bak from app launch excluded the whole evening's edits).
//
// The bank is the user's prep. An unreadable bank.json is NEVER silently
// replaced: the file is quarantined under a timestamped name first, the
// fallback is reported to the renderer, and the original stays on disk for
// hand recovery (REVIEW.md H8 — the old fallback seeded the demo bank and the
// first save destroyed the real one).

const DEFAULT_SETTINGS: Settings = {
  contentProtection: true,
  keepTranscript: false,
  placement: 'docked',
  stripPosition: null,
  micDeviceId: null,
  meetingDeviceId: null,
  whisperModel: DEFAULT_WHISPER_MODEL,
  autoPickSec: TUNING.autoPickSec,
  highLegibility: false
}

function dataPath(name: string): string {
  return join(app.getPath('userData'), name)
}

// ---- per-file write serialisation (REVIEW.md L11) ---------------------------
// saveSession is read-modify-write; two in flight (the 20s snapshot racing the
// final save) could resurrect a stale array. Every mutation of one file runs
// strictly after the previous one.

const queues = new Map<string, Promise<unknown>>()

function serialized<T>(name: string, task: () => Promise<T>): Promise<T> {
  const prev = queues.get(name) ?? Promise.resolve()
  const next = prev.then(task, task)
  queues.set(name, next.catch(() => {})) // the chain survives a failed write
  return next
}

// ---- primitives -------------------------------------------------------------

async function writeAtomic(name: string, value: unknown): Promise<void> {
  const file = dataPath(name)
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`
  await fs.mkdir(app.getPath('userData'), { recursive: true })
  const fh = await fs.open(tmp, 'w')
  try {
    // fsync before rename: rename metadata can commit before the data pages,
    // and a power cut then leaves a valid-looking empty/truncated file
    await fh.writeFile(JSON.stringify(value, null, 2), 'utf8')
    await fh.sync()
  } finally {
    await fh.close()
  }
  await fs.rename(tmp, file)
  // the write just succeeded and validated — it is the new last-known-good
  await fs.copyFile(file, `${file}.bak`).catch(() => {})
}

/** move an unreadable file aside under a timestamped name; never deletes */
async function quarantine(name: string, label = 'corrupt'): Promise<string | undefined> {
  const file = dataPath(name)
  const dest = `${file}.${label}-${new Date().toISOString().replace(/[:.]/g, '-')}`
  try {
    await fs.rename(file, dest)
    return dest
  } catch {
    return undefined
  }
}

/**
 * Settings written by an older build that are no longer offered.
 *
 * Today that is one case: a speech model the setup screen used to let you
 * choose. tiny.en is still valid to RUN — it is the fallback — but it is not
 * something to leave someone sitting on, so a stored choice of it becomes the
 * default. Applied at BOTH read sites: doing it only on load would let the
 * next strip-drag write the stale value straight back.
 */
function migrate(s: Settings): Settings {
  if (!isOfferedTier(s.whisperModel)) return { ...s, whisperModel: DEFAULT_WHISPER_MODEL }
  return s
}

async function readValidated<T>(name: string, schema: ZodType<T>, fallback: T): Promise<T> {
  const file = dataPath(name)
  try {
    const raw = await fs.readFile(file, 'utf8')
    const parsed = schema.parse(JSON.parse(raw))
    await fs.copyFile(file, `${file}.bak`).catch(() => {})
    return parsed
  } catch (err) {
    // corrupt or invalid → try the backup before falling back
    try {
      const raw = await fs.readFile(`${file}.bak`, 'utf8')
      const parsed = schema.parse(JSON.parse(raw))
      console.warn(`[persistence] ${name} was invalid, recovered from .bak`)
      return parsed
    } catch {
      if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') {
        console.warn(`[persistence] ${name} unreadable, using defaults:`, err)
      }
      return fallback
    }
  }
}

export const repository = {
  async loadBank(): Promise<BankLoadResult> {
    const file = dataPath('bank.json')
    let raw: string | null = null
    let missing = false
    try {
      raw = await fs.readFile(file, 'utf8')
    } catch (err) {
      missing = (err as NodeJS.ErrnoException)?.code === 'ENOENT'
    }

    let quarantinedPath: string | undefined
    if (raw != null) {
      try {
        const bank = BankSchema.parse(JSON.parse(raw)) as Bank
        await fs.copyFile(file, `${file}.bak`).catch(() => {})
        return { bank, source: 'file' }
      } catch (err) {
        console.warn('[persistence] bank.json unreadable, quarantining:', err)
        quarantinedPath = await quarantine('bank.json')
      }
    }

    try {
      const bank = BankSchema.parse(JSON.parse(await fs.readFile(`${file}.bak`, 'utf8'))) as Bank
      return { bank, source: 'bak', quarantinedPath }
    } catch {
      // no readable bank anywhere. On a genuine first run that's expected and
      // the seed is the product; after a failed read it's a loud fallback.
      const bank = seed as unknown as Bank
      return missing && !quarantinedPath
        ? { bank, source: 'new' }
        : { bank, source: 'seed', quarantinedPath }
    }
  },
  async saveBank(bank: Bank): Promise<void> {
    // write the parsed value: the version stamp and any passthrough fields
    // from a newer build survive the round-trip (REVIEW.md L18)
    const value = BankSchema.parse(bank)
    await serialized('bank.json', () => writeAtomic('bank.json', value))
  },

  async listSessions(): Promise<SessionRecord[]> {
    const file = dataPath('sessions.json')
    let data: unknown
    try {
      data = JSON.parse(await fs.readFile(file, 'utf8'))
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return []
      // unparseable file: try the backup, then quarantine the original
      await quarantine('sessions.json', 'invalid')
      try {
        data = JSON.parse(await fs.readFile(`${file}.bak`, 'utf8'))
      } catch {
        return []
      }
    }
    if (!Array.isArray(data)) {
      await quarantine('sessions.json', 'invalid')
      return []
    }
    // per-record salvage: one bad record used to reject the whole file, and
    // the next 20s snapshot then persisted the wipe (REVIEW.md M10)
    const good: SessionRecord[] = []
    let dropped = 0
    for (const record of data) {
      const parsed = SessionRecordSchema.safeParse(record)
      if (parsed.success) good.push(parsed.data as SessionRecord)
      else dropped++
    }
    if (dropped > 0) {
      console.warn(`[persistence] sessions.json: kept ${good.length}, dropped ${dropped} invalid`)
      // keep the raw file around before the next save rewrites it without them
      await fs.copyFile(file, `${file}.invalid-${Date.now()}`).catch(() => {})
    }
    return good
  },
  async saveSession(s: SessionRecord): Promise<void> {
    await serialized('sessions.json', async () => {
      const all = await this.listSessions()
      const i = all.findIndex((x) => x.id === s.id)
      if (i >= 0) all[i] = s
      else all.push(s)
      await writeAtomic('sessions.json', all)
    })
  },
  async deleteSession(id: string): Promise<void> {
    await serialized('sessions.json', async () => {
      const all = await this.listSessions()
      await writeAtomic(
        'sessions.json',
        all.filter((s) => s.id !== id)
      )
    })
  },

  async loadSettings(): Promise<Settings> {
    return migrate(
      await readValidated('settings.json', SettingsSchema as ZodType<Settings>, DEFAULT_SETTINGS)
    )
  },
  /** read-merge-write under the file queue: the single write path for every
   *  settings author — renderer stores and main's strip-drag persistence
   *  (REVIEW.md L10) */
  async updateSettings(patch: Partial<Settings>): Promise<Settings> {
    return serialized('settings.json', async () => {
      const current = await readValidated(
        'settings.json',
        SettingsSchema as ZodType<Settings>,
        DEFAULT_SETTINGS
      )
      const merged = migrate(SettingsSchema.parse({ ...current, ...patch }) as Settings)
      await writeAtomic('settings.json', merged)
      return merged
    })
  }
}
