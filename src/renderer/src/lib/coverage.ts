import type { CoverageModel, Point, PointId } from '@shared/types'
import { TUNING, type Tuning } from '@shared/tuning'
import { contentTokens, diceCoefficient, tokenRecall } from './text'
import type { EmbeddingCache } from './embeddings'

// On each confirmed segment from the candidate's own mic, score it — and a
// rolling window of what they have just been saying — against the
// uncovered points of the active entry. Embedding cosine ≥ TUNING.coverage
// marks a point covered; while the model is cold, a lexical fallback
// (Dice ∨ stopword-filtered token recall) with its own threshold stands in.
// Covering is monotonic — nothing here ever un-covers a point.

export class EmbeddingCoverage implements CoverageModel {
  constructor(
    private embeddings: EmbeddingCache | null = null,
    private tuning: Tuning = TUNING
  ) {}

  /**
   * @param margin added to both thresholds. The rolling-window pass uses a
   *   positive margin: more text is easier to match by accident, so the bar
   *   for "you said this across two breaths" is higher than for one segment.
   */
  score(said: string, points: Point[], margin = 0): PointId[] {
    const t = this.tuning
    const covered: PointId[] = []
    for (const point of points) {
      const cos = this.embeddings?.similarity(said, point.text) ?? null
      if (cos != null && cos >= t.coverage + margin) {
        covered.push(point.id)
        continue
      }
      // The lexical path runs even when embeddings are warm — an aphoristic
      // point ("coaching without a checkpoint is a hope") can be delivered
      // with its key nouns yet score under the embedding bar (REVIEW.md M14).
      // Short points (three or fewer content words) only count the
      // order-preserving Dice signal: stopword-stripped token recall covers
      // them on any sentence that happens to reuse the words, regardless of
      // meaning or word order (REVIEW.md M13) — a verbatim delivery still
      // clears Dice comfortably.
      const lexical =
        contentTokens(point.text).length >= 4
          ? Math.max(diceCoefficient(said, point.text), tokenRecall(point.text, said))
          : diceCoefficient(said, point.text)
      if (lexical >= t.coverageLexical + margin) covered.push(point.id)
    }
    return covered
  }
}
