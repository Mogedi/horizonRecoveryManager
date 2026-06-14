// One-off backfill: fan existing evidence_packages.telemetry → source_attempts.
// Faithful port of src/lib/research/telemetry.ts (one-off; runtime path uses the TS module).
import pg from 'pg'
const ATTEMPT=['success','blocked','captcha','empty','error']
const TYPES=['obituary','people_search','property','government','crm','probate','funeral','other']
const REASONS=['cloudflare','captcha','http_403','http_429','redirect','empty','parse']
const str=v=>typeof v==='string'?v:''
const splitHosts=r=>r.split(/[,;]| and /i).map(s=>s.trim().split(/\s+/)[0]).filter(Boolean)
const inferStatus=p=>{p=p.toLowerCase()
  if(/captcha/.test(p))return'captcha'
  if(/block|anti-?bot|cloudflare|\b403\b|denied|forbidden/.test(p))return'blocked'
  if(/error|fail|exception|timeout|\b5\d\d\b/.test(p))return'error'
  if(/success|found|confirmed|extracted|partial/.test(p))return'success'
  return'empty'}
const inferReason=p=>{p=p.toLowerCase()
  if(/cloudflare/.test(p))return'cloudflare'; if(/captcha/.test(p))return'captcha'
  if(/\b403\b/.test(p))return'http_403'; if(/\b429\b/.test(p))return'http_429'; return null}
const inferType=(h,p)=>{const s=`${h} ${p}`.toLowerCase()
  if(/funeral/.test(s))return'funeral'
  if(/obit|legacy\.com|findagrave|tributes|dignitymemorial/.test(s))return'obituary'
  if(/peoplesearch|fastpeople|truepeople|backgroundcheck|whitepages|spokeo|people_search/.test(s))return'people_search'
  if(/probate|estate/.test(s))return'probate'
  if(/gis|qpublic|assessor|parcel|property|propertyradar|beacon|schneider/.test(s))return'property'
  if(/\.gov|county|court|clerk|recorder|tax/.test(s))return'government'
  if(/crm|hubspot/.test(s))return'crm'; return'other'}
const extractDomains=p=>[...new Set([...p.matchAll(/\b((?:[a-z0-9-]+\.)+[a-z]{2,})\b/gi)].map(m=>m[1].toLowerCase()))]
function normEntry(e){
  if(!e||typeof e!=='object')return[]
  const prose=[e.result,e.outcome,e.note,e.method,e.step,ATTEMPT.includes(e.status)?'':e.status].map(str).filter(Boolean).join(' ')
  const sf=str(e.sourceId)||str(e.source)
  const hosts=sf?splitHosts(sf):extractDomains(prose); if(!hosts.length)return[]
  const status=ATTEMPT.includes(e.status)?e.status:inferStatus(prose)
  const blockReason=REASONS.includes(e.blockReason)?e.blockReason:((status==='blocked'||status==='captcha')?inferReason(prose):null)
  return hosts.map(h=>({sourceId:h,sourceType:TYPES.includes(e.sourceType)?e.sourceType:inferType(h,prose),
    status,blockReason,url:str(e.url)||null,latencyMs:typeof e.latencyMs==='number'?e.latencyMs:0,
    candidateCount:typeof e.candidateCount==='number'?e.candidateCount:0,proxyUsed:e.proxyUsed===true}))}

const c=new pg.Client({connectionString:process.env.DATABASE_URL}); await c.connect()
const existing=(await c.query('SELECT count(*)::int n FROM source_attempts')).rows[0].n
if(existing>0){console.log(`source_attempts already has ${existing} rows — aborting backfill to avoid dupes.`);await c.end();process.exit(0)}
const pkgs=(await c.query('SELECT id, request_id, case_id, telemetry FROM evidence_packages ORDER BY id')).rows
let total=0
for(const pkg of pkgs){
  const tel=Array.isArray(pkg.telemetry)?pkg.telemetry:[]
  const attempts=tel.flatMap(normEntry)
  for(const a of attempts){
    await c.query(
      `INSERT INTO source_attempts (source_id,source_type,request_id,case_id,status,block_reason,url,latency_ms,candidate_count,proxy_used)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [a.sourceId,a.sourceType,pkg.request_id,pkg.case_id,a.status,a.blockReason,a.url,a.latencyMs,a.candidateCount,a.proxyUsed])
    total++
  }
  console.log(`pkg ${pkg.id}: +${attempts.length} attempts`)
}
console.log(`\nBackfilled ${total} source attempts from ${pkgs.length} packages.`)
await c.end()
