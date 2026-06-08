export function formatAmount(n: number | null): string {
  if (n === null) return ''
  return '$' + Math.round(n).toLocaleString('en-US')
}

export function relativeDate(dateStr: string | Date | null | undefined): string {
  if (!dateStr) return '—'
  const diffMs = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diffMs / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days}d ago`
  return `${Math.floor(days / 30)}mo ago`
}

export function formatDate(
  dateStr: string | Date | null | undefined,
  opts?: Intl.DateTimeFormatOptions
): string {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleDateString('en-US', {
    timeZone: 'America/New_York',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    ...opts,
  })
}
