'use client'

import { useState } from 'react'
import { formatDate } from '@/lib/utils/format'
import type { Activity } from './types'

type NotesTabProps = {
  activities: Activity[] | undefined
  layer2State: 'idle' | 'confirming' | 'loading' | 'done'
}

export function NotesTab({ activities, layer2State }: NotesTabProps) {
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set())

  const notes = activities?.filter(a => a.type === 'note') ?? []

  function toggle(id: number) {
    setExpandedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className="px-6 py-4">
      <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 mt-6">
        Notes ({notes.length})
      </h3>
      {notes.length === 0 ? (
        <p className="text-sm text-gray-400">
          {layer2State === 'done' ? 'No notes recorded' : 'Load full detail to see notes'}
        </p>
      ) : (
        notes.map(note => {
          const isExpanded = expandedIds.has(note.id)
          const PREVIEW_LEN = 200
          const canExpand = (note.body?.length ?? 0) > PREVIEW_LEN
          const text = note.body ?? ''
          const displayed = isExpanded || !canExpand ? text : text.slice(0, PREVIEW_LEN) + '…'
          return (
            <div key={note.id} className="py-3 border-b border-gray-100 last:border-0">
              <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-1">
                <span>📝</span>
                <span className="font-medium text-gray-500">
                  {note.authorName ?? note.authorOwnerId ?? 'Unknown'}
                </span>
                <span>·</span>
                <span>{formatDate(note.timestamp)}</span>
              </div>
              {text && (
                <>
                  <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">
                    {displayed}
                  </p>
                  {canExpand && (
                    <button
                      onClick={() => toggle(note.id)}
                      className="mt-1 text-xs text-blue-600 hover:underline"
                    >
                      {isExpanded ? 'Show less' : 'Show more'}
                    </button>
                  )}
                </>
              )}
            </div>
          )
        })
      )}
    </div>
  )
}
