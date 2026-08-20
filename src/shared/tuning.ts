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
  longAnswerSec: 150,

  // --- audio capture ---------------------------------------------------------
  /** Whisper's feature extractor is fixed at 16kHz */
  asrSampleRate: 16000,
  /** sinc zero crossings each side of the resampler kernel */
  resamplerZeroCrossings: 16,
  /** kernel cutoff as a fraction of the lower Nyquist — leaves transition room
   *  below 8kHz so nothing above it survives to fold into speech */
  resamplerRolloff: 0.92,
  /** precomputed sub-sample phases */
  resamplerPhases: 128,
  /** input high-pass corner. 75Hz sits under the ~85Hz bottom of voiced male
   *  speech and above the desk rumble and HVAC that otherwise dominate the RMS
   *  the VAD measures */
  inputHighpassHz: 75,

  // --- voice activity / segmentation -----------------------------------------
  /** analysis frame; the resolution of every timer below */
  vadFrameMs: 20,
  /** the noise floor follows downward at this per-frame rate (~60ms) */
  vadFloorAttack: 0.3,
  /** ...and creeps up only while no segment is open, so a fan switching on is
   *  absorbed in ~2s but a long answer can't drag the floor up after itself */
  vadFloorRiseDbPerSec: 6,
  /** the floor is never trusted outside this band: below it a muted device
   *  makes every rustle "speech"; above it a loud room gates out talking */
  vadFloorMinDbfs: -75,
  vadFloorMaxDbfs: -30,
  /** speech opens this far above the floor. Conversation sits 15–25dB over
   *  room noise, so +9 clears HVAC and key clicks without needing a shout */
  vadOpenDb: 9,
  /** ...and stays open until this close to it. The gap is what keeps trailing
   *  fricatives inside the segment instead of clipping them off */
  vadCloseDb: 4,
  /** absolute gate — never open below this however low the floor drifts.
   *  18dB under the old fixed 0.008 RMS (−41.9 dBFS) that missed quiet mics */
  vadAbsoluteOpenDbfs: -60,
  /** hold above the open threshold before speech is declared: longer than a
   *  key click (5–15ms), shorter than the shortest syllable (~80ms) */
  vadOpenHoldMs: 60,
  /** audio kept from *before* the onset, so leading /s/ /f/ /th/ (100–150ms)
   *  reach Whisper instead of being clipped off the front of the word */
  vadPreRollMs: 300,
  /** silence that closes a normal segment. Sentence-internal and hesitation
   *  pauses run 200–600ms, so 750 clears them — the old 800ms fired inside
   *  ordinary pauses because the threshold was far too high */
  vadEndSilenceMs: 750,
  /** a segment with less voiced time than vadShortUtteranceMs waits longer,
   *  so "Yes —" glues to the clause after it rather than going alone */
  vadEndSilenceShortMs: 1200,
  vadShortUtteranceMs: 1200,
  /** past this length, take the first available breath... */
  vadSoftMaxSec: 9,
  vadEndSilenceMinMs: 350,
  /** ...and only here cut mid-sentence */
  vadMaxSegmentSec: 15,
  /** trailing silence kept on the emitted audio: some helps Whisper close the
   *  last word, more invites "Thank you." hallucinations */
  vadTailPadMs: 250,
  /** shorter than this after trimming is a cough, not a word */
  vadMinUtteranceMs: 300,
  /** ...and this much *voiced* time is the real test: a blip that opened the
   *  gate still carries pre-roll and tail padding, so total length alone
   *  would let clicks through */
  vadMinSpeechMs: 150,
  /** the floor is primed directly from the room over this first window.
   *  Creeping up from the minimum at vadFloorRiseDbPerSec would take ~5s to
   *  reach a noisy office, and until it got there every rustle read as speech
   *  and no pause ever read as silence */
  vadFloorPrimeMs: 500,

  // --- transcription conditioning --------------------------------------------
  /** loudness target before Whisper. The min() of the two means a hot input is
   *  attenuated as readily as a quiet one is rescued */
  asrTargetRms: 0.07,
  asrPeakCeiling: 0.95,
  asrMaxGain: 20,
  /** below this the segment is noise, not quiet speech — don't amplify it 20× */
  asrNoiseFloorRms: 0.0005,
  /** how often an in-flight partial is produced while someone is still talking */
  asrPartialIntervalMs: 1600,
  /** ...over this much trailing audio, not the whole segment. Re-transcribing
   *  everything made each partial cost more than the last until flushes were
   *  being dropped and the panel fell seconds behind */
  asrPartialWindowSec: 8,
  /** don't bother with a partial until there's this much voiced material —
   *  before that Whisper mostly invents something */
  asrPartialMinSpeechMs: 700,
  /** confirmed utterances waiting on the model. Past this the machine can't
   *  keep up and the oldest is dropped: unbounded backlog turns into an
   *  ever-growing lag between what was said and what the panel shows */
  asrMaxQueued: 4,
  /** silent audio pushed through the model once at startup, so the first real
   *  utterance doesn't pay the graph-compilation cost mid-answer */
  asrWarmupMs: 400,
  /** a stock Whisper filler phrase ("thank you", "you") is treated as a
   *  hallucination when it came from less voiced time than this. Real speech
   *  that short is worth less than the noise it injects into matching */
  asrHallucinationMaxSpeechMs: 900,
  /** this many identical words in a row is Whisper's repetition loop, never a
   *  person */
  asrMaxWordRepeats: 5,

  // --- input level / meters --------------------------------------------------
  /** a source counts as hearing something above this smoothed level */
  levelOpen: 0.02,
  /** ...and only stops counting below this one. The gap is hysteresis: a
   *  single threshold made the status dot flip on every inter-word gap */
  levelClose: 0.012,
  /** and it holds "live" this long after the last sound, because a pause in
   *  speech is not the same thing as a dead microphone */
  levelHoldMs: 2500,
  /** meter ballistics: instant attack, this much exponential decay per second.
   *  Fast enough to feel responsive, slow enough to read */
  levelReleasePerSec: 3,
  /** level updates published to the UI at most this often (~10Hz). Raw chunks
   *  arrive at ~23Hz per stream and re-rendered the whole setup screen */
  levelPublishMinIntervalMs: 100,

  // --- desktop plumbing ------------------------------------------------------
  /** strip snapshots: min interval between IPC sends (a trailing send always
   *  delivers the latest state, so bursts collapse to two messages) */
  stripPublishMinIntervalMs: 100,
  /** interim session snapshot cadence while listening — a crash mid-interview
   *  keeps the recap up to the last snapshot */
  snapshotIntervalSec: 20
} as const

export type Tuning = typeof TUNING
