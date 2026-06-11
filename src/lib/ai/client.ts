import Anthropic from '@anthropic-ai/sdk'
import type { MessageStreamEvent } from '@anthropic-ai/sdk/resources/messages/messages.js'
import { AIError } from './errors'
import { anthropicLimiter } from '@/lib/rate-limiters'

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
})

const DEFAULT_SYSTEM =
  'You are a case analyst for Horizon Recovery LLC, a surplus funds recovery firm. ' +
  'You analyze HubSpot CRM activity for deals to help the owner prioritize their attention. ' +
  'Always respond with valid JSON as instructed — no markdown, no preamble.'

export async function callClaude(
  prompt: string,
  systemPrompt?: string,
  maxTokens = 1024,
  model = 'claude-sonnet-4-6'
): Promise<string> {
  try {
    return await anthropicLimiter.schedule(async () => {
      const response = await anthropic.messages.create({
        model,
        max_tokens: maxTokens,
        system: systemPrompt ?? DEFAULT_SYSTEM,
        messages: [{ role: 'user', content: prompt }],
      })

      if (response.stop_reason === 'max_tokens') {
        throw new AIError('Claude response was truncated — increase max_tokens')
      }

      const block = response.content[0]
      if (block.type !== 'text') {
        throw new AIError(`Unexpected content block type: ${block.type}`)
      }

      return block.text
    })
  } catch (err) {
    if (err instanceof AIError) throw err
    throw new AIError(
      `Anthropic API call failed: ${err instanceof Error ? err.message : String(err)}`
    )
  }
}

// Sends one or more base64-encoded documents alongside a text prompt.
// Uses the Anthropic "document" content block — supports PDF natively.
// All documents are passed in a single request so Claude can cross-reference them.
export async function callClaudeWithDocuments(
  documents: Array<{ data: string; mimeType: string; label: string }>,
  prompt: string,
  systemPrompt?: string,
  maxTokens = 1024
): Promise<string> {
  const docBlocks = documents.map(d => ({
    type: 'document' as const,
    source: {
      type: 'base64' as const,
      media_type: (d.mimeType.startsWith('application/pdf') ? 'application/pdf' : d.mimeType) as 'application/pdf',
      data: d.data,
    },
    title: d.label,
  }))

  try {
    return await anthropicLimiter.schedule(async () => {
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: maxTokens,
        system: systemPrompt ?? DEFAULT_SYSTEM,
        messages: [{
          role: 'user',
          content: [...docBlocks, { type: 'text' as const, text: prompt }],
        }],
      })

      if (response.stop_reason === 'max_tokens') {
        throw new AIError('Claude response was truncated — increase max_tokens')
      }

      const block = response.content[0]
      if (block.type !== 'text') {
        throw new AIError(`Unexpected content block type: ${block.type}`)
      }

      return block.text
    })
  } catch (err) {
    if (err instanceof AIError) throw err
    throw new AIError(
      `Anthropic document API call failed: ${err instanceof Error ? err.message : String(err)}`
    )
  }
}

// Sends one or more screenshots (or any images) alongside a text prompt.
// Used by vision-verify.ts — passes base64 PNG screenshots to Claude for visual analysis.
// Images precede the text prompt so Claude sees visuals before reading the question.
export async function callClaudeWithImages(
  prompt: string,
  images: Array<{ data: string; mimeType: 'image/png' | 'image/jpeg' }>,
  systemPrompt?: string,
  maxTokens = 1024,
): Promise<string> {
  const imageBlocks = images.map(img => ({
    type: 'image' as const,
    source: {
      type: 'base64' as const,
      media_type: img.mimeType,
      data: img.data,
    },
  }))

  try {
    return await anthropicLimiter.schedule(async () => {
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: maxTokens,
        system: systemPrompt ?? DEFAULT_SYSTEM,
        messages: [{
          role: 'user',
          content: [...imageBlocks, { type: 'text' as const, text: prompt }],
        }],
      })

      if (response.stop_reason === 'max_tokens') {
        throw new AIError('Claude response was truncated — increase max_tokens')
      }

      const block = response.content[0]
      if (block.type !== 'text') {
        throw new AIError(`Unexpected content block type: ${block.type}`)
      }

      return block.text
    })
  } catch (err) {
    if (err instanceof AIError) throw err
    throw new AIError(
      `Anthropic vision API call failed: ${err instanceof Error ? err.message : String(err)}`
    )
  }
}

// Returns the MessageStream AsyncIterable directly — caller iterates events.
// Used for streaming responses (e.g. Daily Briefing). Not wrapped in limiter:
// streaming uses a separate token budget and is always a single manual trigger.
export function callClaudeStreaming(
  prompt: string,
  systemPrompt?: string
): AsyncIterable<MessageStreamEvent> {
  return anthropic.messages.stream({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    system: systemPrompt ?? DEFAULT_SYSTEM,
    messages: [{ role: 'user', content: prompt }],
  })
}
