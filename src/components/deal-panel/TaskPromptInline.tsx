'use client'

import { useState } from 'react'

export function TaskPromptInline({
  suggestedTitle,
  hubspotId,
  onDone,
  onDismiss,
}: {
  suggestedTitle: string
  hubspotId: string
  onDone: () => void
  onDismiss: () => void
}) {
  const [title, setTitle] = useState(suggestedTitle)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const create = async () => {
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title.trim(), category: 'case', dealHubspotId: hubspotId }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body?.error ?? `Failed: ${res.status}`)
      }
      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create task')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg">
      <p className="text-xs font-semibold text-amber-800 mb-2">Mo Action Required — Create a task?</p>
      <input
        type="text"
        value={title}
        onChange={e => setTitle(e.target.value)}
        className="w-full px-2 py-1.5 text-sm border border-amber-200 rounded bg-white mb-2 focus:outline-none focus:ring-1 focus:ring-amber-400"
      />
      {error && <p className="text-xs text-red-600 mb-2">{error}</p>}
      <div className="flex gap-2">
        <button
          onClick={create}
          disabled={submitting || !title.trim()}
          className="px-3 py-1 text-xs text-white bg-amber-700 rounded hover:bg-amber-800 disabled:opacity-40"
        >
          {submitting ? 'Creating…' : 'Create Task'}
        </button>
        <button
          onClick={onDismiss}
          className="px-3 py-1 text-xs text-amber-700 hover:text-amber-900"
        >
          Dismiss
        </button>
      </div>
    </div>
  )
}
