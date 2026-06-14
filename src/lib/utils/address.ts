// Parse a full US address string into parts. Best-effort: the research form takes ONE "property
// address" field (Mo types the whole thing); we parse out city/state/zip so county lookups and the
// agent get structured anchors. The original full string is always kept as line context too.
// Anything we can't parse stays undefined — the caller decides whether to ask for it.

export interface ParsedAddress {
  line1: string // street (best guess) — falls back to the whole input
  city?: string
  state?: string // 2-letter, uppercased
  zip?: string
  full: string // the original input, trimmed
}

// Only treat a trailing 2-letter token as a state if it's a real USPS code — otherwise "301 Lowell St"
// parses "St" as a state. (Georgia-first business, but the full set keeps it correct everywhere.)
const US_STATES = new Set('AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC'.split(' '))
const isState = (s: string) => US_STATES.has(s.toUpperCase())
const STATE_RE = /^([A-Za-z]{2})(?:\s+(\d{5}(?:-\d{4})?))?$/ // "GA" or "GA 30310"

export function parseAddress(input?: string | null): ParsedAddress {
  const full = (input ?? '').trim()
  if (!full) return { line1: '', full }

  // Pull a trailing zip if it's the last token, even without a comma ("... Atlanta GA 30310").
  let working = full
  let zip: string | undefined
  const zipMatch = working.match(/\b(\d{5}(?:-\d{4})?)\s*$/)
  if (zipMatch) { zip = zipMatch[1]; working = working.slice(0, zipMatch.index).trim() }

  // Trailing 2-letter state ("... Atlanta GA") — only if it's a real state code (not "St").
  let state: string | undefined
  const stateTail = working.match(/[,\s]([A-Za-z]{2})\s*$/)
  if (stateTail && isState(stateTail[1])) { state = stateTail[1].toUpperCase(); working = working.slice(0, stateTail.index).trim() }

  const parts = working.split(',').map(p => p.trim()).filter(Boolean)
  // Comma-style: "301 Lowell St, Atlanta, GA 30310" → after stripping zip/state, ["301 Lowell St","Atlanta"].
  if (parts.length >= 2) {
    const city = parts[parts.length - 1]
    const line1 = parts.slice(0, -1).join(', ')
    // Guard: if the "city" still looks like a state token, treat it as state instead.
    const m = city.match(STATE_RE)
    if (m && isState(m[1]) && !state) { state = m[1].toUpperCase(); zip = zip ?? m[2]; return { line1, full, ...(state && { state }), ...(zip && { zip }) } }
    return { line1, city, full, ...(state && { state }), ...(zip && { zip }) }
  }

  // No comma left — can't reliably split street from city; keep the remainder as line1.
  return { line1: working || full, full, ...(state && { state }), ...(zip && { zip }) }
}
