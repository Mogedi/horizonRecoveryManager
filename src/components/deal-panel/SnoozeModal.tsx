'use client'

import { useState } from 'react'
import { SNOOZE_CATEGORY_LABELS } from './types'

function tomorrowISO(): string {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  return d.toISOString().slice(0, 10)
}

export function SnoozeModal({
  hubspotId,
  onClose,
  onSuccess,
}: {
  hubspotId: string
  onClose: () => void
  onSuccess: () => void
}) {
  const [category, setCategory] = useState('waiting_on_attorney')
  const [snoozeUntil, setSnoozeUntil] = useState(tomorrowISO())
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(`/api/deals/${hubspotId}/snooze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category, snoozeUntil, freeformNote: note || undefined }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body?.error ?? `Failed: ${res.status}`)
      }
      onSuccess()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to snooze')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-xl p-6 w-full max-w-sm mx-4 z-10">
        <h2 className="text-base font-semibold text-gray-900 mb-4">Snooze this deal</h2>

        <div className="space-y-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Reason</label>
            <select
              value={category}
              onChange={e => setCategory(e.target.value)}
              className="w-full text-sm border border-gray-300 rounded-md px-3 py-2 text-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-400"
            >
              {Object.entries(SNOOZE_CATEGORY_LABELS).map(([val, label]) => (
                <option key={val} value={val}>{label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs text-gray-500 mb-1">Wake on</label>
            <input
              type="date"
              value={snoozeUntil}
              min={tomorrowISO()}
              onChange={e => setSnoozeUntil(e.target.value)}
              className="w-full text-sm border border-gray-300 rounded-md px-3 py-2 text-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-400"
            />
          </div>

          <div>
            <label className="block text-xs text-gray-500 mb-1">Note (optional)</label>
            <textarea
              value={note}
              onChange={e => setNote(e.target.value)}
              rows={2}
              placeholder="e.g. Filed with county 6/5, typical 90-day wait"
              className="w-full text-sm border border-gray-300 rounded-md px-3 py-2 text-gray-700 resize-none focus:outline-none focus:ring-1 focus:ring-gray-400"
            />
          </div>
        </div>

        {error && (
          <p className="mt-3 text-xs text-red-600">{error}</p>
        )}

        <div className="flex items-center gap-2 mt-4">
          <button
            onClick={submit}
            disabled={submitting}
            className="flex-1 py-2 text-sm font-medium text-white bg-gray-900 rounded-md hover:bg-gray-700 disabled:opacity-40"
          >
            {submitting ? 'Saving…' : 'Snooze'}
          </button>
          <button
            onClick={onClose}
            className="flex-1 py-2 text-sm text-gray-600 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
