import { TUNING } from '@shared/tuning'

// Whisper output filtering.
//
// Whisper does not decline to answer. Handed near-silence, or a stretch of
// room tone that the segmenter opened on, it emits one of a small set of
// phrases it saw in its training captions — "Thank you.", "you", music notes,
// "[BLANK_AUDIO]" — or falls into a repetition loop. Every one of those lands
// in the transcript, gets scored against the answer bank, and can swing the
// panel to the wrong question. So they're filtered here, before they exist.
//
// Kept pure and out of the worker so the rules are unit-testable.

/** stock filler Whisper produces on silence, normalised (lowercase, no
 *  punctuation). Only dropped when the audio barely contained any voice —
 *  someone genuinely saying "thank you" mid-interview keeps it. */
const FILLERS = new Set([
  'you',
  'thank you',
  'thanks',
  'thank you very much',
  'thanks for watching',
  'thanks for watching!',
  'bye',
  'bye bye',
  'okay',
  'ok',
  'so',
  'oh',
  'the',
  'yeah',
  'um',
  'uh',
  'mm',
  'hmm',
  'silence',
  'music',
  'blank audio',
  'inaudible',
  'subs by www zeoranger co uk',
  'subtitles by the amara org community'
])

/** collapse whitespace and strip the leading space Whisper always emits */
export function cleanTranscript(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim()
}

function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** ≥ asrMaxWordRepeats of the same word in a row — the decoder looping, not a
 *  person */
function hasRepetitionLoop(text: string): boolean {
  const words = normalise(text).split(' ').filter(Boolean)
  let run = 1
  for (let i = 1; i < words.length; i++) {
    run = words[i] === words[i - 1] ? run + 1 : 1
    if (run >= TUNING.asrMaxWordRepeats) return true
  }
  return false
}

/**
 * Should this transcript be thrown away?
 *
 * `speechMs` is the *voiced* time in the audio it came from — the whole point
 * of the filler rule. A confident "Thank you, that's a great question" carries
 * hundreds of milliseconds of voice; the hallucinated one comes from a segment
 * that was almost entirely room tone.
 */
export function isLikelyHallucination(text: string, speechMs: number): boolean {
  const trimmed = cleanTranscript(text)
  if (!trimmed) return true
  // whole thing is a caption annotation: [BLANK_AUDIO], (upbeat music)
  if (/^[[(].*[\])]$/.test(trimmed)) return true
  // nothing but punctuation, music notes or ellipses
  if (!/[a-z0-9]/i.test(trimmed)) return true
  if (hasRepetitionLoop(trimmed)) return true
  if (speechMs < TUNING.asrHallucinationMaxSpeechMs && FILLERS.has(normalise(trimmed))) return true
  return false
}
