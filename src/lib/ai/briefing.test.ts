import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { MessageStreamEvent } from '@anthropic-ai/sdk/resources/messages/messages.js'
import { AIError } from './errors'

// --- Hoisted mock setup -------------------------------------------------

const mockCallClaudeStreaming = vi.hoisted(() => vi.fn())

// --- Module mocks -------------------------------------------------------

vi.mock('@/lib/ai/client', () => ({
  callClaudeStreaming: mockCallClaudeStreaming,
}))

vi.mock('@/lib/db/tasks', () => ({
  getOpenTasks: vi.fn(),
}))

vi.mock('@/lib/db/settings', () => ({
  loadStageMap: vi.fn(),
  loadOwnerMap: vi.fn(),
}))

vi.mock('@/lib/db/deals', () => ({
  getDealsForQueue: vi.fn(),
}))

vi.mock('@/lib/db/activities', () => ({
  getEmployeeActivitySummary: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/lib/rules', () => ({
  evaluateAll: vi.fn(),
  buildRuleCtx: vi.fn(),
}))

vi.mock('@/lib/db/summaries', () => ({
  getMoActionDealIds: vi.fn(),
}))

// --- Imports after mock declarations ------------------------------------

import { getOpenTasks } from '@/lib/db/tasks'
import { loadStageMap, loadOwnerMap } from '@/lib/db/settings'
import { getDealsForQueue } from '@/lib/db/deals'
import { getEmployeeActivitySummary } from '@/lib/db/activities'
import { evaluateAll, buildRuleCtx } from '@/lib/rules'
import { getMoActionDealIds } from '@/lib/db/summaries'
import { streamBriefingGeneration } from './briefing'

// --- Helpers ------------------------------------------------------------

async function readStream(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let result = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    result += decoder.decode(value)
  }
  return result
}

async function* makeEventStream(events: MessageStreamEvent[]): AsyncIterable<MessageStreamEvent> {
  for (const ev of events) yield ev
}

function textDelta(text: string, index = 0): MessageStreamEvent {
  return {
    type: 'content_block_delta',
    index,
    delta: { type: 'text_delta', text },
  } as MessageStreamEvent
}

function messageDelta(stop_reason: string): MessageStreamEvent {
  return {
    type: 'message_delta',
    delta: { stop_reason, stop_sequence: null },
    usage: { output_tokens: 100 },
  } as MessageStreamEvent
}

function setupDefaultMocks() {
  vi.mocked(getDealsForQueue).mockResolvedValue({ deals: [], snoozedDealIds: new Set() })
  vi.mocked(loadStageMap).mockResolvedValue({})
  vi.mocked(loadOwnerMap).mockResolvedValue({})
  vi.mocked(getOpenTasks).mockResolvedValue([])
  vi.mocked(getMoActionDealIds).mockResolvedValue(new Set())
  vi.mocked(buildRuleCtx).mockResolvedValue({
    today: new Date(),
    timezone: 'America/New_York',
    stageMap: {},
    staleThresholds: {} as never,
    snoozedDealIds: new Set(),
    agreementNoFollowupDays: 2,
    signedNoActivityDays: 5,
    terminalStageIds: new Set(),
  })
  vi.mocked(evaluateAll).mockReturnValue([])
  vi.mocked(getEmployeeActivitySummary).mockResolvedValue(null)
}

// --- Tests --------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()
})

describe('streamBriefingGeneration', () => {
  it('returns a ReadableStream', async () => {
    setupDefaultMocks()
    mockCallClaudeStreaming.mockReturnValue(makeEventStream([]))

    const result = await streamBriefingGeneration()
    expect(result).toBeInstanceOf(ReadableStream)
  })

  it('emits text from content_block_delta text_delta events', async () => {
    setupDefaultMocks()
    mockCallClaudeStreaming.mockReturnValue(makeEventStream([
      textDelta('Hello '),
      textDelta('world'),
    ]))

    const result = await streamBriefingGeneration()
    expect(await readStream(result)).toBe('Hello world')
  })

  it('ignores non-text events (message_start, content_block_start, etc.)', async () => {
    setupDefaultMocks()
    const events: MessageStreamEvent[] = [
      { type: 'message_start', message: {} as never },
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '', citations: [] } as never },
      textDelta('actual text'),
      { type: 'content_block_stop', index: 0 },
      { type: 'message_stop' },
    ]
    mockCallClaudeStreaming.mockReturnValue(makeEventStream(events))

    const result = await streamBriefingGeneration()
    expect(await readStream(result)).toBe('actual text')
  })

  it('appends truncation notice when stop_reason is max_tokens', async () => {
    setupDefaultMocks()
    mockCallClaudeStreaming.mockReturnValue(makeEventStream([
      textDelta('Some briefing text'),
      messageDelta('max_tokens'),
    ]))

    const result = await streamBriefingGeneration()
    const text = await readStream(result)
    expect(text).toContain('Some briefing text')
    expect(text).toContain('[Briefing truncated')
  })

  it('does NOT append truncation notice for end_turn stop_reason', async () => {
    setupDefaultMocks()
    mockCallClaudeStreaming.mockReturnValue(makeEventStream([
      textDelta('Full briefing'),
      messageDelta('end_turn'),
    ]))

    const result = await streamBriefingGeneration()
    expect(await readStream(result)).toBe('Full briefing')
  })

  it('emits chunks across multiple text delta events preserving order', async () => {
    setupDefaultMocks()
    mockCallClaudeStreaming.mockReturnValue(makeEventStream([
      textDelta('A'),
      textDelta('B'),
      textDelta('C'),
    ]))

    const result = await streamBriefingGeneration()
    expect(await readStream(result)).toBe('ABC')
  })

  it('propagates stream errors as AIError', async () => {
    setupDefaultMocks()
    async function* failingStream(): AsyncIterable<MessageStreamEvent> {
      yield textDelta('partial')
      throw new Error('network error')
    }
    mockCallClaudeStreaming.mockReturnValue(failingStream())

    const result = await streamBriefingGeneration()
    const reader = result.getReader()
    const first = await reader.read()
    expect(first.done).toBe(false)

    await expect(reader.read()).rejects.toThrow(AIError)
  })

  it('calls callClaudeStreaming with the briefing system prompt', async () => {
    setupDefaultMocks()
    mockCallClaudeStreaming.mockReturnValue(makeEventStream([textDelta('ok')]))

    await readStream(await streamBriefingGeneration())

    expect(mockCallClaudeStreaming).toHaveBeenCalledOnce()
    const [, systemPrompt] = mockCallClaudeStreaming.mock.calls[0]
    expect(systemPrompt).toContain('morning briefing')
  })

  it('caps flagged deals at MAX_FLAGGED_DEALS (15) in prompt', async () => {
    const manyDeals = Array.from({ length: 20 }, (_, i) => ({
      hubspotId: `deal-${i}`,
      name: `Deal ${i}`,
      stage: 'stage-1',
      amount: 1000,
      stageEnteredAt: null,
      lastActivityDate: null,
      contactCount: 0,
      hasValidPhone: null,
      syncedAt: new Date(),
    }))

    vi.mocked(getDealsForQueue).mockResolvedValue({
      deals: manyDeals as never,
      snoozedDealIds: new Set(),
    })
    vi.mocked(loadStageMap).mockResolvedValue({ 'stage-1': 'Active' })
    vi.mocked(loadOwnerMap).mockResolvedValue({})
    vi.mocked(getOpenTasks).mockResolvedValue([])
    vi.mocked(getMoActionDealIds).mockResolvedValue(new Set())
    vi.mocked(buildRuleCtx).mockResolvedValue({
      today: new Date(),
      timezone: 'America/New_York',
      stageMap: { 'stage-1': 'Active' },
      staleThresholds: {} as never,
      snoozedDealIds: new Set(),
      agreementNoFollowupDays: 2,
      signedNoActivityDays: 5,
      terminalStageIds: new Set(),
    })
    vi.mocked(evaluateAll).mockReturnValue(
      manyDeals.map(d => ({
        deal: d as never,
        flags: [{ type: 'stage_stale', message: 'Stuck in stage', severity: 'warning' as const }],
      }))
    )
    vi.mocked(getEmployeeActivitySummary).mockResolvedValue(null)

    let capturedPrompt = ''
    mockCallClaudeStreaming.mockImplementation((prompt: string) => {
      capturedPrompt = prompt
      return makeEventStream([textDelta('briefing')])
    })

    await readStream(await streamBriefingGeneration())

    const dealMatches = capturedPrompt.match(/- Deal \d+/g) ?? []
    expect(dealMatches).toHaveLength(15)
    expect(capturedPrompt).toContain('showing top 15 of 20')
  })

  it('sorts Mo Action Required deals first', async () => {
    const deals = [
      { hubspotId: 'regular-1', name: 'Regular Deal', stage: 's1', amount: 100, contactCount: 0, hasValidPhone: null, syncedAt: new Date() },
      { hubspotId: 'mo-action-1', name: 'Mo Action Deal', stage: 's1', amount: 200, contactCount: 0, hasValidPhone: null, syncedAt: new Date() },
    ]

    vi.mocked(getDealsForQueue).mockResolvedValue({ deals: deals as never, snoozedDealIds: new Set() })
    vi.mocked(loadStageMap).mockResolvedValue({ s1: 'Active' })
    vi.mocked(loadOwnerMap).mockResolvedValue({})
    vi.mocked(getOpenTasks).mockResolvedValue([])
    vi.mocked(getMoActionDealIds).mockResolvedValue(new Set(['mo-action-1']))
    vi.mocked(buildRuleCtx).mockResolvedValue({
      today: new Date(),
      timezone: 'America/New_York',
      stageMap: { s1: 'Active' },
      staleThresholds: {} as never,
      snoozedDealIds: new Set(),
      agreementNoFollowupDays: 2,
      signedNoActivityDays: 5,
      terminalStageIds: new Set(),
    })
    vi.mocked(evaluateAll).mockReturnValue(
      deals.map(d => ({
        deal: d as never,
        flags: [{ type: 'stage_stale', message: 'needs attention', severity: 'warning' as const }],
      }))
    )
    vi.mocked(getEmployeeActivitySummary).mockResolvedValue(null)

    let capturedPrompt = ''
    mockCallClaudeStreaming.mockImplementation((prompt: string) => {
      capturedPrompt = prompt
      return makeEventStream([textDelta('ok')])
    })

    await readStream(await streamBriefingGeneration())

    const moPos = capturedPrompt.indexOf('Mo Action Deal')
    const regularPos = capturedPrompt.indexOf('Regular Deal')
    expect(moPos).toBeGreaterThan(-1)
    expect(regularPos).toBeGreaterThan(-1)
    expect(moPos).toBeLessThan(regularPos)
  })
})
