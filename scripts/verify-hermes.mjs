// Live smoke test for the Hermes agent write surface (Phase 1.5).
// Run the dev server first, then:
//   npx dotenv -e .env.local -- node scripts/verify-hermes.mjs
// Exercises the real stack (proxy → route → Neon). Self-discovering and self-cleaning:
// every row it creates carries an `idempotency_key` prefixed `verify:` and is deleted at the end.
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const BASE = process.env.HM_BASE_URL || 'http://localhost:3000'
const TOKEN = process.env.HERMES_TOKEN
if (!TOKEN) {
  console.error('HERMES_TOKEN not set — run via: npx dotenv -e .env.local -- node scripts/verify-hermes.mjs')
  process.exit(1)
}
const RUN = Date.now().toString(36)
const CORR = `verify:corr:${RUN}`

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })

const results = []
function check(name, pass, detail = '') {
  results.push({ name, pass })
  console.log(`${pass ? '✓' : '✗'} ${name}${detail ? `  — ${detail}` : ''}`)
}

async function api(method, path, { token = TOKEN, body, idem, corr = CORR } = {}) {
  const headers = { 'content-type': 'application/json' }
  if (token) headers['authorization'] = `Bearer ${token}`
  if (idem) headers['idempotency-key'] = idem
  if (corr) headers['x-correlation-id'] = corr
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    redirect: 'manual',
  })
  let json = null
  try { json = await res.json() } catch { /* 204 / redirect */ }
  return { status: res.status, type: res.type, json }
}
const rejected = (r) => r.status === 401 || r.status === 0 || r.type === 'opaqueredirect' || (r.status >= 300 && r.status < 400)

async function setKillSwitch(value) {
  await prisma.appSetting.upsert({
    where: { key: 'agent_writes_enabled' },
    create: { key: 'agent_writes_enabled', value },
    update: { value },
  })
}

async function main() {
  // Pick a test deal with NO active snooze (so we never disturb a real snooze).
  const active = await prisma.dealSnooze.findMany({
    where: { wokeAt: null, snoozeUntil: { gte: new Date() } },
    select: { dealHubspotId: true },
  })
  const blocked = new Set(active.map((s) => s.dealHubspotId))
  const deals = await prisma.deal.findMany({ select: { hubspotId: true, name: true }, take: 100 })
  if (!deals.length) throw new Error('no deals in DB to test against')
  const deal = deals.find((d) => !blocked.has(d.hubspotId)) ?? deals[0]
  const DEAL = deal.hubspotId
  const aPath = `/api/deals/${DEAL}/analysis`
  console.log(`\nTest deal: ${DEAL} (${deal.name ?? 'unnamed'})\n`)

  const base = {
    health: 'blocked', priority: 'normal', statusLabel: 'VERIFY blocked state',
    blockers: ['VERIFY blocker'], recommendations: ['VERIFY next'], nextAction: 'VERIFY next',
    moActionRequired: false, generatedFrom: 'verify-script',
  }

  // T1 — auth matrix
  const noTok = await api('POST', aPath, { token: null, body: base, idem: `verify:auth0:${RUN}` })
  check('auth: no token → rejected', rejected(noTok), `status ${noTok.status} type ${noTok.type}`)
  const badTok = await api('POST', aPath, { token: 'wrong', body: base, idem: `verify:auth1:${RUN}` })
  check('auth: bad token → rejected', rejected(badTok), `status ${badTok.status}`)
  const okTok = await api('POST', aPath, { body: base, idem: `verify:auth2:${RUN}` })
  check('auth: valid token → 201', okTok.status === 201, `status ${okTok.status}`)
  check('source tagging: source=agent, actor=hermes', okTok.json?.source === 'agent' && okTok.json?.actor === 'hermes',
    `${okTok.json?.source}/${okTok.json?.actor}`)

  // T2 — append-only (two distinct rows, no overwrite)
  await api('POST', aPath, { body: { ...base, statusLabel: 'VERIFY second' }, idem: `verify:append:${RUN}` })
  const hist = await api('GET', `${aPath}?type=triage`, {})
  const mine = (hist.json?.analyses ?? []).filter((a) => a.idempotencyKey?.startsWith(`verify:`) && a.idempotencyKey.includes(RUN))
  check('append-only: ≥2 distinct verify rows in history', mine.length >= 2, `found ${mine.length}`)

  // T3 — idempotency
  const k = `verify:idem:${RUN}`
  const first = await api('POST', aPath, { body: base, idem: k })
  const second = await api('POST', aPath, { body: base, idem: k })
  check('idempotency: replay returns same row', first.json?.id && first.json.id === second.json?.id,
    `${first.json?.id} vs ${second.json?.id}`)
  const dupCount = await prisma.caseAnalysis.count({ where: { idempotencyKey: k } })
  check('idempotency: exactly one row for the key', dupCount === 1, `count ${dupCount}`)

  // T4 — enum guard
  const bad = await api('POST', aPath, { body: { ...base, health: 'weird' }, idem: `verify:enum:${RUN}` })
  check('enum guard: health="weird" → 400', bad.status === 400, `status ${bad.status}`)

  // T5 — tasks
  const t1 = await api('POST', `/api/tasks`, { body: { title: 'VERIFY task', category: 'case', dealHubspotId: DEAL }, idem: `verify:task:${RUN}` })
  check('task: create → 201 source=hermes', t1.status === 201 && t1.json?.source === 'hermes', `status ${t1.status} source ${t1.json?.source}`)
  const t2 = await api('POST', `/api/tasks`, { body: { title: 'VERIFY task', category: 'case', dealHubspotId: DEAL }, idem: `verify:task:${RUN}` })
  check('task: idempotent replay → same id', t1.json?.id && t1.json.id === t2.json?.id, `${t1.json?.id} vs ${t2.json?.id}`)

  // T6 — snooze + unsnooze
  const future = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10)
  const sn = await api('POST', `/api/deals/${DEAL}/snooze`, { body: { category: 'other', snoozeUntil: future }, idem: `verify:snooze:${RUN}` })
  check('snooze: create → 200 ok', sn.status === 200 && sn.json?.ok === true, `status ${sn.status}`)
  const un = await api('DELETE', `/api/deals/${DEAL}/snooze`, {})
  check('snooze: remove → 200 ok', un.status === 200, `status ${un.status}`)

  // T7 — audit trail
  const audits = await prisma.agentAuditLog.findMany({ where: { correlationId: CORR } })
  const hasAfter = audits.some((a) => a.after != null)
  check('audit: rows written with correlationId + after payload', audits.length >= 3 && hasAfter, `${audits.length} rows`)

  // T8 — kill switch (do last; restored in cleanup)
  await setKillSwitch('false')
  const locked = await api('POST', aPath, { body: base, idem: `verify:kill:${RUN}` })
  check('kill switch OFF → 423', locked.status === 423, `status ${locked.status}`)
  await setKillSwitch('true')
  const unlocked = await api('POST', aPath, { body: base, idem: `verify:kill2:${RUN}` })
  check('kill switch ON → 201', unlocked.status === 201, `status ${unlocked.status}`)
}

async function cleanup() {
  const where = { idempotencyKey: { startsWith: 'verify:' } }
  const [a, t, s, l] = await Promise.all([
    prisma.caseAnalysis.deleteMany({ where }),
    prisma.internalTask.deleteMany({ where }),
    prisma.dealSnooze.deleteMany({ where }),
    prisma.agentAuditLog.deleteMany({ where: { OR: [{ idempotencyKey: { startsWith: 'verify:' } }, { correlationId: CORR }] } }),
  ])
  // Return the kill switch to default (unset = enabled).
  await prisma.appSetting.deleteMany({ where: { key: 'agent_writes_enabled' } })
  console.log(`\ncleanup: removed ${a.count} analyses, ${t.count} tasks, ${s.count} snoozes, ${l.count} audit rows; kill switch reset to default-on`)
}

let failed = 0
try {
  await main()
} catch (err) {
  console.error('\nERROR:', err.message)
  failed = 1
} finally {
  try { await cleanup() } catch (e) { console.error('cleanup failed:', e.message) }
  await prisma.$disconnect()
}

const passed = results.filter((r) => r.pass).length
const total = results.length
console.log(`\n${passed}/${total} checks passed`)
if (passed !== total) failed = 1
process.exit(failed)
