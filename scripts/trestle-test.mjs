// Figure out / test Trestle — Phone Validation (liveness) + Real Contact (phone↔person association).
// Reads TRESTLE_API_KEY from env (never hardcode). ROTATE the trial key shown in the setup screenshot
// first, then add the fresh one to .env.local and run:
//   npx dotenv -e .env.local -- npx vite-node scripts/trestle-test.mjs
//
// Verified endpoints (June 2026):
//   Phone Validation  GET https://api.trestleiq.com/3.2/phone?phone=<E164>            ~$0.015  liveness
//   Real Contact      GET https://api.trestleiq.com/2.0/real_contact?phone=&name=&address.*  ~$0.03  association
// Auth header: x-api-key: <key>

const KEY = process.env.TRESTLE_API_KEY
if (!KEY) {
  console.log('✗ Set TRESTLE_API_KEY in .env.local (rotate the exposed screenshot key first), then re-run.')
  process.exit(0)
}
const H = { 'x-api-key': KEY, Accept: 'application/json' }

async function get(url) {
  const r = await fetch(url, { headers: H })
  const t = await r.text(); let j; try { j = JSON.parse(t) } catch { j = t }
  return { status: r.status, j }
}

// Liveness verdict — Trestle's own rule + our bands (mirrors the plan's quality model).
function liveVerdict(p) {
  if (p.is_valid === false || p.activity_score === 0) return '❌ bad (invalid/disconnected)'
  if (p.is_valid && p.activity_score > 30 && p.line_type !== 'NonFixedVOIP') return '✅ good (live)'
  return '⚠️ uncertain'
}

// ── Phone Validation (liveness) ────────────────────────────────────────────────
// Frugal: only 2 queries (trial = 25/product). One real line + one unallocated/fake number.
const PHONE_TESTS = ['2069735100', '15005550000']
console.log('═══ PHONE VALIDATION ($0.015) — liveness ═══')
let firstPayload = null
for (const phone of PHONE_TESTS) {
  const { status, j } = await get(`https://api.trestleiq.com/3.2/phone?phone=${phone}`)
  if (status !== 200) { console.log(`  ${phone}: HTTP ${status} — ${JSON.stringify(j).slice(0, 250)}`); continue }
  console.log(`  ${phone}: is_valid=${j.is_valid} activity=${j.activity_score} line=${j.line_type} carrier=${j.carrier?.name ?? j.carrier} prepaid=${j.is_prepaid}  → ${liveVerdict(j)}`)
  if (!firstPayload) firstPayload = j
}
if (firstPayload) console.log('\n  full Phone Validation payload:\n', JSON.stringify(firstPayload, null, 1).slice(0, 1400))

// ── Real Contact (association: is this phone the person's?) ─────────────────────
console.log('\n═══ REAL CONTACT ($0.03) — phone ↔ person association ═══')
const params = new URLSearchParams({ phone: '2069735100', name: 'Trestle' /* + address.street_line_1, address.city, address.state_code, address.postal_code */ })
const { status, j } = await get(`https://api.trestleiq.com/2.0/real_contact?${params}`)
if (status !== 200) console.log(`  HTTP ${status}: ${JSON.stringify(j).slice(0, 300)}`)
else {
  const p = j.phone ?? {}
  console.log(`  contact_grade=${p.contact_grade} is_valid=${p.is_valid} activity=${p.activity_score} line=${p.line_type} name_match=${p.name_match}`)
  console.log(`  → association: ${p.name_match ? 'MATCHES the person' : 'does NOT match'} · contactable grade ${p.contact_grade}`)
  console.log('\n  full Real Contact payload:\n', JSON.stringify(j, null, 1).slice(0, 1600))
}
