import { mkdtempSync, readdirSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { repository } from '../src/main/persistence'
import { setUserDataDir } from './helpers/electronStub'
import seed from '../src/shared/seed.json'
import type { Bank, SessionRecord } from '../src/shared/types'

// The repository holds the user's prep. These tests pin the failure semantics
// from the review: corruption quarantines instead of silently seeding (H8),
// one bad session record doesn't wipe the rest (M10), every save refreshes
// the backup (M11), concurrent saves serialise (L11), and unknown fields plus
// a version stamp survive the round-trip (L18).

let dir: string

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'lih-persist-'))
  setUserDataDir(dir)
  await mkdir(dir, { recursive: true })
})

const sampleBank = (): Bank => JSON.parse(JSON.stringify(seed)) as Bank

const sampleSession = (id: string, startedAt = 1000): SessionRecord => ({
  id,
  loopId: 'loop-meridian',
  startedAt,
  endedAt: startedAt + 60_000,
  transcriptKept: false,
  questions: []
})

describe('loadBank (REVIEW.md H8)', () => {
  it('first run: seeds with source "new" and quarantines nothing', async () => {
    const res = await repository.loadBank()
    expect(res.source).toBe('new')
    expect(res.quarantinedPath).toBeUndefined()
    expect(res.bank.answers.length).toBeGreaterThan(0)
  })

  it('a normal round-trip reads back as source "file"', async () => {
    await repository.saveBank(sampleBank())
    const res = await repository.loadBank()
    expect(res.source).toBe('file')
    expect(res.bank.answers.map((a) => a.id)).toEqual(sampleBank().answers.map((a) => a.id))
  })

  it('corruption with no backup: quarantines the file, NEVER silently seeds', async () => {
    await writeFile(join(dir, 'bank.json'), '{"answers": [truncated by a crash', 'utf8')
    const res = await repository.loadBank()
    expect(res.source).toBe('seed')
    expect(res.quarantinedPath).toMatch(/bank\.json\.corrupt-/)
    // the original bytes survive for hand recovery…
    const kept = await readFile(res.quarantinedPath!, 'utf8')
    expect(kept).toContain('truncated by a crash')
    // …and the next save cannot destroy them (this was the killer: the first
    // mutation used to overwrite the only copy of the user's prep)
    await repository.saveBank(sampleBank())
    expect(await readFile(res.quarantinedPath!, 'utf8')).toContain('truncated by a crash')
  })

  it('corruption with a valid backup: restores from .bak and says so', async () => {
    const bank = sampleBank()
    bank.activeLoopId = bank.loops[0].id
    await repository.saveBank(bank) // also writes bank.json.bak (M11)
    await writeFile(join(dir, 'bank.json'), 'not json at all', 'utf8')
    const res = await repository.loadBank()
    expect(res.source).toBe('bak')
    expect(res.quarantinedPath).toMatch(/corrupt-/)
    expect(res.bank.answers.length).toBe(bank.answers.length)
  })
})

describe('schema evolution (REVIEW.md L18)', () => {
  it('stamps a version and keeps unknown fields across a save round-trip', async () => {
    const bank = sampleBank() as Bank & { futureField?: string }
    bank.futureField = 'written by version 2'
    await repository.saveBank(bank)
    const raw = JSON.parse(await readFile(join(dir, 'bank.json'), 'utf8'))
    expect(raw.version).toBe(1)
    expect(raw.futureField).toBe('written by version 2')
  })
})

describe('writeAtomic backup refresh (REVIEW.md M11)', () => {
  it('every successful save refreshes .bak to the just-written state', async () => {
    const bank = sampleBank()
    await repository.saveBank(bank)
    bank.activeLoopId = bank.loops[bank.loops.length - 1].id
    await repository.saveBank(bank)
    const bak = JSON.parse(await readFile(join(dir, 'bank.json.bak'), 'utf8'))
    expect(bak.activeLoopId).toBe(bank.activeLoopId)
  })
})

describe('sessions salvage (REVIEW.md M10)', () => {
  it('keeps the valid records when one is corrupt, and keeps the raw file', async () => {
    const good = sampleSession('s-good')
    await writeFile(
      join(dir, 'sessions.json'),
      JSON.stringify([good, { id: 's-bad', startedAt: 'not a number' }]),
      'utf8'
    )
    const list = await repository.listSessions()
    expect(list.map((s) => s.id)).toEqual(['s-good'])
    // the raw file was copied aside before the next save rewrites it
    expect(readdirSync(dir).some((f) => f.startsWith('sessions.json.invalid-'))).toBe(true)
    // the next save persists the salvage plus the new record — not a wipe
    await repository.saveSession(sampleSession('s-new', 2000))
    expect((await repository.listSessions()).map((s) => s.id).sort()).toEqual(['s-good', 's-new'])
  })

  it('an unparseable sessions.json quarantines and yields []', async () => {
    await writeFile(join(dir, 'sessions.json'), '<<<garbage>>>', 'utf8')
    expect(await repository.listSessions()).toEqual([])
    expect(readdirSync(dir).some((f) => f.startsWith('sessions.json.invalid-'))).toBe(true)
  })
})

describe('write serialisation (REVIEW.md L11)', () => {
  it('20 concurrent saveSession calls all land', async () => {
    await Promise.all(
      Array.from({ length: 20 }, (_, i) => repository.saveSession(sampleSession(`s-${i}`, i)))
    )
    const list = await repository.listSessions()
    expect(list).toHaveLength(20)
  })

  it('a snapshot racing the final save cannot resurrect the stale record', async () => {
    const finished = { ...sampleSession('s-race'), transcriptKept: true }
    // both in flight at once: the interim (incomplete) snapshot and the final
    const interim = repository.saveSession({ ...sampleSession('s-race'), incomplete: true })
    const final = repository.saveSession(finished)
    await Promise.all([interim, final])
    const [stored] = await repository.listSessions()
    expect(stored.incomplete).toBeUndefined()
    expect(stored.transcriptKept).toBe(true)
  })
})

describe('settings patch semantics (REVIEW.md L10)', () => {
  it('read-merge-write keeps both writers’ fields', async () => {
    await repository.updateSettings({ placement: 'strip' })
    await repository.updateSettings({ stripPosition: { x: 40, y: 14 } })
    const s = await repository.loadSettings()
    expect(s.placement).toBe('strip')
    expect(s.stripPosition).toEqual({ x: 40, y: 14 })
    expect(s.version).toBe(1)
  })
})
