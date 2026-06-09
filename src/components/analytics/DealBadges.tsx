// Per-deal derived data badges. Used in DealPanel header.
import type { DealEnriched } from '@/lib/db/analytics'

const INTENSITY_META: Record<string, { label: string; className: string }> = {
  never_called: { label: 'Never Called',  className: 'bg-gray-100 text-gray-500' },
  light:        { label: 'Light Touch',   className: 'bg-blue-50 text-blue-600' },
  working:      { label: 'Working',       className: 'bg-amber-50 text-amber-700' },
  exhausted:    { label: 'Exhausted',     className: 'bg-rose-50 text-rose-700' },
}

const BUCKET_META: Record<string, { label: string }> = {
  small:   { label: '<$15K' },
  mid:     { label: '$15K–$50K' },
  large:   { label: '$50K–$100K' },
  xlarge:  { label: '$100K+' },
  unknown: { label: 'No amount' },
}

function Badge({ children, className }: { children: React.ReactNode; className: string }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium ${className}`}>
      {children}
    </span>
  )
}

export function DealBadges({ enriched }: { enriched: DealEnriched }) {
  const intensity = INTENSITY_META[enriched.callIntensity] ?? INTENSITY_META.never_called
  const bucket = BUCKET_META[enriched.amountBucket] ?? BUCKET_META.unknown
  const geoParts = [enriched.state, enriched.normalizedCounty].filter(Boolean).join(' · ')

  return (
    <div className="flex flex-wrap gap-1.5 mt-2">
      {/* Geography */}
      {geoParts && (
        <Badge className="bg-slate-100 text-slate-700">{geoParts}</Badge>
      )}

      {/* Vintage */}
      {enriched.taxSaleYear && (
        <Badge className="bg-violet-50 text-violet-700">
          {enriched.taxSaleYear}
          {enriched.caseAgeMonths != null && (
            <span className="ml-1 opacity-70">· {enriched.caseAgeMonths}mo</span>
          )}
        </Badge>
      )}

      {/* Amount bucket */}
      <Badge className="bg-emerald-50 text-emerald-700">{bucket.label}</Badge>

      {/* Call intensity */}
      <Badge className={intensity.className}>
        {intensity.label}
        {enriched.uniqueCallDays > 0 && (
          <span className="ml-1 opacity-70">· {enriched.uniqueCallDays}d</span>
        )}
      </Badge>
    </div>
  )
}
