// Every matching / coverage threshold lives here. These get adjusted against
// real sessions — change the number, not the call sites.
export const TUNING = {
  // --- question matching -----------------------------------------------------
  /** top candidate must reach this to swap the panel without asking */
  confident: 0.62,
  /** ...and beat the runner-up by at least this margin */
  confidentMargin: 0.12,
  /** below `confident` but at/above this → unsure state with 2–3 candidates */
  ambiguous: 0.45,
  /** additive boost when a trigger phrase hits (normalised, fuzzy edit distance) */
  triggerBoost: 0.35,
  /** a trigger phrase counts as a hit when its fuzzy similarity reaches this */
  triggerFuzz: 0.82,
  /** blend of embedding cosine vs bigram Dice once embeddings are warm.
   *  Before the model is warm, Dice carries the whole score. */
  embeddingWeight: 0.75,
  /** rolling window of interviewer speech scored against the bank, seconds */
  windowSec: 12,
  /** at most one automatic panel swap per this many ms */
  swapDebounceMs: 2500,
  /** unsure state auto-picks the leader after this many seconds */
  autoPickSec: 4,
  /** candidates shown in the unsure state */
  maxCandidates: 3,

  // --- coverage --------------------------------------------------------------
  /** a point is marked covered when its embedding similarity to what was just
   *  said reaches this. Never un-covers automatically. */
  coverage: 0.55,
  /** fallback (lexical Dice + token overlap) threshold while embeddings are
   *  cold — deliberately stricter than the embedding path since bigram overlap
   *  on short phrases is noisier */
  coverageLexical: 0.38,

  // --- recap flags -----------------------------------------------------------
  /** an answer "ran long" past this many seconds of your own mic time */
  longAnswerSec: 150
} as const

export type Tuning = typeof TUNING
