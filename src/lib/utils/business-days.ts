const TIMEZONE = 'America/New_York'

// Get the Eastern timezone calendar date (year/month/day) for a UTC timestamp,
// then return a stable noon-UTC representation of that Eastern calendar date.
// Using noon UTC avoids DST boundary issues: noon UTC is always daytime in ET.
function toEasternNoon(date: Date): Date {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)

  const y = parts.find(p => p.type === 'year')!.value
  const m = parts.find(p => p.type === 'month')!.value
  const d = parts.find(p => p.type === 'day')!.value

  return new Date(`${y}-${m}-${d}T12:00:00Z`)
}

function isWeekendInEastern(date: Date): boolean {
  const day = new Intl.DateTimeFormat('en-US', {
    timeZone: TIMEZONE,
    weekday: 'short',
  }).format(date)
  return day === 'Sat' || day === 'Sun'
}

// Count business days elapsed from `from` to `until` in America/New_York.
// Counts the business days in (from, until] — exclusive of from, inclusive of until.
// Returns 0 if until <= from.
export function businessDaysElapsed(from: Date, until: Date): number {
  const start = toEasternNoon(from)
  const end = toEasternNoon(until)

  if (end <= start) return 0

  let count = 0
  const current = new Date(start)
  current.setUTCDate(current.getUTCDate() + 1)

  while (current <= end) {
    if (!isWeekendInEastern(current)) {
      count++
    }
    current.setUTCDate(current.getUTCDate() + 1)
  }

  return count
}
