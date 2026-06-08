import type { CallClassification } from './patterns'

export type { CallClassification }

export type ClassifyResult = {
  activityEventId: number
  classification: CallClassification
  transcript: string
  summary: string | null   // Claude summary — populated for live calls only
  whisperSecs: number | null
}

// Input fed through each pipeline stage
export type PipelineContext = {
  activityEventId: number
  externalId: string
  recordingUrl: string
  durationSecs: number | null
  // Populated by stages as pipeline progresses
  audioBuffer?: Buffer
  transcript?: string
  whisperSecs?: number
  classification?: CallClassification
  summary?: string | null
}
