type GmailEmail = {
  id: number
  direction: string | null
  happenedAt: string
  metadata: { subject?: string; from?: string; to?: string } | null
  body: string | null
}

export type EmailGroup = {
  counterparty: string
  emails: GmailEmail[]
  count: number
  lastDate: string
}

function parseAddress(raw: string): string {
  const match = raw.match(/^(.+?)\s*<[^>]+>$/)
  if (match) return match[1].trim()
  return raw.trim()
}

function getCounterparty(email: GmailEmail): string {
  const meta = email.metadata
  if (!meta) return 'Unknown'
  const field = email.direction === 'outbound' ? (meta.to ?? null) : (meta.from ?? null)
  if (!field) return 'Unknown'
  const first = field.split(',')[0].trim()
  const display = parseAddress(first)
  return display || 'Unknown'
}

export function groupEmailsByCounterparty(emails: GmailEmail[]): EmailGroup[] {
  const map = new Map<string, GmailEmail[]>()
  for (const email of emails) {
    const key = getCounterparty(email)
    const bucket = map.get(key) ?? []
    bucket.push(email)
    map.set(key, bucket)
  }

  return [...map.entries()]
    .map(([counterparty, group]) => {
      const sorted = [...group].sort((a, b) => b.happenedAt.localeCompare(a.happenedAt))
      return {
        counterparty,
        emails: sorted,
        count: sorted.length,
        lastDate: sorted[0].happenedAt,
      }
    })
    .sort((a, b) => b.lastDate.localeCompare(a.lastDate))
}
