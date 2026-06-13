// qPublic adapter — GA county property/tax directory (FREE, no login). Start here: it gives
// owner / parcel / property address / deed-book references that make GSCCCA searches targeted.
//
// qPublic is per-COUNTY and its search UI varies, so we extract via the LLM (resilient) rather
// than per-county selectors. The search INTERACTION (which field, how to submit) is the part that
// needs live tuning on the VPS — populate GA_QPUBLIC with verified county entry URLs as we go
// (this is the soft-learning surface).
import { openPage } from '@/lib/browser/client'
import type {
  SourceAdapter, SourceResult, PersonQuery, RunContext, SourceAttempt, AttemptStatus, BlockReason,
} from '../types'
import { detectBlock, extractCandidates } from './base'

// county (lowercase) → verified qPublic search entry URL. Extend live.
const GA_QPUBLIC: Record<string, string> = {}
const QPUBLIC_HOME = 'https://qpublic.schneidergeospatial.com/'

const mkAttempt = (
  status: AttemptStatus, q: PersonQuery, started: number, ctx: RunContext, extra: Partial<SourceAttempt> = {},
): SourceAttempt => ({
  sourceId: 'qpublic', caseId: q.caseId ?? null, status, latencyMs: Date.now() - started,
  candidateCount: 0, proxyUsed: ctx.proxyUsed, timestamp: new Date(), ...extra,
})

export const qpublicAdapter: SourceAdapter = {
  id: 'qpublic',
  label: 'qPublic — GA property / tax directory',
  kind: 'property',
  coverage: { states: ['GA'] },
  enabled: true,
  async search(q, ctx): Promise<SourceResult> {
    const started = Date.now()
    const url = (q.county && GA_QPUBLIC[q.county.toLowerCase()]) || QPUBLIC_HOME

    let page
    try {
      page = await openPage(url) // Patchright + stealth, navigates to url
    } catch {
      return { attempt: mkAttempt('error', q, started, ctx, { url }), candidates: [] }
    }

    try {
      // LIVE-TUNING: best-effort generic search. Prefer parcel, else owner name. Refine per county.
      const term = q.parcelId || q.name
      try {
        const box = await page.waitForSelector('input[type="text"], input[type="search"]', { timeout: 6000 })
        if (box) {
          await box.fill(term)
          await page.keyboard.press('Enter')
          await page.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {})
        }
      } catch { /* no obvious search box — extract whatever the landing page shows */ }

      const bodyText: string = await page.evaluate(() => document.body?.innerText ?? '').catch(() => '')
      const blocked: BlockReason | null = detectBlock(null, bodyText)
      if (blocked) {
        return {
          attempt: mkAttempt(blocked === 'captcha' ? 'captcha' : 'blocked', q, started, ctx, { url: page.url(), blockReason: blocked }),
          candidates: [],
        }
      }

      const hint =
        `This is a Georgia county qPublic property record page. We want property owned by ` +
        `"${q.name}"${q.parcelId ? ` (parcel ${q.parcelId})` : ''}${q.address ? ` at ${q.address}` : ''}. ` +
        `Capture owner name, parcel id, property and mailing addresses (kind="property"/"mailing"), ` +
        `and any deed-book / plat references as signals.`
      const candidates = await extractCandidates('qpublic', page.url(), bodyText, hint)
      const status: AttemptStatus = candidates.length ? 'success' : 'empty'
      return { attempt: mkAttempt(status, q, started, ctx, { url: page.url(), candidateCount: candidates.length }), candidates }
    } catch {
      return { attempt: mkAttempt('error', q, started, ctx, { url }), candidates: [] }
    } finally {
      await page.context().close().catch(() => {})
    }
  },
}
