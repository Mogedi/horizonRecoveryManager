// Fetch a URL and extract readable text. SSRF-guarded: only public http(s) hosts — blocks
// localhost / private / link-local / unique-local IPs (incl. the cloud metadata endpoint).
import { lookup } from 'node:dns/promises'

function isBlockedIp(ip) {
  // IPv4
  const m = ip.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/)
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])]
    if (a === 10) return true
    if (a === 127) return true                       // loopback
    if (a === 0) return true
    if (a === 169 && b === 254) return true           // link-local incl 169.254.169.254 metadata
    if (a === 172 && b >= 16 && b <= 31) return true  // 172.16/12
    if (a === 192 && b === 168) return true           // 192.168/16
    if (a === 100 && b >= 64 && b <= 127) return true // CGNAT
    if (a >= 224) return true                          // multicast/reserved
    return false
  }
  // IPv6
  const v6 = ip.toLowerCase()
  if (v6 === '::1' || v6 === '::') return true
  if (v6.startsWith('fe80') || v6.startsWith('fc') || v6.startsWith('fd')) return true // link-local / ULA
  if (v6.startsWith('::ffff:')) return isBlockedIp(v6.slice(7))                          // v4-mapped
  return false
}

async function assertPublicUrl(raw) {
  let u
  try { u = new URL(raw) } catch { throw new Error('invalid URL') }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('only http(s) URLs are allowed')
  const host = u.hostname.toLowerCase()
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) throw new Error('blocked host')
  const addrs = await lookup(host, { all: true }).catch(() => [])
  if (!addrs.length) throw new Error('could not resolve host')
  for (const a of addrs) if (isBlockedIp(a.address)) throw new Error('blocked: resolves to a private/internal address')
  return u
}

function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<\/(p|div|li|h[1-6]|tr|br)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim()
}

// Returns { url, title, text } with text capped. Throws on blocked/oversized/timeout.
export async function webExtract(rawUrl, { maxChars = 8000, timeoutMs = 12000 } = {}) {
  await assertPublicUrl(rawUrl)
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(rawUrl, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: { 'user-agent': 'HermesBot/1.0 (+horizonrecovery)' },
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const ctype = res.headers.get('content-type') || ''
    const raw = (await res.text()).slice(0, 600_000) // hard read cap
    const title = raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() || null
    const text = /html/i.test(ctype) ? htmlToText(raw) : raw
    return { url: rawUrl, title, text: text.slice(0, maxChars), truncated: text.length > maxChars }
  } finally {
    clearTimeout(timer)
  }
}
