import type { CoverageModel, Point, PointId } from '@shared/types'
import { TUNING, type Tuning } from '@shared/tuning'
import { diceCoefficient, tokenRecall } from './text'
import type { EmbeddingCache } from './embeddings'

// On each confirmed segment from the candidate's own mic, score it against the
// uncovered points of the active entry. Embedding cosine ≥ TUNING.coverage
// marks a point covered; while the model is cold, a lexical fallback
// (Dice ∨ stopword-filtered token recall) with its own threshold stands in.
// Covering is monotonic — nothing here ever un-covers a point.

export class EmbeddingCoverage implements CoverageModel {
  constructor(
    private embeddings: EmbeddingCache | null = null,
    private tuning: Tuning = TUNING
  ) {}

  score(said: string, points: Point[]): PointId[] {
    const t = this.tuning
    const covered: PointId[] = []
    for (const point of points) {
      const cos = this.embeddings?.similarity(said, point.text) ?? null
      if (cos != null) {
        if (cos >= t.coverage) covered.push(point.id)
        continue
      }
      const lexical = Math.max(diceCoefficient(said, point.text), tokenRecall(point.text, said))
      if (lexical >= t.coverageLexical) covered.push(point.id)
    }
    return covered
  }
}
