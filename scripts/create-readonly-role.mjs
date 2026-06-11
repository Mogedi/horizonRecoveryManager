// Create (or refresh) a SELECT-only Neon role for Hermes reads, wire DATABASE_URL_READONLY into
// .env.local, and verify it. Run: npx dotenv -e .env.local -- node scripts/create-readonly-role.mjs
// Idempotent. Reversible: DROP ROLE hermes_reader;
import pg from 'pg'
import { randomBytes } from 'node:crypto'
import { appendFileSync, readFileSync } from 'node:fs'

const ROLE = 'hermes_reader'
const owner = process.env.DIRECT_URL || process.env.DATABASE_URL // privileged
const pooled = process.env.DATABASE_URL // preferred for the read-only conn string (pooled)
if (!owner || !pooled) {
  console.error('DIRECT_URL and DATABASE_URL must be set (run via dotenv -e .env.local)')
  process.exit(1)
}
const password = randomBytes(24).toString('hex') // hex — safe to inline in SQL and a URL
const dbName = new URL(pooled).pathname.replace(/^\//, '') || 'neondb'

const ddl = `
DO $$BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname='${ROLE}') THEN
    ALTER ROLE ${ROLE} WITH LOGIN PASSWORD '${password}';
  ELSE
    CREATE ROLE ${ROLE} WITH LOGIN PASSWORD '${password}';
  END IF;
END$$;
GRANT CONNECT ON DATABASE ${dbName} TO ${ROLE};
GRANT USAGE ON SCHEMA public TO ${ROLE};
GRANT SELECT ON ALL TABLES IN SCHEMA public TO ${ROLE};
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO ${ROLE};
`

function roUrl(baseConnStr) {
  const u = new URL(baseConnStr)
  u.username = ROLE
  u.password = password
  return u.toString()
}

async function verify(url) {
  const c = new pg.Client({ connectionString: url })
  await c.connect()
  try {
    const sel = await c.query('SELECT count(*)::int AS n FROM deals')
    let insertRejected = false
    try {
      await c.query(`INSERT INTO app_settings(key,value) VALUES('__ro_probe__','x')`)
    } catch {
      insertRejected = true
    }
    return { dealCount: sel.rows[0].n, insertRejected }
  } finally {
    await c.end()
  }
}

// 1) create/refresh the role + grants
const admin = new pg.Client({ connectionString: owner })
await admin.connect()
await admin.query(ddl)
await admin.end()
console.log(`role ${ROLE}: created/updated, granted SELECT on all tables in public`)

// 2) verify — prefer the pooled host; fall back to the direct host if the pooler rejects the role
let readonlyUrl = roUrl(pooled)
let result
try {
  result = await verify(readonlyUrl)
} catch (e) {
  console.log(`pooled host failed (${e.message.split('\n')[0]}); falling back to direct host`)
  readonlyUrl = roUrl(owner)
  result = await verify(readonlyUrl)
}

if (!result.insertRejected) {
  console.error('✗ ABORT: INSERT was NOT rejected — the role has write access. Not writing env.')
  process.exit(2)
}
console.log(`verified: SELECT ok (deals=${result.dealCount}), INSERT denied ✓`)

// 3) wire into .env.local (secret not printed)
const env = readFileSync('.env.local', 'utf8')
if (/^DATABASE_URL_READONLY=/m.test(env)) {
  console.log('note: DATABASE_URL_READONLY already in .env.local — leaving it; role password was rotated, update manually if needed')
} else {
  appendFileSync('.env.local', `\n# Read-only Neon role for Hermes reads (SELECT-only)\nDATABASE_URL_READONLY=${readonlyUrl}\n`)
  console.log('DATABASE_URL_READONLY written to .env.local (value not printed)')
}
console.log('\n✅ read-only role ready')
