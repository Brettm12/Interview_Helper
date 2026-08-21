import type { Answer, Candidate, Matcher } from '@shared/types'
import { TUNING, type Tuning } from '@shared/tuning'
import { diceCoefficient, fuzzyPhraseHit } from './text'
import type { EmbeddingCache } from './embeddings'

// Scores the rolling window of interviewer speech against every bank entry:
//   - embedding cosine, best across the question *and* its trigger phrases
//   - trigger-phrase hit (normalised, fuzzy edit distance) → additive boost
//   - bigram Dice coefficient as the fallback path while the model warms up
// All thresholds live in @shared/tuning.

export type MatchState = 'none' | 'ambiguous' | 'confident'

/** per-entry score adjustment supplied by the session — see the repeat prior
 *  in engine.ts. Positive values promote, negative demote. */
export type Priors = (entryId: string) => number

export class HybridMatcher implements Matcher {
  constructor(
    private embeddings: EmbeddingCache | null = null,
    private tuning: Tuning = TUNING
  ) {}

  /** every text an entry can legitimately be recognised by */
  private textsFor(entry: Answer): string[] {
    return [entry.question, ...entry.triggerPhrases]
  }

  score(utterance: string, entries: Answer[], priors?: Priors): Candidate[] {
    const t = this.tuning
    const out: Candidate[] = entries.map((entry) => {
      const dice = diceCoefficient(utterance, entry.question)
      // Trigger phrases used to reach the score only through fuzzy edit
      // distance, so "hardest investigation" matched "the hardest
      // investigation" and missed "the case that gave you the most trouble"
      // entirely — which is exactly the job a trigger phrase exists to do.
      // They are embedded now and the best cosine wins, discounted a little so
      // the canonical question takes a tie.
      let cos: number | null = this.embeddings?.similarity(utterance, entry.question) ?? null
      for (const phrase of entry.triggerPhrases) {
        const c = this.embeddings?.similarity(utterance, phrase)
        if (c == null) continue
        const discounted = c * t.triggerCosineWeight
        cos = cos == null ? discounted : Math.max(cos, discounted)
      }
      // once embeddings are warm, blend them with Dice; before that Dice
      // carries the whole semantic score
      let score = cos == null ? dice : cos * t.embeddingWeight + dice * (1 - t.embeddingWeight)
      for (const phrase of entry.triggerPhrases) {
        if (fuzzyPhraseHit(phrase, utterance, t.triggerFuzz)) {
          score += t.triggerBoost
          break // one boost per entry, not per phrase
        }
      }
      // saturate the evidence *before* applying the prior. Clamping last meant
      // a near-verbatim question with a trigger hit scored past 1, so the
      // repeat penalty was silently a no-op on exactly the strong, already-used
      // entries it exists to demote.
      score = Math.min(1, score)
      if (priors) score += priors(entry.id)
      return { entryId: entry.id, score: Math.max(0, Math.min(1, score)) }
    })
    return out.sort((a, b) => b.score - a.score)
  }

  /** classify a scored, sorted candidate list against the thresholds */
  classify(candidates: Candidate[]): MatchState {
    const t = this.tuning
    const top = candidates[0]
    if (!top || top.score < t.ambiguous) return 'none'
    const runnerUp = candidates[1]?.score ?? 0
    if (top.score >= t.confident && top.score - runnerUp >= t.confidentMargin) {
      return 'confident'
    }
    return 'ambiguous'
  }

  /** the 2–3 candidates worth showing in the unsure state */
  shortlist(candidates: Candidate[]): Candidate[] {
    const t = this.tuning
    return candidates.filter((c) => c.score >= t.ambiguous * 0.75).slice(0, t.maxCandidates)
  }
}
