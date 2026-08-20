import { z } from 'zod'

// zod schemas used to validate persisted data on read (the repository never
// trusts the file on disk). Shapes mirror shared/types.ts.

export const PointSchema = z.object({
  id: z.string(),
  text: z.string()
})

export const AnswerSchema = z.object({
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

export const BankSchema = z.object({
  loops: z.array(LoopSchema),
  sections: z.array(SectionSchema),
  answers: z.array(AnswerSchema),
  stories: z.array(StorySchema),
  activeLoopId: z.string()
})

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
  missedLabels: z.array(z.string()),
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

export const SettingsSchema = z.object({
  contentProtection: z.boolean(),
  keepTranscript: z.boolean(),
  placement: z.enum(['docked', 'strip', 'second-screen']),
  stripPosition: z.object({ x: z.number(), y: z.number() }).nullable()
})
