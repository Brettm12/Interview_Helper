import { app } from 'electron'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { ZodType } from 'zod'
import { BankSchema, SessionsFileSchema, SettingsSchema } from '../shared/schema'
import type { Bank, SessionRecord, Settings } from '../shared/types'
import seed from '../shared/seed.json'

// Repository over three JSON files in userData, each validated with zod on
// read and written atomically (temp file + rename) so a crash mid-interview
// can't corrupt the bank. A `.bak` of the last good read is kept per file.
// Deleting bank.json loses the bank and nothing else.

const DEFAULT_SETTINGS: Settings = {
  contentProtection: true,
  keepTranscript: false,
  placement: 'docked',
  stripPosition: null
}

function dataPath(name: string): string {
  return join(app.getPath('userData'), name)
}

async function readValidated<T>(name: string, schema: ZodType<T>, fallback: T): Promise<T> {
  const file = dataPath(name)
  try {
    const raw = await fs.readFile(file, 'utf8')
    const parsed = schema.parse(JSON.parse(raw))
    // last good read becomes the backup
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

async function writeAtomic(name: string, value: unknown): Promise<void> {
  const file = dataPath(name)
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`
  await fs.mkdir(app.getPath('userData'), { recursive: true })
  await fs.writeFile(tmp, JSON.stringify(value, null, 2), 'utf8')
  await fs.rename(tmp, file)
}

export const repository = {
  async loadBank(): Promise<Bank> {
    return readValidated('bank.json', BankSchema as ZodType<Bank>, seed as unknown as Bank)
  },
  async saveBank(bank: Bank): Promise<void> {
    BankSchema.parse(bank)
    await writeAtomic('bank.json', bank)
  },

  async listSessions(): Promise<SessionRecord[]> {
    return readValidated('sessions.json', SessionsFileSchema as ZodType<SessionRecord[]>, [])
  },
  async saveSession(s: SessionRecord): Promise<void> {
    const all = await this.listSessions()
    const i = all.findIndex((x) => x.id === s.id)
    if (i >= 0) all[i] = s
    else all.push(s)
    await writeAtomic('sessions.json', all)
  },
  async deleteSession(id: string): Promise<void> {
    const all = await this.listSessions()
    await writeAtomic(
      'sessions.json',
      all.filter((s) => s.id !== id)
    )
  },

  async loadSettings(): Promise<Settings> {
    return readValidated('settings.json', SettingsSchema as ZodType<Settings>, DEFAULT_SETTINGS)
  },
  async saveSettings(s: Settings): Promise<void> {
    SettingsSchema.parse(s)
    await writeAtomic('settings.json', s)
  }
}
