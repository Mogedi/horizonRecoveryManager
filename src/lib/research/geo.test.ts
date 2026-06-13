import { describe, it, expect, vi, afterEach } from 'vitest'
import { resolveCounty } from './geo'

afterEach(() => vi.unstubAllGlobals())

describe('resolveCounty', () => {
  it('extracts the county and strips the "County" suffix', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ result: { addressMatches: [{ addressComponents: { state: 'GA' }, geographies: { Counties: [{ BASENAME: 'Upson', NAME: 'Upson County' }] } }] } }),
    })))
    expect(await resolveCounty('42 Edgewood Ave, Thomaston, GA')).toEqual({ county: 'Upson', state: 'GA' })
  })

  it('returns null when there is no match', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ result: { addressMatches: [] } }) })))
    expect(await resolveCounty('nowhere')).toBeNull()
  })

  it('returns null on a network/HTTP error instead of throwing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })))
    expect(await resolveCounty('x')).toBeNull()
  })
})
