// Analytics DB layer — all queries hit deal_enriched view, not the deals table directly.
//
// Architecture intent:
//   deal_enriched view = always-fresh derived layer; no sync step
//   This module = the only place that queries deal_enriched
//   /api/analytics = thin handler over getPortfolioAnalytics()
//   Future /analytics page (outside dashboard) uses the same API + same components
//   To add a new metric: add a column to the view, add a field here, done.

import { prisma } from './client'

// ─── Per-deal enriched fields ─────────────────────────────────────────────────

export type DealEnriched = {
  state: string | null
  normalizedCounty: string | null
  ownerName: string | null
  taxSaleYear: number | null
  caseAgeMonths: number | null
  amountBucket: 'small' | 'mid' | 'large' | 'xlarge' | 'unknown'
  uniqueCallDays: number
  callIntensity: 'never_called' | 'light' | 'working' | 'exhausted'
}

type DealEnrichedRow = {
  state: string | null
  normalized_county: string | null
  owner_name: string | null
  tax_sale_year: number | null
  case_age_months: number | null
  amount_bucket: string
  unique_call_days: number
  call_intensity: string
}

export async function getDealEnrichedById(hubspotId: string): Promise<DealEnriched | null> {
  const rows = await prisma.$queryRaw<DealEnrichedRow[]>`
    SELECT state, normalized_county, owner_name, tax_sale_year, case_age_months,
           amount_bucket, unique_call_days, call_intensity
    FROM deal_enriched
    WHERE hubspot_id = ${hubspotId}
    LIMIT 1
  `
  if (!rows[0]) return null
  const r = rows[0]
  return {
    state: r.state ?? null,
    normalizedCounty: r.normalized_county ?? null,
    ownerName: r.owner_name ?? null,
    taxSaleYear: r.tax_sale_year ? Number(r.tax_sale_year) : null,
    caseAgeMonths: r.case_age_months ? Number(r.case_age_months) : null,
    amountBucket: (r.amount_bucket ?? 'unknown') as DealEnriched['amountBucket'],
    uniqueCallDays: Number(r.unique_call_days ?? 0),
    callIntensity: (r.call_intensity ?? 'never_called') as DealEnriched['callIntensity'],
  }
}

// ─── Portfolio analytics ──────────────────────────────────────────────────────

export type StateBreakdown = { state: string; deals: number; value: number }
export type CountyBreakdown = { state: string; county: string; deals: number; value: number; avgCaseAgeMonths: number | null }
export type VintageBreakdown = { year: number; deals: number; value: number }
export type AmountBucketBreakdown = { bucket: string; deals: number; value: number }
export type CallIntensityBreakdown = { tier: string; deals: number }

export type PortfolioAnalytics = {
  totalDeals: number
  totalValue: number
  avgCaseAgeMonths: number | null
  byState: StateBreakdown[]
  byCounty: CountyBreakdown[]
  byVintage: VintageBreakdown[]
  byAmountBucket: AmountBucketBreakdown[]
  byCallIntensity: CallIntensityBreakdown[]
}

export async function getPortfolioAnalytics(): Promise<PortfolioAnalytics> {
  const [totals, byState, byCounty, byVintage, byAmountBucket, byCallIntensity] = await Promise.all([
    prisma.$queryRaw<Array<{ total_deals: number; total_value: number; avg_age: number | null }>>`
      SELECT
        COUNT(*)::int                                AS total_deals,
        COALESCE(SUM(amount), 0)::numeric(14,2)     AS total_value,
        AVG(case_age_months)::numeric(6,1)          AS avg_age
      FROM deal_enriched
      WHERE state IS NOT NULL
    `,

    prisma.$queryRaw<Array<{ state: string; deals: number; value: number }>>`
      SELECT
        state,
        COUNT(*)::int                            AS deals,
        COALESCE(SUM(amount), 0)::numeric(14,2) AS value
      FROM deal_enriched
      WHERE state IS NOT NULL
      GROUP BY state
      ORDER BY value DESC
    `,

    prisma.$queryRaw<Array<{ state: string; county: string; deals: number; value: number; avg_age: number | null }>>`
      SELECT
        COALESCE(state, '?')                          AS state,
        COALESCE(normalized_county, 'UNKNOWN')        AS county,
        COUNT(*)::int                                 AS deals,
        COALESCE(SUM(amount), 0)::numeric(14,2)      AS value,
        AVG(case_age_months)::numeric(6,1)            AS avg_age
      FROM deal_enriched
      GROUP BY state, normalized_county
      ORDER BY value DESC
      LIMIT 60
    `,

    prisma.$queryRaw<Array<{ year: number; deals: number; value: number }>>`
      SELECT
        tax_sale_year                                 AS year,
        COUNT(*)::int                                 AS deals,
        COALESCE(SUM(amount), 0)::numeric(14,2)      AS value
      FROM deal_enriched
      WHERE tax_sale_year IS NOT NULL
      GROUP BY tax_sale_year
      ORDER BY tax_sale_year ASC
    `,

    prisma.$queryRaw<Array<{ bucket: string; deals: number; value: number }>>`
      SELECT
        amount_bucket                                 AS bucket,
        COUNT(*)::int                                 AS deals,
        COALESCE(SUM(amount), 0)::numeric(14,2)      AS value
      FROM deal_enriched
      GROUP BY amount_bucket
      ORDER BY
        CASE amount_bucket
          WHEN 'small'   THEN 1
          WHEN 'mid'     THEN 2
          WHEN 'large'   THEN 3
          WHEN 'xlarge'  THEN 4
          ELSE 5
        END
    `,

    prisma.$queryRaw<Array<{ tier: string; deals: number }>>`
      SELECT
        call_intensity                AS tier,
        COUNT(*)::int                 AS deals
      FROM deal_enriched
      GROUP BY call_intensity
      ORDER BY
        CASE call_intensity
          WHEN 'never_called' THEN 1
          WHEN 'light'        THEN 2
          WHEN 'working'      THEN 3
          WHEN 'exhausted'    THEN 4
        END
    `,
  ])

  const t = totals[0] ?? { total_deals: 0, total_value: 0, avg_age: null }

  return {
    totalDeals: Number(t.total_deals),
    totalValue: Number(t.total_value),
    avgCaseAgeMonths: t.avg_age ? Number(t.avg_age) : null,
    byState: byState.map(r => ({ state: r.state, deals: Number(r.deals), value: Number(r.value) })),
    byCounty: byCounty.map(r => ({
      state: r.state,
      county: r.county,
      deals: Number(r.deals),
      value: Number(r.value),
      avgCaseAgeMonths: r.avg_age ? Number(r.avg_age) : null,
    })),
    byVintage: byVintage.map(r => ({ year: Number(r.year), deals: Number(r.deals), value: Number(r.value) })),
    byAmountBucket: byAmountBucket.map(r => ({ bucket: r.bucket, deals: Number(r.deals), value: Number(r.value) })),
    byCallIntensity: byCallIntensity.map(r => ({ tier: r.tier, deals: Number(r.deals) })),
  }
}
