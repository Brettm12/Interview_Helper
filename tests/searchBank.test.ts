import { describe, expect, it } from 'vitest'
import { searchBank } from '@/containers/FindContainer'
import { answersForLoop } from '@/state/bankStore'
import seed from '@shared/seed.json'
import type { Bank } from '@shared/types'

// ⌘K find scoring: fuzzy across question text, key points, and story names.

const bank = seed as unknown as Bank
const entries = answersForLoop(bank, 'loop-meridian')

describe('searchBank', () => {
  it('returns the first results (capped) for an empty query', () => {
    const results = searchBank(bank, entries, '')
    expect(results.length).toBe(Math.min(8, entries.length))
    expect(results[0].id).toBe(entries[0].id)
  })

  it('ranks exact substring hits on the question first', () => {
    const results = searchBank(bank, entries, 'policy')
    const ids = results.map((r) => r.id)
    expect(ids[0]).toBe('a-policy')
    expect(ids).toContain('a-bend')
  })

  it('keeps entries findable while the query is still being typed', () => {
    const ids = searchBank(bank, entries, 'harass').map((r) => r.id)
    expect(ids).toContain('a-invest-run')
    expect(ids).toContain('a-informal')
  })

  it('matches on story titles', () => {
    const ids = searchBank(bank, entries, 'warehouse').map((r) => r.id)
    expect(ids.length).toBeGreaterThan(0)
    expect(ids).toContain('a-er-case')
  })

  it('matches on key-point text', () => {
    // "Publish the exception path — pressure needs a valve" (a-policy point)
    const ids = searchBank(bank, entries, 'exception path').map((r) => r.id)
    expect(ids).toContain('a-policy')
  })

  it('filters noise below the score floor', () => {
    expect(searchBank(bank, entries, 'zzzz qqqq xyzzy')).toHaveLength(0)
  })

  it('caps the result list', () => {
    expect(searchBank(bank, entries, 'the').length).toBeLessThanOrEqual(8)
  })
})

// REVIEW.md P3: ⌘K opened from "Search bank" means the matcher was
// close-but-wrong. Bank order puts the entry you want off the bottom of the
// list, so you type under stress. The empty query is the one place we know
// something useful about intent.
describe('empty-query ordering with session context', () => {
  it('puts the unsure candidates first, in rank order', () => {
    const results = searchBank(bank, entries, '', {
      candidateIds: ['a-informal', 'a-invest-run'],
      askedIds: []
    })
    expect(results.slice(0, 2).map((r) => r.id)).toEqual(['a-informal', 'a-invest-run'])
  })

  it('then the entries this session has not asked yet', () => {
    const asked = entries.slice(0, 3).map((e) => e.id)
    const results = searchBank(bank, entries, '', { candidateIds: [], askedIds: asked })
    const ids = results.map((r) => r.id)
    // nothing already asked appears before something that has not been
    const firstAskedAt = ids.findIndex((id) => asked.includes(id))
    const lastFreshAt = ids.reduce((last, id, i) => (asked.includes(id) ? last : i), -1)
    if (firstAskedAt !== -1) expect(firstAskedAt).toBeGreaterThan(lastFreshAt - 1)
    expect(ids).not.toContain(undefined)
  })

  it('is deterministic and still capped', () => {
    const ctx = { candidateIds: ['a-informal'], askedIds: [entries[0].id] }
    const a = searchBank(bank, entries, '', ctx).map((r) => r.id)
    const b = searchBank(bank, entries, '', ctx).map((r) => r.id)
    expect(a).toEqual(b)
    expect(a.length).toBe(Math.min(8, entries.length))
    expect(new Set(a).size).toBe(a.length)
  })

  it('leaves a typed query alone — context only helps the blank list', () => {
    const withCtx = searchBank(bank, entries, 'policy', {
      candidateIds: ['a-informal'],
      askedIds: []
    }).map((r) => r.id)
    const without = searchBank(bank, entries, 'policy').map((r) => r.id)
    expect(withCtx).toEqual(without)
  })

  it('an unknown candidate id cannot break the list', () => {
    const results = searchBank(bank, entries, '', { candidateIds: ['a-gone'], askedIds: ['a-gone'] })
    expect(results.length).toBe(Math.min(8, entries.length))
    expect(results.map((r) => r.id)).not.toContain('a-gone')
  })
})
