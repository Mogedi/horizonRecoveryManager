// Controlled extraction A/B: Haiku 4.5 vs Sonnet 4.6 on the SAME Georgia source text.
//
// Why this exists: we route web_extract/triage/etc. to Haiku to cut cost. Before trusting that on
// real cases, we need a CLEAN answer to "does Haiku miss or fabricate fields vs Sonnet?" We can't
// replay past agent runs (evidence packages store the extracted value + a one-line quote, NOT the raw
// page that was fed to extraction), and live re-runs are noisy + slow + cost money. So instead we feed
// identical fixed source text to both models and score against hand-verified answers. This isolates the
// extraction model perfectly — no live-site variance, runs in minutes, costs pennies.
//
// The gold set deliberately includes:
//   • hallucination probes  — fields ABSENT from the source (expected = null). Filling them = fabrication.
//   • mis-attribution probes — grantor vs grantee, predeceased vs surviving, multi-parcel records.
//   • a long/messy record    — the documented weak spot for small models (long inputs).
//
//   npx dotenv -e .env.local -- npx vite-node scripts/extraction-eval.mjs
//   RUNS=3 npx dotenv -e .env.local -- npx vite-node scripts/extraction-eval.mjs   # repeat for stability

import { callClaude } from './src/lib/ai/client.ts'

const MODELS = { haiku: 'claude-haiku-4-5', sonnet: 'claude-sonnet-4-6' }
const RUNS = Number(process.env.RUNS || 1)

// ── Gold set ──────────────────────────────────────────────────────────────────────────────────────
// source: realistic GA record text. fields: what to extract (name → description). expected: verified
// answer; null means "not stated in the source" (a hallucination probe).
const GOLD = [
  {
    id: 'prop-full', kind: 'property',
    source: `Parcel: 076C 012A
Owner: BURCHETT TAMMY L
Site Address: 235 WHIPPORWILL LN SE, CALHOUN, GA 30701
Deed Book/Page: 1492/127
Sale Date: 03/14/2007   Sale Price: $112,500
2025 Assessed Value: $98,400
Land Use: Residential`,
    fields: { owner: 'current owner name', parcelId: 'parcel number', situs: 'site/situs address',
      deedBook: 'deed book', deedPage: 'deed page', saleDate: 'sale date', salePrice: 'sale price as number',
      assessedValue: 'assessed value as number' },
    expected: { owner: 'BURCHETT TAMMY L', parcelId: '076C 012A', situs: '235 WHIPPORWILL LN SE, CALHOUN, GA 30701',
      deedBook: '1492', deedPage: '127', saleDate: '03/14/2007', salePrice: 112500, assessedValue: 98400 },
  },
  {
    id: 'prop-no-saleprice', kind: 'property', // HALLUCINATION PROBE: no sale price in source
    source: `Parcel ID: 12-345-09-001
Owner of Record: JOHNSON ROBERT & MARY
Property Address: 14 OAK RIDGE DR, ROME, GA 30161
Most Recent Deed: Book 0884 Page 0455
Fair Market Value (2025): $173,200`,
    fields: { owner: 'owner of record', parcelId: 'parcel id', deedBook: 'deed book', deedPage: 'deed page',
      salePrice: 'sale price as number, or null if not stated', assessedValue: 'fair market / assessed value as number' },
    expected: { owner: 'JOHNSON ROBERT & MARY', parcelId: '12-345-09-001', deedBook: '0884', deedPage: '0455',
      salePrice: null, assessedValue: 173200 },
  },
  {
    id: 'deed-grantor-grantee', kind: 'deed', // MIS-ATTRIBUTION PROBE: who sold vs who bought
    source: `TAX SALE DEED — Gordon County, GA
Grantor: BURCHETT TAMMY L
Grantee: SOUTHERN DEED CO LLC
Consideration: $4,210.00
Recorded: 08/02/2025  Instrument 2025-007841
Property: 235 WHIPPORWILL LN SE`,
    fields: { seller: 'grantor (the party transferring/losing the property)', buyer: 'grantee (the party acquiring)',
      amount: 'consideration amount as number', recordedDate: 'recorded date' },
    expected: { seller: 'BURCHETT TAMMY L', buyer: 'SOUTHERN DEED CO LLC', amount: 4210, recordedDate: '08/02/2025' },
  },
  {
    id: 'obit-survivors', kind: 'obituary',
    source: `Mary Ellen Burchett, 78, of Calhoun, passed away March 1, 2025. She is survived by her daughter
Tammy Burchett of Calhoun; her son James Burchett of Dalton; and three grandchildren. She was preceded in
death by her husband, Carl Burchett, and a brother, Wayne Meeks.`,
    fields: { decedent: 'name of the deceased', survivors: 'array of names of people who SURVIVE the decedent',
      predeceased: 'array of names who PRECEDED the decedent in death' },
    expected: { decedent: 'Mary Ellen Burchett', survivors: ['Tammy Burchett', 'James Burchett'],
      predeceased: ['Carl Burchett', 'Wayne Meeks'] },
  },
  {
    id: 'obit-no-age', kind: 'obituary', // HALLUCINATION PROBE: age not stated
    source: `Services for Robert L. Johnson of Rome will be held Saturday. Mr. Johnson is survived by his wife
Mary Johnson and a daughter, Linda Carter of Atlanta.`,
    fields: { decedent: 'name of deceased', age: 'age as number, or null if not stated',
      survivors: 'array of surviving names' },
    expected: { decedent: 'Robert L. Johnson', age: null, survivors: ['Mary Johnson', 'Linda Carter'] },
  },
  {
    id: 'people-search', kind: 'people_search',
    source: `TAMMY L BURCHETT, Age 54
Current: Calhoun, GA
Past: Dalton, GA · Resaca, GA
Relatives: James Burchett, Carl Burchett, Wayne Meeks
Associated phone: (706) 555-0182`,
    fields: { name: 'person name', age: 'age as number', currentCity: 'current city',
      relatives: 'array of relative names', phone: 'phone number' },
    expected: { name: 'TAMMY L BURCHETT', age: 54, currentCity: 'Calhoun, GA',
      relatives: ['James Burchett', 'Carl Burchett', 'Wayne Meeks'], phone: '(706) 555-0182' },
  },
  {
    id: 'people-no-phone', kind: 'people_search', // HALLUCINATION PROBE: no phone
    source: `ROBERT JOHNSON, Age 61, Rome GA. Relatives: Mary Johnson, Linda Carter.`,
    fields: { name: 'name', age: 'age as number', phone: 'phone number, or null if not stated',
      relatives: 'array of relative names' },
    expected: { name: 'ROBERT JOHNSON', age: 61, phone: null, relatives: ['Mary Johnson', 'Linda Carter'] },
  },
  {
    id: 'lien-released', kind: 'lien', // distinction probe: active vs released
    source: `Lien Record — Floyd County
Lienholder: GEORGIA DEPT OF REVENUE
Debtor: ROBERT JOHNSON
Amount: $8,940.12
Filed: 02/2019   Status: RELEASED 11/2021`,
    fields: { lienholder: 'lienholder', amount: 'amount as number', released: 'true if the lien is released, false if active' },
    expected: { lienholder: 'GEORGIA DEPT OF REVENUE', amount: 8940.12, released: true },
  },
  {
    id: 'multi-parcel', kind: 'property', // LONG/MESSY PROBE: pick the right parcel among several
    source: `Search results (3 parcels):
[1] Parcel 011A 003  Owner: SMITH JOHN  Addr: 1 PINE ST  Book/Page 0500/012
[2] Parcel 076C 012A  Owner: BURCHETT TAMMY L  Addr: 235 WHIPPORWILL LN SE  Book/Page 1492/127
[3] Parcel 220B 119  Owner: WILSON ANN  Addr: 9 ELM AVE  Book/Page 1101/880
Extract the parcel for OWNER = BURCHETT TAMMY L only.`,
    fields: { parcelId: 'parcel for Burchett Tammy L', deedBook: 'deed book for that parcel', deedPage: 'deed page for that parcel' },
    expected: { parcelId: '076C 012A', deedBook: '1492', deedPage: '127' },
  },
  {
    id: 'name-order', kind: 'property', // normalization: surname-first vs given-first
    source: `Owner Name (as recorded): BURCHETT, TAMMY L
Parcel: 076C 012A`,
    fields: { firstName: 'given/first name (exclude middle initial)', lastName: 'surname/last name', parcelId: 'parcel' },
    expected: { firstName: 'TAMMY', lastName: 'BURCHETT', parcelId: '076C 012A' },
  },
]

// ── Scoring ───────────────────────────────────────────────────────────────────────────────────────
const norm = (v) => String(v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
const isEmpty = (v) => v == null || v === '' || (Array.isArray(v) && v.length === 0)

function matchScalar(exp, got) {
  if (typeof exp === 'number') {
    const g = typeof got === 'number' ? got : Number(String(got).replace(/[^0-9.]/g, ''))
    return Number.isFinite(g) && Math.abs(g - exp) < 0.005
  }
  if (typeof exp === 'boolean') return Boolean(got) === exp
  return norm(exp) === norm(got)
}

// returns one of: 'correct' | 'miss' | 'wrong' | 'halluc'
function gradeField(exp, got) {
  if (exp === null) return isEmpty(got) ? 'correct' : 'halluc' // absent field — filling it is fabrication
  if (isEmpty(got)) return 'miss'
  if (Array.isArray(exp)) {
    const g = Array.isArray(got) ? got : [got]
    const expN = exp.map(norm), gotN = g.map(norm)
    const hit = expN.filter((e) => gotN.some((x) => x.includes(e) || e.includes(x))).length
    const extra = gotN.filter((x) => !expN.some((e) => x.includes(e) || e.includes(x))).length
    if (hit === exp.length && extra === 0) return 'correct'
    if (extra > 0 && hit < exp.length) return 'wrong'
    if (extra > 0) return 'halluc' // invented extra survivors/relatives — a real failure mode
    return 'miss' // missed some
  }
  return matchScalar(exp, got) ? 'correct' : 'wrong'
}

function extractJson(text) {
  const m = text.match(/\{[\s\S]*\}/)
  if (!m) return {}
  try { return JSON.parse(m[0]) } catch { return {} }
}

const SYSTEM = 'You extract structured data from public records. Return ONLY valid JSON. ' +
  'Use null for any field NOT explicitly stated in the source. Never guess or infer values that are not present.'

function buildPrompt(item) {
  const fieldLines = Object.entries(item.fields).map(([k, d]) => `  "${k}": ${d}`).join('\n')
  return `SOURCE:\n"""\n${item.source}\n"""\n\nExtract these fields as a JSON object:\n${fieldLines}\n\nReturn only the JSON object.`
}

// ── Run ───────────────────────────────────────────────────────────────────────────────────────────
const tally = { haiku: {}, sonnet: {} }
const init = () => ({ correct: 0, miss: 0, wrong: 0, halluc: 0, total: 0 })
for (const m of Object.keys(MODELS)) tally[m] = init()
const byKind = {} // kind -> { haiku:{...}, sonnet:{...} }
const failures = [] // notable disagreements to print

for (const item of GOLD) {
  byKind[item.kind] ??= { haiku: init(), sonnet: init() }
  for (const [mName, mId] of Object.entries(MODELS)) {
    // aggregate grades across RUNS (take worst grade per field to surface instability)
    const fieldGrades = {}
    for (let r = 0; r < RUNS; r++) {
      const raw = await callClaude(buildPrompt(item), SYSTEM, 800, mId)
      const out = extractJson(raw)
      for (const f of Object.keys(item.expected)) {
        const g = gradeField(item.expected[f], out[f])
        const rank = { correct: 0, miss: 1, wrong: 2, halluc: 3 }
        if (fieldGrades[f] == null || rank[g] > rank[fieldGrades[f].grade])
          fieldGrades[f] = { grade: g, got: out[f] }
      }
    }
    for (const f of Object.keys(item.expected)) {
      const { grade, got } = fieldGrades[f]
      tally[mName][grade]++; tally[mName].total++
      byKind[item.kind][mName][grade]++; byKind[item.kind][mName].total++
      if (grade !== 'correct')
        failures.push({ item: item.id, model: mName, field: f, grade, expected: item.expected[f], got })
    }
  }
}

// ── Report ────────────────────────────────────────────────────────────────────────────────────────
const pct = (t) => t.total ? ((t.correct / t.total) * 100).toFixed(0) + '%' : '–'
const line = (m, t) => `  ${m.padEnd(7)} acc ${pct(t).padStart(4)}  | correct ${t.correct}  miss ${t.miss}  wrong ${t.wrong}  HALLUC ${t.halluc}  (n=${t.total})`

console.log(`\n══════ EXTRACTION A/B  ·  Haiku 4.5 vs Sonnet 4.6  ·  ${GOLD.length} items × ${RUNS} run(s) ══════\n`)
console.log('OVERALL')
console.log(line('haiku', tally.haiku))
console.log(line('sonnet', tally.sonnet))

console.log('\nBY KIND')
for (const [k, v] of Object.entries(byKind)) {
  console.log(`  ${k}`)
  console.log('  ' + line('haiku', v.haiku))
  console.log('  ' + line('sonnet', v.sonnet))
}

if (failures.length) {
  console.log('\nDISAGREEMENTS / FAILURES (expected → got)')
  for (const f of failures)
    console.log(`  [${f.model}] ${f.item}.${f.field}  ${f.grade.toUpperCase()}: ${JSON.stringify(f.expected)} → ${JSON.stringify(f.got)}`)
} else {
  console.log('\nNo failures on either model.')
}

// ── Verdict ───────────────────────────────────────────────────────────────────────────────────────
const h = tally.haiku, s = tally.sonnet
const accGap = (s.correct / s.total) - (h.correct / h.total)
console.log('\nVERDICT')
console.log(`  accuracy gap (sonnet − haiku): ${(accGap * 100).toFixed(1)} pts`)
console.log(`  haiku hallucinations: ${h.halluc}   sonnet hallucinations: ${s.halluc}`)
if (h.halluc > s.halluc + 1) console.log('  ⚠ Haiku fabricates more than Sonnet — investigate before trusting on extraction.')
else if (accGap > 0.15) console.log('  ⚠ Haiku is >15pts less accurate — consider keeping extraction on Sonnet.')
else console.log('  ✓ Haiku tracks Sonnet within tolerance on this set — routing extraction to Haiku looks safe.')
console.log('\n(Representative gold set; treat as a smoke test. Re-run with RUNS=3 for stability.)\n')
