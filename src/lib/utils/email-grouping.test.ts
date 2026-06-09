import { describe, it, expect } from 'vitest'
import { groupEmailsByCounterparty } from './email-grouping'

type GmailEmail = {
  id: number
  direction: string | null
  happenedAt: string
  metadata: { subject?: string; from?: string; to?: string } | null
  body: string | null
}

function makeEmail(overrides: Partial<GmailEmail> = {}): GmailEmail {
  return {
    id: 1,
    direction: 'inbound',
    happenedAt: '2026-06-05T14:00:00Z',
    metadata: { from: 'Alice <alice@example.com>', to: 'mo@horizon.com', subject: 'RE: Case' },
    body: 'Test body',
    ...overrides,
  }
}

describe('groupEmailsByCounterparty', () => {
  it('returns empty array for no emails', () => {
    expect(groupEmailsByCounterparty([])).toEqual([])
  })

  it('uses "from" for inbound email — display name preferred', () => {
    const groups = groupEmailsByCounterparty([makeEmail({ direction: 'inbound' })])
    expect(groups[0].counterparty).toBe('Alice')
  })

  it('uses "to" for outbound email', () => {
    const groups = groupEmailsByCounterparty([
      makeEmail({ direction: 'outbound', metadata: { from: 'mo@horizon.com', to: 'Bob <bob@law.com>' } }),
    ])
    expect(groups[0].counterparty).toBe('Bob')
  })

  it('falls back to raw email when no display name', () => {
    const groups = groupEmailsByCounterparty([
      makeEmail({ metadata: { from: 'plain@example.com' } }),
    ])
    expect(groups[0].counterparty).toBe('plain@example.com')
  })

  it('uses "Unknown" when metadata is null', () => {
    const groups = groupEmailsByCounterparty([makeEmail({ metadata: null })])
    expect(groups[0].counterparty).toBe('Unknown')
  })

  it('groups multiple emails from the same counterparty', () => {
    const emails = [
      makeEmail({ id: 1, happenedAt: '2026-06-04T10:00:00Z' }),
      makeEmail({ id: 2, happenedAt: '2026-06-05T14:00:00Z' }),
    ]
    const groups = groupEmailsByCounterparty(emails)
    expect(groups).toHaveLength(1)
    expect(groups[0].emails).toHaveLength(2)
    expect(groups[0].count).toBe(2)
  })

  it('creates separate groups for different counterparties', () => {
    const emails = [
      makeEmail({ id: 1, metadata: { from: 'Alice <alice@x.com>' } }),
      makeEmail({ id: 2, metadata: { from: 'Bob <bob@y.com>' } }),
    ]
    const groups = groupEmailsByCounterparty(emails)
    expect(groups).toHaveLength(2)
    expect(groups.map(g => g.counterparty).sort()).toEqual(['Alice', 'Bob'])
  })

  it('sorts groups by most recent email first', () => {
    const emails = [
      makeEmail({ id: 1, happenedAt: '2026-06-01T10:00:00Z', metadata: { from: 'Alice <a@x.com>' } }),
      makeEmail({ id: 2, happenedAt: '2026-06-05T10:00:00Z', metadata: { from: 'Bob <b@y.com>' } }),
    ]
    const groups = groupEmailsByCounterparty(emails)
    expect(groups[0].counterparty).toBe('Bob')
    expect(groups[1].counterparty).toBe('Alice')
  })

  it('takes only the first address from comma-separated "to" field', () => {
    const groups = groupEmailsByCounterparty([
      makeEmail({
        direction: 'outbound',
        metadata: { to: 'Alice <a@x.com>, Bob <b@y.com>' },
      }),
    ])
    expect(groups[0].counterparty).toBe('Alice')
  })
})
