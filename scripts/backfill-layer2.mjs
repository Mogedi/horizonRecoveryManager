// One-time Layer 2 backfill across all deals — populates deal_contacts (incl. emails) + activities,
// which fixes Gmail→deal matching. Runs against a local dev server (no Vercel timeout).
//   1) npm run dev:log   2) npx dotenv -e .env.local -- node scripts/backfill-layer2.mjs
// Idempotent (replaceLayer2Data); safe to re-run. ~7-9 HubSpot calls/deal, self-throttled at 3 req/s.
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const BASE = process.env.HM_BASE_URL || 'http://localhost:3000'
const pw = process.env.DASHBOARD_PASSWORD
if (!pw) {
  console.error('DASHBOARD_PASSWORD not set')
  process.exit(1)
}

// Log in to get a session cookie (the Layer 2 route requires it).
const loginRes = await fetch(BASE + '/api/auth/login', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ password: pw }),
})
const cookie = loginRes.headers.get('set-cookie')?.split(';')[0]
if (!loginRes.ok || !cookie) {
  console.error('login failed:', loginRes.status, await loginRes.text().catch(() => ''))
  process.exit(1)
}
console.log('logged in ✓')

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })
const deals = await prisma.deal.findMany({ select: { hubspotId: true, name: true } })
await prisma.$disconnect()
console.log(`backfilling Layer 2 for ${deals.length} deals...`)

let ok = 0
let fail = 0
for (const d of deals) {
  try {
    const res = await fetch(`${BASE}/api/sync/layer2/${d.hubspotId}`, { method: 'POST', headers: { cookie } })
    if (res.ok) ok++
    else {
      fail++
      console.log(`  ✗ ${d.hubspotId} (${d.name ?? ''}): ${res.status}`)
    }
  } catch (e) {
    fail++
    console.log(`  ✗ ${d.hubspotId}: ${e.message}`)
  }
  if ((ok + fail) % 10 === 0) console.log(`  ${ok + fail}/${deals.length} — ok ${ok}, fail ${fail}`)
  await new Promise((r) => setTimeout(r, 300))
}
console.log(`\nDONE — ok ${ok}, fail ${fail}`)
