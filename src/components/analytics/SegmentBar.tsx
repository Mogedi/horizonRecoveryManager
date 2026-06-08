// Horizontal proportional segment bar.
// Each segment has a label, count, and color class.
// Used for call intensity distribution, vintage spread, etc.
// Pure — no data fetching.

export type Segment = {
  key: string
  label: string
  value: number
  colorClass: string   // bg-* Tailwind class
  textClass?: string   // text-* for the legend label
}

export function SegmentBar({
  segments,
  showLegend = true,
  height = 'h-3',
}: {
  segments: Segment[]
  showLegend?: boolean
  height?: string
}) {
  const total = segments.reduce((s, seg) => s + seg.value, 0)
  if (total === 0) return <div className={`${height} bg-gray-100 rounded-full`} />

  return (
    <div className="space-y-2">
      {/* Bar */}
      <div className={`flex w-full rounded-full overflow-hidden ${height} bg-gray-100`}>
        {segments.map(seg => {
          const pct = (seg.value / total) * 100
          if (pct === 0) return null
          return (
            <div
              key={seg.key}
              className={`${seg.colorClass} transition-all`}
              style={{ width: `${pct}%` }}
              title={`${seg.label}: ${seg.value}`}
            />
          )
        })}
      </div>

      {/* Legend */}
      {showLegend && (
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {segments.map(seg => (
            <div key={seg.key} className="flex items-center gap-1.5">
              <div className={`w-2 h-2 rounded-full shrink-0 ${seg.colorClass}`} />
              <span className={`text-[11px] ${seg.textClass ?? 'text-gray-500'}`}>
                {seg.label} <span className="font-semibold text-gray-700">{seg.value}</span>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
