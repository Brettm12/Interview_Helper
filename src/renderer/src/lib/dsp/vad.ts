import { TUNING } from '@shared/tuning'
import { dbfs, rms } from './level'

// Voice activity detection and segmentation.
//
// What this replaces, and why each part exists:
//
//  - A *fixed* 0.008 RMS threshold. A microphone quieter than that produced
//    no transcript at all, silently. The floor is now estimated from the room
//    continuously, so a quiet mic and a noisy office both work.
//  - Sub-threshold chunks were *discarded before buffering*, so the audio
//    handed to Whisper was speech-only, spliced at every inter-word gap, with
//    low-energy phonemes clipped off both ends of every word. Once a segment
//    opens here, everything is kept until it closes.
//  - Nothing was retained from before speech was detected, so leading
//    consonants were always lost. There is now a pre-roll ring.
//  - Segments closed after 800ms of "silence" that was really an ordinary
//    pause, cutting people off mid-sentence.

export interface Utterance {
  samples: Float32Array
  /** session clock, seconds, of the first sample (including pre-roll) */
  startT: number
  endT: number
  /** how much of it was above the speech threshold */
  speechMs: number
  /** true when a hard cap forced the cut rather than a natural pause */
  truncated: boolean
}

/**
 * Room noise estimate: falls quickly toward quiet frames, rises slowly, and
 * is frozen while speech is in progress so a long answer can't drag it up
 * after itself (which would re-create the "misses my speech" bug in adaptive
 * clothing).
 */
export class NoiseFloor {
  private floorDb: number
  /** frames left in the priming window */
  private priming: number
  private primeMin = Infinity

  constructor(private frameMs = TUNING.vadFrameMs) {
    this.floorDb = TUNING.vadFloorMinDbfs
    this.priming = Math.ceil(TUNING.vadFloorPrimeMs / frameMs)
  }

  /** steady noise identified after the fact: pull the floor up to it at once.
   *  Clamping still applies, and the fast-fall attack corrects any overshoot
   *  within a few quiet frames. */
  raiseTo(levelDb: number): void {
    if (levelDb > this.floorDb) {
      this.floorDb = Math.min(TUNING.vadFloorMaxDbfs, levelDb)
    }
  }

  update(levelDb: number, speaking: boolean): number {
    if (this.priming > 0) {
      // prime straight from the room: creeping up from the minimum takes
      // seconds, and until it arrives a noisy room never yields a pause
      this.priming--
      this.primeMin = Math.min(this.primeMin, levelDb)
      this.floorDb = this.primeMin
    } else if (!speaking) {
      if (levelDb < this.floorDb) {
        this.floorDb += (levelDb - this.floorDb) * TUNING.vadFloorAttack
      } else {
        this.floorDb += (TUNING.vadFloorRiseDbPerSec * this.frameMs) / 1000
      }
    }
    this.floorDb = Math.min(
      TUNING.vadFloorMaxDbfs,
      Math.max(TUNING.vadFloorMinDbfs, this.floorDb)
    )
    return this.floorDb
  }

  get value(): number {
    return this.floorDb
  }
}

interface Frame {
  samples: Float32Array
  db: number
  /** session clock, seconds, of this frame's first sample */
  t: number
}

export class VadSegmenter {
  private frameSize: number
  private carry: number[] = []
  private preRoll: Frame[] = []
  private preRollMax: number
  private open = false
  private openHoldMs = 0
  private segment: Frame[] = []
  private speechMs = 0
  private silenceMs = 0
  private floor = new NoiseFloor()
  /** absolute sample index consumed, for deriving frame timestamps */
  private consumed = 0

  constructor(private sampleRate = TUNING.asrSampleRate) {
    this.frameSize = Math.round((sampleRate * TUNING.vadFrameMs) / 1000)
    this.preRollMax = Math.ceil(TUNING.vadPreRollMs / TUNING.vadFrameMs)
  }

  get isOpen(): boolean {
    return this.open
  }

  get floorDbfs(): number {
    return this.floor.value
  }

  /** feed a block of any length; returns whatever utterances it completed */
  push(samples: Float32Array): Utterance[] {
    const out: Utterance[] = []
    for (let i = 0; i < samples.length; i++) this.carry.push(samples[i])

    while (this.carry.length >= this.frameSize) {
      const buf = new Float32Array(this.carry.splice(0, this.frameSize))
      const t = this.consumed / this.sampleRate
      this.consumed += this.frameSize
      const frame: Frame = { samples: buf, db: dbfs(rms(buf)), t }
      const done = this.pushFrame(frame)
      if (done) out.push(done)
    }
    return out
  }

  private pushFrame(frame: Frame): Utterance | null {
    const floorDb = this.floor.update(frame.db, this.open)
    const openAt = Math.max(floorDb + TUNING.vadOpenDb, TUNING.vadAbsoluteOpenDbfs)
    const closeAt = floorDb + TUNING.vadCloseDb
    const loud = frame.db >= (this.open ? closeAt : openAt)

    if (!this.open) {
      // pre-roll: keep recent audio so a leading consonant survives the onset
      this.preRoll.push(frame)
      if (this.preRoll.length > this.preRollMax) this.preRoll.shift()

      if (loud) {
        this.openHoldMs += TUNING.vadFrameMs
        // require a sustained onset — a key click is 5–15ms
        if (this.openHoldMs >= TUNING.vadOpenHoldMs) {
          this.open = true
          this.segment = [...this.preRoll]
          this.speechMs = this.openHoldMs
          this.silenceMs = 0
          this.preRoll = []
          this.openHoldMs = 0
        }
      } else {
        this.openHoldMs = 0
      }
      return null
    }

    // open: keep every frame, silence included. Excising the gaps is what
    // made the audio unintelligible to Whisper.
    this.segment.push(frame)
    if (loud) {
      this.speechMs += TUNING.vadFrameMs
      this.silenceMs = 0
    } else {
      this.silenceMs += TUNING.vadFrameMs
    }

    const lengthMs = this.segment.length * TUNING.vadFrameMs
    if (this.silenceMs >= this.requiredSilenceMs(lengthMs)) return this.close(false)
    if (lengthMs >= TUNING.vadMaxSegmentSec * 1000) return this.close(true)
    return null
  }

  /** how long a pause has to be before it ends the segment */
  private requiredSilenceMs(lengthMs: number): number {
    if (lengthMs >= TUNING.vadSoftMaxSec * 1000) return TUNING.vadEndSilenceMinMs
    if (this.speechMs < TUNING.vadShortUtteranceMs) return TUNING.vadEndSilenceShortMs
    return TUNING.vadEndSilenceMs
  }

  private close(truncated: boolean): Utterance | null {
    const frames = this.segment
    this.open = false
    this.segment = []
    this.openHoldMs = 0
    const speechMs = this.speechMs
    const silenceMs = this.silenceMs
    this.speechMs = 0
    this.silenceMs = 0
    if (frames.length === 0) return null

    // A segment that ran to the hard cap with an almost-flat level is a fan or
    // AC compressor, not fifteen seconds of speech: speech swings tens of dB
    // between phonemes and pauses, steady noise barely moves. The floor is
    // frozen while a segment is open (so a long answer can't drag it up), which
    // used to mean a sustained noise step ratcheted the floor up ~0.36dB per
    // 15s cycle while every cycle fed Whisper a cap-length noise segment
    // (REVIEW.md H7). Instead: recognise the flat segment, pull the floor up to
    // it in one step, and emit nothing.
    if (truncated) {
      const dbs = frames.map((f) => f.db).sort((a, b) => a - b)
      const p10 = dbs[Math.floor(dbs.length * 0.1)]
      const p90 = dbs[Math.min(dbs.length - 1, Math.floor(dbs.length * 0.9))]
      if (p90 - p10 < TUNING.vadNoiseSpreadDb) {
        this.floor.raiseTo(dbs[Math.floor(dbs.length / 2)])
        return null
      }
    }

    // trim trailing silence to a short pad: some helps Whisper finish the
    // last word, a lot invites hallucinated sign-offs
    const padFrames = Math.ceil(TUNING.vadTailPadMs / TUNING.vadFrameMs)
    const silentFrames = Math.floor(silenceMs / TUNING.vadFrameMs)
    const drop = Math.max(0, silentFrames - padFrames)
    const kept = drop > 0 ? frames.slice(0, Math.max(1, frames.length - drop)) : frames

    const durationMs = kept.length * TUNING.vadFrameMs
    // judge on *voiced* time, not total: a blip still carries pre-roll and
    // tail padding, which would sneak it past a duration-only check
    if (durationMs < TUNING.vadMinUtteranceMs || speechMs < TUNING.vadMinSpeechMs) {
      // a cough or a click — dropped, and state is already reset, so it can't
      // stick around and glue itself to the next thing said
      return null
    }

    const total = kept.reduce((n, f) => n + f.samples.length, 0)
    const samples = new Float32Array(total)
    let o = 0
    for (const f of kept) {
      samples.set(f.samples, o)
      o += f.samples.length
    }
    return {
      samples,
      startT: kept[0].t,
      endT: kept[kept.length - 1].t + TUNING.vadFrameMs / 1000,
      speechMs,
      truncated
    }
  }

  /**
   * A look at the segment currently in progress, for in-flight partials.
   *
   * Bounded to a trailing window on purpose: the old worker re-transcribed the
   * *entire* growing buffer every 1.6s, so the cost of a partial grew with the
   * length of the answer until flushes started being dropped outright.
   */
  peekOpen(maxSeconds: number): { samples: Float32Array; startT: number; speechMs: number } | null {
    if (!this.open || this.segment.length === 0) return null
    const maxFrames = Math.max(1, Math.floor((maxSeconds * 1000) / TUNING.vadFrameMs))
    const frames =
      this.segment.length > maxFrames ? this.segment.slice(this.segment.length - maxFrames) : this.segment
    const total = frames.reduce((n, f) => n + f.samples.length, 0)
    const samples = new Float32Array(total)
    let o = 0
    for (const f of frames) {
      samples.set(f.samples, o)
      o += f.samples.length
    }
    return { samples, startT: frames[0].t, speechMs: this.speechMs }
  }

  /** end of stream: emit whatever is open */
  flush(): Utterance | null {
    return this.open ? this.close(false) : null
  }

  reset(): void {
    this.carry = []
    this.preRoll = []
    this.segment = []
    this.open = false
    this.openHoldMs = 0
    this.speechMs = 0
    this.silenceMs = 0
    // the clock too: the worker re-anchors its offset to the next chunk's
    // session time on every reset, so startT must count from zero again —
    // keeping the old total double-counted every timestamp after a
    // pause/resume or a second session (REVIEW.md H5)
    this.consumed = 0
  }
}

/** Loudness conditioning before Whisper: whatever level the mic delivered,
 *  the model sees something in a sane range. The min() means a hot input is
 *  attenuated as readily as a quiet one is lifted. */
export function normalizeForAsr(samples: Float32Array): {
  samples: Float32Array
  gain: number
} {
  let peakAbs = 0
  let sum = 0
  let mean = 0
  for (let i = 0; i < samples.length; i++) mean += samples[i]
  mean /= Math.max(1, samples.length)
  for (let i = 0; i < samples.length; i++) {
    const v = samples[i] - mean // residual DC, after the high-pass upstream
    sum += v * v
    const a = Math.abs(v)
    if (a > peakAbs) peakAbs = a
  }
  const level = Math.sqrt(sum / Math.max(1, samples.length))
  if (level < TUNING.asrNoiseFloorRms) return { samples, gain: 1 }

  const gain = Math.min(
    TUNING.asrTargetRms / level,
    peakAbs > 0 ? TUNING.asrPeakCeiling / peakAbs : TUNING.asrMaxGain,
    TUNING.asrMaxGain
  )
  const out = new Float32Array(samples.length)
  for (let i = 0; i < samples.length; i++) out[i] = (samples[i] - mean) * gain
  return { samples: out, gain }
}
