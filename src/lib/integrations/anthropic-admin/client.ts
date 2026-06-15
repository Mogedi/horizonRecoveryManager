// Anthropic Admin Usage & Cost API — the authoritative billed spend, by model + workspace.
// This is the ONLY source that shows the true Haiku-vs-Sonnet split; Hermes's self-report
// (research_costs) bills every session to the main model and only sees research CLI runs.
//
// Needs an Admin key (sk-ant-admin01-...) in ANTHROPIC_ADMIN_KEY. Read-only. Boundary 2:
// all calls go through req() + anthropicAdminLimiter. Degrades gracefully (returns available:false).
import { anthropicAdminLimiter } from '@/lib/rate-limiters'

const BASE = 'https://api.anthropic.com'
const headers = () => ({
  'anthropic-version': '2023-06-01',
  'x-api-key': process.env.ANTHROPIC_ADMIN_KEY ?? '',
  'User-Agent': 'HorizonRecovery/1.0',
})

export class AnthropicAdminError extends Error {
  constructor(message: string) { super(message); this.name = 'AnthropicAdminError' }
}

async function req<T>(path: string): Promise<T> {
  return anthropicAdminLimiter.schedule(async () => {
    const r = await fetch(`${BASE}${path}`, { headers: headers() })
    if (!r.ok) throw new AnthropicAdminError(`Admin API ${r.status}: ${(await r.text()).slice(0, 200)}`)
    return (await r.json()) as T
  })
}

interface Workspace { id: string; name: string }
interface CostResult {
  amount?: string | number; cost?: string | number; workspace_id?: string | null
  model?: string; description?: { model?: string } | string | null
}
interface ReportBucket<R> { results?: R[] }

export interface WorkspaceSpend { workspaceId: string; label: string; isHermes: boolean; usd: number; byModel: { model: string; usd: number }[] }
export interface RealSpend {
  available: boolean; reason?: string; days: number; totalUsd: number
  byModelTotal: { model: string; usd: number }[]; byWorkspace: WorkspaceSpend[]
}

// Pure aggregation (exported for tests). Cost amounts arrive as CENTS (decimal strings).
export function aggregateCost(
  buckets: ReportBucket<CostResult>[],
  wsName: Map<string, string>,
  hermesId: string | null,
): Pick<RealSpend, 'byWorkspace' | 'byModelTotal' | 'totalUsd'> {
  const wsAgg: Record<string, Record<string, number>> = {} // workspace -> model -> cents
  for (const b of buckets ?? []) {
    for (const r of b.results ?? []) {
      const cents = Number(r.amount ?? r.cost ?? 0)
      if (!Number.isFinite(cents) || cents === 0) continue
      const w = r.workspace_id ?? 'default'
      const model =
        r.model ??
        (typeof r.description === 'object' && r.description ? r.description.model : undefined) ??
        (typeof r.description === 'string' ? r.description : undefined) ??
        'other'
      ;(wsAgg[w] ??= {})[model] = (wsAgg[w][model] ?? 0) + cents
    }
  }
  const usd = (n: number) => +(n / 100).toFixed(4)
  const byWorkspace: WorkspaceSpend[] = Object.entries(wsAgg).map(([w, models]) => ({
    workspaceId: w,
    label: w === 'default' ? 'default' : (wsName.get(w) ?? w),
    isHermes: hermesId != null && w === hermesId,
    usd: usd(Object.values(models).reduce((a, b) => a + b, 0)),
    byModel: Object.entries(models).map(([model, c]) => ({ model, usd: usd(c) })).sort((a, b) => b.usd - a.usd),
  })).sort((a, b) => b.usd - a.usd)
  const modelTotals: Record<string, number> = {}
  for (const models of Object.values(wsAgg)) for (const [m, c] of Object.entries(models)) modelTotals[m] = (modelTotals[m] ?? 0) + c
  const byModelTotal = Object.entries(modelTotals).map(([model, c]) => ({ model, usd: usd(c) })).sort((a, b) => b.usd - a.usd)
  const totalUsd = +byWorkspace.reduce((a, w) => a + w.usd, 0).toFixed(4)
  return { byWorkspace, byModelTotal, totalUsd }
}

// Warm-lambda cache (data is daily; avoid hammering the once-per-min API on each page load).
let cache: { at: number; days: number; data: RealSpend } | null = null
const TTL_MS = 30 * 60 * 1000
const DAY = 86_400_000
const iso = (t: number) => new Date(t).toISOString().slice(0, 19) + 'Z'

export async function getRealSpend(days = 7): Promise<RealSpend> {
  const empty = (reason: string): RealSpend => ({ available: false, reason, days, totalUsd: 0, byModelTotal: [], byWorkspace: [] })
  if (!process.env.ANTHROPIC_ADMIN_KEY) return empty('ANTHROPIC_ADMIN_KEY not set')
  if (cache && cache.days === days && Date.now() - cache.at < TTL_MS) return cache.data
  try {
    const ws = await req<{ data?: Workspace[] }>(`/v1/organizations/workspaces?limit=100`)
    const wsName = new Map((ws.data ?? []).map(w => [w.id, w.name] as const))
    const hermesId = (ws.data ?? []).find(w => (w.name ?? '').toLowerCase() === 'hermes research')?.id ?? null
    const start = iso(Date.now() - days * DAY), end = iso(Date.now() + DAY)
    const cost = await req<{ data?: ReportBucket<CostResult>[] }>(
      `/v1/organizations/cost_report?starting_at=${start}&ending_at=${end}&bucket_width=1d&group_by[]=workspace_id&group_by[]=description`,
    )
    const data: RealSpend = { available: true, days, ...aggregateCost(cost.data ?? [], wsName, hermesId) }
    cache = { at: Date.now(), days, data }
    return data
  } catch (e) {
    return empty(e instanceof Error ? e.message : 'admin api error')
  }
}
