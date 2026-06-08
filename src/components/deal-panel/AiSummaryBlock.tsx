'use client'

import type { SummaryJson } from './types'

export function AiSummaryBlock({
  summary,
  generatedAt,
  lastActivityDate,
  onRegenerate,
}: {
  summary: SummaryJson
  generatedAt: string
  lastActivityDate: string | null
  onRegenerate: () => void
}) {
  const generatedDate = new Date(generatedAt)
  const isStale = lastActivityDate && new Date(lastActivityDate) > generatedDate

  const diffMs = Date.now() - generatedDate.getTime()
  const diffMins = Math.floor(diffMs / 60_000)
  const timeAgo =
    diffMins < 1 ? 'just now' :
    diffMins < 60 ? `${diffMins}m ago` :
    `${Math.floor(diffMins / 60)}h ago`

  return (
    <div className="mb-4 rounded-lg border border-gray-200 overflow-hidden">
      {summary.mo_action_required && (
        <div className="px-4 py-2 bg-red-50 border-b border-red-100 text-xs font-semibold text-red-700">
          Mo Action Required
        </div>
      )}

      <div className="px-4 py-3 space-y-3 text-sm text-gray-700">
        <div>
          <span className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-0.5">Status</span>
          <p>{summary.current_status}</p>
        </div>
        <div>
          <span className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-0.5">Last Activity</span>
          <p>{summary.last_meaningful_activity}</p>
        </div>
        {summary.blockers.length > 0 && (
          <div>
            <span className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-0.5">Blockers</span>
            <ul className="list-disc list-inside space-y-0.5">
              {summary.blockers.map((b, i) => <li key={i}>{b}</li>)}
            </ul>
          </div>
        )}
        {summary.who_needs_something && (
          <div>
            <span className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-0.5">Who Needs Something</span>
            <p>{summary.who_needs_something}</p>
          </div>
        )}
        <div>
          <span className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-0.5">Suggested Next Step</span>
          <p className="font-medium">{summary.suggested_next_step}</p>
        </div>
        {summary.documents_mentioned_missing.length > 0 && (
          <div>
            <span className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-0.5">Documents Missing</span>
            <ul className="list-disc list-inside space-y-0.5">
              {summary.documents_mentioned_missing.map((d, i) => <li key={i}>{d}</li>)}
            </ul>
          </div>
        )}
      </div>

      <div className="px-4 py-2 border-t border-gray-100 flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs text-gray-400">
          <span>Generated {timeAgo}</span>
          {isStale && (
            <span className="px-1.5 py-0.5 bg-yellow-50 border border-yellow-200 text-yellow-700 rounded text-xs">
              New activity since summary
            </span>
          )}
        </div>
        <button
          onClick={onRegenerate}
          className="text-xs text-gray-400 hover:text-gray-700"
        >
          ↻ Regenerate
        </button>
      </div>
    </div>
  )
}
