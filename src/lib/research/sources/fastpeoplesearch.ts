// FastPeopleSearch adapter — the contact last-mile: phones, relatives, prior addresses from a
// name (+ city/state). FREE, no login, but anti-bot defended — from a datacenter IP it will often
// be blocked; the telemetry measures that, and the Oxylabs proxy is the lever if it's worth it.
// Search URL pattern + extraction are best-effort and marked for live tuning on the VPS.
import { openPage } from '@/lib/browser/client'
import type { SourceAdapter, SourceResult, PersonQuery, BlockReason } from '../types'
import { detectBlock, extractCandidates, makeAttempt } from './base'

const slug = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

function searchUrl(q: PersonQuery): string {
  const name = slug(q.name)
  const loc = [q.city, q.state].filter(Boolean).map(s => slug(s as string)).join('-')
  return loc
    ? `https://www.fastpeoplesearch.com/name/${name}_${loc}`
    : `https://www.fastpeoplesearch.com/name/${name}`
}

export const fastPeopleSearchAdapter: SourceAdapter = {
  id: 'fastpeoplesearch',
  label: 'FastPeopleSearch — phones / relatives / prior addresses',
  kind: 'people_search',
  coverage: {}, // nationwide
  enabled: true,
  async search(q, ctx): Promise<SourceResult> {
    const started = Date.now()
    const url = searchUrl(q)
    let page
    try {
      page = await openPage(url)
    } catch {
      return { attempt: makeAttempt('fastpeoplesearch', 'error', q, started, ctx, { url }), candidates: [] }
    }
    try {
      const bodyText: string = await page.evaluate(() => document.body?.innerText ?? '').catch(() => '')
      const blocked: BlockReason | null = detectBlock(null, bodyText)
      if (blocked) {
        return {
          attempt: makeAttempt('fastpeoplesearch', blocked === 'captcha' ? 'captcha' : 'blocked', q, started, ctx, { url: page.url(), blockReason: blocked }),
          candidates: [],
        }
      }
      const hint =
        `FastPeopleSearch results for "${q.name}"${q.city ? ` in ${q.city}, ${q.state ?? ''}` : ''}. ` +
        `Extract each person record: full name, age, current and prior addresses (kind="current"/"prior"), ` +
        `phone numbers, emails, and relatives / associated persons. We are trying to match the owner at ` +
        `${q.address ?? 'the case address'}.`
      const candidates = await extractCandidates('fastpeoplesearch', page.url(), bodyText, hint)
      return {
        attempt: makeAttempt('fastpeoplesearch', candidates.length ? 'success' : 'empty', q, started, ctx, { url: page.url(), candidateCount: candidates.length }),
        candidates,
      }
    } catch {
      return { attempt: makeAttempt('fastpeoplesearch', 'error', q, started, ctx, { url }), candidates: [] }
    } finally {
      await page.context().close().catch(() => {})
    }
  },
}
