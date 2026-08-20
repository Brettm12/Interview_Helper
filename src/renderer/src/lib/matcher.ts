import type { Answer, Candidate, Matcher } from '@shared/types'
import { TUNING, type Tuning } from '@shared/tuning'
import { diceCoefficient, fuzzyPhraseHit } from './text'
import type { EmbeddingCache } from './embeddings'

// Scores the rolling window of interviewer speech against every bank entry:
//   - trigger-phrase hit (normalised, fuzzy edit distance) → additive boost
//   - embedding cosine similarity utterance ↔ question text (once warm)
//   - bigram Dice coefficient as the fallback path while the model warms up
// All thresholds live in @shared/tuning.

export type MatchState = 'none' | 'ambiguous' | 'confident'

export class HybridMatcher implements Matcher {
  constructor(
    private embeddings: EmbeddingCache | null = null,
    private tuning: Tuning = TUNING
  ) {}

  score(utterance: string, entries: Answer[]): Candidate[] {
    const t = this.tuning
    const out: Candidate[] = entries.map((entry) => {
      const dice = diceCoefficient(utterance, entry.question)
      const cos = this.embeddings?.similarity(utterance, entry.question) ?? null
      // once embeddings are warm, blend them with Dice; before that Dice
      // carries the whole semantic score
      let score = cos == null ? dice : cos * t.embeddingWeight + dice * (1 - t.embeddingWeight)
      for (const phrase of entry.triggerPhrases) {
        if (fuzzyPhraseHit(phrase, utterance, t.triggerFuzz)) {
          score += t.triggerBoost
          break // one boost per entry, not per phrase
        }
      }
      return { entryId: entry.id, score: Math.min(1, score) }
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
