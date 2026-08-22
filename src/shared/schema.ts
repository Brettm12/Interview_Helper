import { z } from 'zod'
import { DEFAULT_WHISPER_MODEL } from './models'

// zod schemas used to validate persisted data on read (the repository never
// trusts the file on disk). Shapes mirror shared/types.ts.

export const PointSchema = z.object({
  id: z.string(),
  text: z.string()
})

// .passthrough(): unknown fields survive a round-trip through an old build
// instead of being silently stripped on the next save (REVIEW.md L18)
export const AnswerSchema = z
  .object({
    id: z.string(),
    question: z.string(),
    sectionId: z.string(),
    loopIds: z.array(z.string()),
    points: z.array(PointSchema),
    storyId: z.string().nullable(),
    triggerPhrases: z.array(z.string()),
    lastUsed: z
      .object({
        loopName: z.string(),
        date: z.string(),
        covered: z.number(),
        total: z.number()
      })
      .nullable()
  })
  .passthrough()

export const StorySchema = z.object({
  id: z.string(),
  title: z.string(),
  body: z.string(),
  metrics: z.array(z.string())
})

export const SectionSchema = z.object({
  id: z.string(),
  name: z.string()
})

export const LoopSchema = z.object({
  id: z.string(),
  name: z.string(),
  shortName: z.string(),
  detail: z.string(),
  startsIn: z.string().optional(),
  likelyOpeners: z.array(z.string())
})

export const BankSchema = z
  .object({
    version: z.number().default(1),
    loops: z.array(LoopSchema),
    sections: z.array(SectionSchema),
    answers: z.array(AnswerSchema),
    stories: z.array(StorySchema),
    activeLoopId: z.string()
  })
  .passthrough()

export const TranscriptLineSchema = z.object({
  speaker: z.enum(['you', 'them']),
  text: z.string(),
  highlight: z.string().optional()
})

export const SessionQuestionSchema = z.object({
  id: z.string(),
  askedAtSec: z.number(),
  question: z.string(),
  entryId: z.string().nullable(),
  coveredPointIds: z.array(z.string()),
  totalPoints: z.number(),
  micSeconds: z.number(),
  pinnedViaFind: z.boolean(),
  transcript: z.array(TranscriptLineSchema).optional()
})

export const SessionRecordSchema = z.object({
  id: z.string(),
  loopId: z.string(),
  startedAt: z.number(),
  endedAt: z.number(),
  transcriptKept: z.boolean(),
  questions: z.array(SessionQuestionSchema),
  incomplete: z.boolean().optional()
})

export const SessionsFileSchema = z.array(SessionRecordSchema)

// Every field added after the first release needs a `.default()`. readValidated
// falls back to DEFAULT_SETTINGS *wholesale* when parsing fails, so a new
// required field would silently wipe an existing user's placement, transcript
// preference and strip position on upgrade.
export const SettingsSchema = z.object({
  version: z.number().default(1),
  contentProtection: z.boolean(),
  keepTranscript: z.boolean(),
  placement: z.enum(['docked', 'strip', 'second-screen']),
  stripPosition: z.object({ x: z.number(), y: z.number() }).nullable(),
  micDeviceId: z.string().nullable().default(null),
  meetingDeviceId: z.string().nullable().default(null),
  whisperModel: z.string().default(DEFAULT_WHISPER_MODEL)
})
