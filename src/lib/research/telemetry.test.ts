import { describe, it, expect } from 'vitest'
import { normalizeAttempt, normalizeTelemetry } from './telemetry'

describe('normalizeAttempt — freeform shapes from real runs', () => {
  it('maps {method, result, source} obituary web_extract → typed empty', () => {
    const [a] = normalizeAttempt({ method: 'web_extract', result: 'no results', source: 'legacy.com' })
    expect(a).toMatchObject({ sourceId: 'legacy.com', sourceType: 'obituary', status: 'empty' })
  })

  it('infers blocked + people_search from anti-bot prose, splitting multiple hosts', () => {
    const out = normalizeAttempt({
      step: 'people_search',
      result: 'anti-bot blocked — used snippet data',
      source: 'fastpeoplesearch.com, fastbackgroundcheck.com, truepeoplesearch.com',
    })
    expect(out).toHaveLength(3)
    expect(out.map((a) => a.sourceId)).toEqual(['fastpeoplesearch.com', 'fastbackgroundcheck.com', 'truepeoplesearch.com'])
    expect(out.every((a) => a.status === 'blocked' && a.sourceType === 'people_search')).toBe(true)
  })

  it('infers property + success from GIS REST partial result, stripping descriptive suffix', () => {
    const [a] = normalizeAttempt({ step: 'property_lookup', result: 'success', source: 'gismaps.fultoncountyga.gov ArcGIS REST' })
    expect(a).toMatchObject({ sourceId: 'gismaps.fultoncountyga.gov', sourceType: 'property', status: 'success' })
  })

  it('handles {step, source, outcome} obituary scrape success', () => {
    const [a] = normalizeAttempt({ step: 'scrape_obituary', source: 'maxbrannonandsons.com', outcome: 'full family extracted' })
    expect(a).toMatchObject({ sourceId: 'maxbrannonandsons.com', status: 'success', sourceType: 'obituary' })
  })

  it('drops entries with no identifiable source', () => {
    expect(normalizeAttempt({ note: 'thinking out loud' })).toEqual([])
    expect(normalizeAttempt(null)).toEqual([])
  })

  it('recovers host(s) from prose when no source field, filtering internal MCP steps', () => {
    expect(normalizeAttempt({ step: 'next_research_request', result: 'claimed requestId 2' })).toEqual([])
    const out = normalizeAttempt({ step: 'obituary_search', result: 'found maxbrannonandsons.com and legacy.com' })
    expect(out.map((a) => a.sourceId)).toEqual(['maxbrannonandsons.com', 'legacy.com'])
    expect(out.every((a) => a.status === 'success')).toBe(true)
  })
})

describe('normalizeAttempt — typed contract shape passes through', () => {
  it('preserves explicit status/sourceType/blockReason and numeric fields', () => {
    const [a] = normalizeAttempt({
      sourceId: 'qpublic:gordon', sourceType: 'property', status: 'captcha',
      blockReason: 'captcha', url: 'https://qpublic.net', latencyMs: 1200, candidateCount: 3, proxyUsed: true,
    })
    expect(a).toEqual({
      sourceId: 'qpublic:gordon', sourceType: 'property', status: 'captcha',
      blockReason: 'captcha', url: 'https://qpublic.net', latencyMs: 1200, candidateCount: 3, proxyUsed: true,
    })
  })

  it('infers blockReason from prose only when status is blocking', () => {
    const [a] = normalizeAttempt({ source: 'example.gov', result: 'cloudflare challenge', status: 'blocked' })
    expect(a.blockReason).toBe('cloudflare')
    const [b] = normalizeAttempt({ source: 'example.gov', result: 'cloudflare mentioned', status: 'success' })
    expect(b.blockReason).toBeUndefined()
  })
})

describe('normalizeTelemetry', () => {
  it('flattens an array and tolerates non-arrays', () => {
    expect(normalizeTelemetry('nope')).toEqual([])
    const out = normalizeTelemetry([
      { source: 'legacy.com', result: 'no results' },
      { source: 'a.com, b.com', result: 'found' },
    ])
    expect(out).toHaveLength(3)
  })
})
