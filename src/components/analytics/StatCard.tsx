// Reusable KPI tile. Used on pipeline page and future analytics dashboard.
// Pure — no data fetching, all data via props.

export function StatCard({
  label,
  primary,
  sub,
  highlight = false,
  accent,
}: {
  label: string
  primary: string
  sub?: string
  highlight?: boolean
  accent?: 'rose' | 'amber' | 'blue' | 'green' | 'orange'
}) {
  const accentClass =
    accent === 'rose'   ? 'text-rose-600' :
    accent === 'amber'  ? 'text-amber-600' :
    accent === 'blue'   ? 'text-blue-600' :
    accent === 'green'  ? 'text-green-600' :
    accent === 'orange' ? 'text-orange-600' :
    highlight           ? 'text-rose-600' :
    'text-gray-900'

  return (
    <div className="bg-white rounded-xl border border-gray-200 px-5 py-4 min-w-0">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 truncate">{label}</p>
      <p className={`text-2xl font-bold mt-1 leading-none ${accentClass}`}>{primary}</p>
      {sub && <p className="text-[11px] text-gray-400 mt-1 truncate">{sub}</p>}
    </div>
  )
}
