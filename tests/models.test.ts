import { createHash } from 'node:crypto'
import { mkdtempSync } from 'node:fs'
import { mkdir, open, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_WHISPER_MODEL,
  FALLBACK_WHISPER_MODEL,
  WHISPER_TIERS,
  whisperTier
} from '@shared/models'
import manifest from '@shared/models.json'
import { modelsStatus, validWhisperModel, verifyFile } from '../src/main/models'
import { setUserDataDir } from './helpers/electronStub'

// The tier list and the download manifest have to agree. A tier whose id has
// no manifest entry is a model the app will try to load and can never fetch —
// which reads to the user as "transcription just doesn't work", with nothing
// on screen explaining why.

const transcription = manifest.models.filter((m) => m.use === 'transcription').map((m) => m.id)

describe('whisper tiers', () => {
  it('every offered tier is downloadable', () => {
    for (const tier of WHISPER_TIERS) expect(transcription).toContain(tier.id)
  })

  it('the default and the fallback are both offered tiers', () => {
    const ids = WHISPER_TIERS.map((t) => t.id)
    expect(ids).toContain(DEFAULT_WHISPER_MODEL)
    expect(ids).toContain(FALLBACK_WHISPER_MODEL)
  })

  it('takes its default from the manifest, so the CLI and the app agree', () => {
    expect(DEFAULT_WHISPER_MODEL).toBe(manifest.defaultTranscription)
  })

  it('falls back to something smaller than the default', () => {
    expect(FALLBACK_WHISPER_MODEL).not.toBe(DEFAULT_WHISPER_MODEL)
  })

  it('resolves an unknown id to the default rather than throwing', () => {
    // a settings file from a future version, or a hand-edited one
    expect(whisperTier('Xenova/whisper-does-not-exist').id).toBe(DEFAULT_WHISPER_MODEL)
  })

  it('describes each tier in terms of the trade-off, with a size', () => {
    for (const tier of WHISPER_TIERS) {
      expect(tier.detail).toMatch(/MB/)
      expect(tier.label.length).toBeGreaterThan(0)
    }
  })
})

// A downloaded file is only "installed" once its size AND sha256 match the
// manifest — a captive portal's HTML login page used to get renamed into
// place as a model file and pass every later presence check (REVIEW.md H12).

describe('manifest integrity fields', () => {
  it('every file carries a sha256 and a byte size', () => {
    for (const m of manifest.models) {
      for (const f of m.files) {
        expect(f, `${m.id}/${JSON.stringify(f)}`).toMatchObject({
          path: expect.any(String),
          sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
          bytes: expect.any(Number)
        })
        expect(f.bytes).toBeGreaterThan(0)
      }
    }
  })
})

describe('validWhisperModel (REVIEW.md L1)', () => {
  it('passes a known transcription id through', () => {
    expect(validWhisperModel(FALLBACK_WHISPER_MODEL)).toBe(FALLBACK_WHISPER_MODEL)
  })

  it('rejects unknown ids and path fragments to the default', () => {
    // the renderer supplies this string and it is joined into filesystem paths
    expect(validWhisperModel('Xenova/does-not-exist')).toBe(DEFAULT_WHISPER_MODEL)
    expect(validWhisperModel('../../../etc')).toBe(DEFAULT_WHISPER_MODEL)
    expect(validWhisperModel(undefined)).toBe(DEFAULT_WHISPER_MODEL)
  })

  it('rejects a non-transcription manifest id', () => {
    expect(validWhisperModel('Xenova/all-MiniLM-L6-v2')).toBe(DEFAULT_WHISPER_MODEL)
  })
})

describe('verifyFile (REVIEW.md H12)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lih-verify-'))
  const content = 'model bytes, allegedly'
  const path = join(dir, 'weights.onnx')
  const sha256 = createHash('sha256').update(content).digest('hex')

  it('accepts a file matching both size and hash', async () => {
    await writeFile(path, content)
    expect(await verifyFile(path, { sha256, bytes: content.length })).toEqual({ ok: true })
  })

  it('rejects on size mismatch without hashing', async () => {
    const r = await verifyFile(path, { sha256, bytes: content.length + 1 })
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/size/)
  })

  it('rejects on hash mismatch — the captive-portal case', async () => {
    const r = await verifyFile(path, { sha256: '0'.repeat(64), bytes: content.length })
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/sha256/)
  })

  it('reports a missing file as missing', async () => {
    const r = await verifyFile(join(dir, 'nope'), { bytes: 1 })
    expect(r).toEqual({ ok: false, reason: 'missing' })
  })
})

describe('modelsStatus completeness (REVIEW.md H11)', () => {
  const minilm = manifest.models.find((m) => m.id === 'Xenova/all-MiniLM-L6-v2')!
  let userData: string

  // sparse files at exactly the manifest sizes — presence checks compare
  // size, not content (hashing 100MB on every setup poll would be brutal)
  const layDown = async (files: { path: string; bytes: number }[]): Promise<void> => {
    for (const f of files) {
      const p = join(userData, 'models', minilm.id, f.path)
      await mkdir(dirname(p), { recursive: true })
      const fh = await open(p, 'w')
      await fh.truncate(f.bytes)
      await fh.close()
    }
  }

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'lih-models-'))
    setUserDataDir(userData)
  })

  it('reports nothing installed in an empty dir', async () => {
    const s = await modelsStatus()
    expect(s.whisper).toBe(false)
    expect(s.embeddings).toBe(false)
    expect(s.whisperModel).toBe(DEFAULT_WHISPER_MODEL)
  })

  it('needs EVERY manifest file, not just config.json', async () => {
    // config.json alone said "installed" while the weights were missing
    await layDown(minilm.files.filter((f) => f.path === 'config.json'))
    expect((await modelsStatus()).embeddings).toBe(false)
  })

  it('reports installed when all files exist at the right sizes', async () => {
    await layDown(minilm.files)
    expect((await modelsStatus()).embeddings).toBe(true)
  })

  it('a truncated weight file reads as not installed', async () => {
    await layDown(
      minilm.files.map((f) => (f.path.endsWith('.onnx') ? { ...f, bytes: f.bytes - 1 } : f))
    )
    expect((await modelsStatus()).embeddings).toBe(false)
  })

  it('answers about the requested tier, normalising unknown ids', async () => {
    const s = await modelsStatus('Xenova/whisper-does-not-exist')
    expect(s.whisperModel).toBe(DEFAULT_WHISPER_MODEL)
  })
})
