import Anthropic from '@anthropic-ai/sdk'
import { AIError } from './errors'

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
})

const DEFAULT_SYSTEM =
  'You are a case analyst for Horizon Recovery LLC, a surplus funds recovery firm. ' +
  'You analyze HubSpot CRM activity for deals to help the owner prioritize their attention. ' +
  'Always respond with valid JSON as instructed — no markdown, no preamble.'

export async function callClaude(prompt: string, systemPrompt?: string): Promise<string> {
  let response
  try {
    response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: systemPrompt ?? DEFAULT_SYSTEM,
      messages: [{ role: 'user', content: prompt }],
    })
  } catch (err) {
    throw new AIError(
      `Anthropic API call failed: ${err instanceof Error ? err.message : String(err)}`
    )
  }

  if (response.stop_reason === 'max_tokens') {
    throw new AIError('Claude response was truncated — increase max_tokens')
  }

  const block = response.content[0]
  if (block.type !== 'text') {
    throw new AIError(`Unexpected content block type: ${block.type}`)
  }

  return block.text
}
