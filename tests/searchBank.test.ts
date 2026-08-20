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
