import pg from 'pg'
const c=new pg.Client({connectionString:process.env.DATABASE_URL}); await c.connect()
console.log('\n### By source TYPE (success / block rate)')
console.table((await c.query(`SELECT source_type,
  count(*)::int attempts,
  round(100.0*count(*) FILTER(WHERE status='success')/count(*))::int||'%' success,
  round(100.0*count(*) FILTER(WHERE status IN('blocked','captcha'))/count(*))::int||'%' blocked
  FROM source_attempts GROUP BY source_type ORDER BY attempts DESC`)).rows)
console.log('\n### People-search hosts (the Browser-Use-scoped sources)')
console.table((await c.query(`SELECT source_id, status, count(*)::int n FROM source_attempts
  WHERE source_type='people_search' GROUP BY source_id,status ORDER BY n DESC`)).rows)
await c.end()
