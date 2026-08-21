import { describe, expect, it } from 'vitest'
import { entriesToAnswers, findDuplicate, parseBankText, serializeBank } from '@/lib/bankIO'
import seed from '@shared/seed.json'
import type { Bank } from '@shared/types'

const bank = seed as unknown as Bank

// Someone pastes an evening of prep in here the night before an interview.
// Mangling it silently is worse than refusing it, so the preview has to be
// accurate and the parser has to cope with notes as people actually write them.

describe('parsing prep notes', () => {
  it('reads headings, bullets, triggers and a story', () => {
    const preview = parseBankText(`
# Northwind prep

## Behavioural
### Tell me about a time you disagreed with your manager.
- Frame it as a data disagreement, not a personality one
- I brought a two-week test instead of an argument
> triggers: disagreed with your manager, pushed back on your boss
> story: Checkout redesign

### Why this team?
- The problem is the one I want to spend three years on
`)
    expect(preview.format).toBe('notes')
    expect(preview.entries).toHaveLength(2)
    const [first, second] = preview.entries
    expect(first.question).toBe('Tell me about a time you disagreed with your manager.')
    expect(first.points).toHaveLength(2)
    expect(first.triggerPhrases).toEqual([
      'disagreed with your manager',
      'pushed back on your boss'
    ])
    expect(first.storyTitle).toBe('Checkout redesign')
    expect(second.question).toBe('Why this team?')
  })

  it('accepts notes with no headings at all', () => {
    // the common case: a page of questions, each with bullets under it
    const preview = parseBankText(`
Tell me about a difficult stakeholder.
* Named the risk early
* Put it in writing

What would you change about your last role?
1. More time on discovery
2) Fewer standing meetings
`)
    expect(preview.entries).toHaveLength(2)
    expect(preview.entries[0].points).toEqual(['Named the risk early', 'Put it in writing'])
    expect(preview.entries[1].points).toHaveLength(2)
  })

  it('ignores bullets that appear before any question', () => {
    const preview = parseBankText(`
- a stray note to myself
- remember to charge the laptop

Why this team?
- The problem is the one I want to spend three years on
`)
    expect(preview.entries).toHaveLength(1)
    expect(preview.entries[0].points).toHaveLength(1)
  })

  it('counts entries with no points rather than dropping them', () => {
    // importable, but they will never strike through — worth saying so
    const preview = parseBankText('Why this team?\n\nTell me about yourself.\n')
    expect(preview.entries).toHaveLength(2)
    expect(preview.pointless).toBe(2)
  })

  it('explains itself when it finds nothing', () => {
    const preview = parseBankText('just some prose about the company and its values')
    expect(preview.entries).toHaveLength(0)
    expect(preview.problem).toMatch(/no questions found/i)
  })

  it('refuses an empty paste', () => {
    expect(parseBankText('   ').problem).toMatch(/nothing to import/i)
  })
})

describe('parsing a bank export', () => {
  it('round-trips JSON losslessly enough to rebuild the entries', () => {
    const json = serializeBank(bank, 'json')
    const preview = parseBankText(json)
    expect(preview.format).toBe('json')
    expect(preview.entries).toHaveLength(bank.answers.length)
    const first = preview.entries[0]
    expect(first.question).toBe(bank.answers[0].question)
    expect(first.points).toEqual(bank.answers[0].points.map((p) => p.text))
    expect(first.triggerPhrases).toEqual(bank.answers[0].triggerPhrases)
  })

  it('round-trips markdown back into the same questions and points', () => {
    const md = serializeBank(bank, 'md')
    const preview = parseBankText(md)
    expect(preview.entries.map((e) => e.question).sort()).toEqual(
      bank.answers.map((a) => a.question).sort()
    )
    const reread = preview.entries.find((e) => e.question === bank.answers[0].question)!
    expect(reread.points).toEqual(bank.answers[0].points.map((p) => p.text))
    expect(reread.triggerPhrases).toEqual(bank.answers[0].triggerPhrases)
  })

  it('says what is wrong with malformed JSON instead of importing half of it', () => {
    expect(parseBankText('{ "answers": [').entries).toHaveLength(0)
    expect(parseBankText('{ "answers": [').problem).toMatch(/could not be parsed/i)
    expect(parseBankText('{"loops":[]}').problem).toMatch(/no `answers` array/i)
  })

  it('exports only the chosen loop', () => {
    const loopId = bank.loops[1].id
    const md = serializeBank(bank, 'md', loopId)
    const expected = bank.answers.filter((a) => a.loopIds.includes(loopId)).length
    expect(parseBankText(md).entries).toHaveLength(expected)
    expect(expected).toBeLessThan(bank.answers.length)
  })
})

describe('near-duplicate detection', () => {
  it('recognises a re-import of the same bank', () => {
    const preview = parseBankText(serializeBank(bank, 'md'), bank.answers)
    expect(preview.duplicates).toBe(preview.entries.length)
  })

  it('catches a reworded version of a question you already have', () => {
    const existing = bank.answers[0]
    const reworded = existing.question.replace(/\.$/, ', start to finish.')
    expect(findDuplicate(reworded, bank.answers)).toBe(existing.id)
  })

  it('does not flag a genuinely new question', () => {
    expect(findDuplicate('What is your notice period?', bank.answers)).toBeNull()
  })
})

describe('entriesToAnswers', () => {
  it('lands entries in the chosen loop and section with unique ids', () => {
    const entries = parseBankText('Why this team?\n- because of the problem\n').entries
    const answers = entriesToAnswers(entries, {
      loopId: 'loop-x',
      sectionId: 'sec-y',
      stories: bank.stories
    })
    expect(answers[0].loopIds).toEqual(['loop-x'])
    expect(answers[0].sectionId).toBe('sec-y')
    expect(answers[0].points[0].text).toBe('because of the problem')
    expect(answers[0].lastUsed).toBeNull()

    const more = entriesToAnswers(entries, { loopId: 'loop-x', sectionId: 'sec-y', stories: bank.stories })
    expect(more[0].id).not.toBe(answers[0].id)
  })

  it('attaches a story named in the notes, and invents nothing when it is unknown', () => {
    const known = bank.stories[0].title
    const [withStory] = entriesToAnswers(
      [{ question: 'Q', points: [], triggerPhrases: [], storyTitle: known, duplicateOf: null }],
      { loopId: 'l', sectionId: 's', stories: bank.stories }
    )
    expect(withStory.storyId).toBe(bank.stories[0].id)

    const [without] = entriesToAnswers(
      [{ question: 'Q', points: [], triggerPhrases: [], storyTitle: 'Never heard of it', duplicateOf: null }],
      { loopId: 'l', sectionId: 's', stories: bank.stories }
    )
    expect(without.storyId).toBeNull()
  })
})
