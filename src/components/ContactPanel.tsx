'use client'

import { useEffect, useState } from 'react'
import { relativeDate, formatDate } from '@/lib/utils/format'
import type { Contact, ContactStats, ContactCall } from './deal-panel/types'

type ContactPanelData = {
  contact: Contact
  stats: ContactStats
  recentCalls: ContactCall[]
}

type ContactPanelProps = {
  dealHubspotId: string
  contactId: number
  onClose: () => void
}

function formatPhone(e164: string): string {
  const digits = e164.replace(/\D/g, '')
  if (digits.length === 11 && digits.startsWith('1')) {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`
  }
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
  }
  return e164
}

function formatDuration(secs: number | null): string | null {
  if (!secs) return null
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

function OutcomeDot({ outcome }: { outcome: string | null }) {
  const color =
    outcome === 'answered' ? 'bg-green-500' :
    outcome === 'voicemail' ? 'bg-yellow-400' :
    'bg-gray-300'
  return <span className={`inline-block w-2 h-2 rounded-full shrink-0 mt-1 ${color}`} />
}

function OutcomeLabel({ outcome }: { outcome: string | null }) {
  if (outcome === 'answered') return <span className="text-green-600 text-xs">Answered</span>
  if (outcome === 'voicemail') return <span className="text-yellow-600 text-xs">Voicemail</span>
  if (outcome === 'no_answer') return <span className="text-gray-400 text-xs">No answer</span>
  if (outcome === 'busy') return <span className="text-gray-400 text-xs">Busy</span>
  return <span className="text-gray-400 text-xs">{outcome ?? 'Unknown'}</span>
}

export function ContactPanel({ dealHubspotId, contactId, onClose }: ContactPanelProps) {
  const [data, setData] = useState<ContactPanelData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    fetch(`/api/deals/${dealHubspotId}/contacts/${contactId}`)
      .then(r => r.ok ? r.json() : r.json().then((j: { error?: string }) => Promise.reject(j.error ?? 'Error')))
      .then((json: ContactPanelData) => setData(json))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false))
  }, [dealHubspotId, contactId])

  const contact = data?.contact
  const stats = data?.stats
  const calls = data?.recentCalls ?? []

  const formattedAddress = contact
    ? [contact.address, contact.city, contact.state, contact.zip].filter(Boolean).join(', ')
    : null

  const hasCallHistory = (stats?.totalCalls ?? 0) > 0

  return (
    <>
      {/* Backdrop — closes only this panel */}
      <div
        className="fixed inset-0 z-[59] bg-transparent"
        onClick={onClose}
      />

      <div className="fixed right-0 top-0 h-full z-[60] w-full max-w-sm bg-white shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-gray-100 flex items-start justify-between gap-3 shrink-0">
          <div className="min-w-0">
            {loading ? (
              <div className="h-5 w-32 bg-gray-100 rounded animate-pulse" />
            ) : (
              <>
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="font-semibold text-gray-900 text-sm truncate">
                    {contact?.name ?? 'Unknown'}
                  </h2>
                  {contact?.isDeceased && (
                    <span className="text-xs text-gray-400">Deceased</span>
                  )}
                  {contact?.doNotContact && (
                    <span className="text-xs bg-red-50 text-red-600 px-1.5 py-0.5 rounded">DNC</span>
                  )}
                </div>
                {(contact?.contactType || contact?.ownershipStatus) && (
                  <p className="text-xs text-gray-400 mt-0.5">
                    {[contact.contactType, contact.ownershipStatus].filter(Boolean).join(' · ')}
                  </p>
                )}
              </>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-lg leading-none shrink-0"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {error && (
          <div className="px-5 py-3 text-sm text-red-600">{error}</div>
        )}

        <div className="flex-1 overflow-y-auto">
          {/* Relationship Stats */}
          {!loading && hasCallHistory && stats && (
            <div className="px-5 py-4 border-b border-gray-100 bg-gray-50">
              {stats.conversations > 0 && stats.lastConversationDate ? (
                <p className="text-sm font-medium text-gray-900 mb-1">
                  Last conversation: {relativeDate(stats.lastConversationDate)}
                </p>
              ) : stats.lastCallDate ? (
                <p className="text-sm text-gray-500 mb-1">
                  Last call: {relativeDate(stats.lastCallDate)}
                </p>
              ) : null}
              <p className="text-xs text-gray-500">
                {stats.totalCalls} call{stats.totalCalls !== 1 ? 's' : ''} · {stats.conversations} conversation{stats.conversations !== 1 ? 's' : ''}
              </p>
              {stats.bestPhone && (
                <p className="text-xs text-gray-500 mt-0.5">
                  Best: {formatPhone(stats.bestPhone)}
                </p>
              )}
            </div>
          )}

          {/* Contact Info */}
          <div className="px-5 py-4 border-b border-gray-100">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Contact Info</p>

            {loading ? (
              <div className="space-y-2">
                {[1, 2, 3].map(i => <div key={i} className="h-4 bg-gray-100 rounded animate-pulse" />)}
              </div>
            ) : (
              <>
                {/* Phones */}
                {(contact?.phoneNumbers.length ?? 0) > 0 && (
                  <div className="space-y-1 mb-2">
                    {contact!.phoneNumbers.map(p => (
                      <div key={p} className="flex items-center gap-2">
                        <button
                          onClick={() => navigator.clipboard.writeText(p)}
                          className="text-xs text-gray-700 hover:text-blue-600 font-mono"
                          title="Click to copy"
                        >
                          {p}
                        </button>
                        {stats?.bestPhone === p && (
                          <span className="text-xs text-amber-500">★</span>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Emails */}
                {(contact?.emailList.length ?? 0) > 0 && (
                  <div className="space-y-1 mb-2">
                    {contact!.emailList.map(e => (
                      <button
                        key={e}
                        onClick={() => navigator.clipboard.writeText(e)}
                        className="block text-xs text-gray-600 hover:text-blue-600 truncate"
                        title="Click to copy"
                      >
                        {e}
                      </button>
                    ))}
                  </div>
                )}

                {/* Address */}
                {formattedAddress && (
                  <p className="text-xs text-gray-500">{formattedAddress}</p>
                )}

                {!contact?.phoneNumbers.length && !contact?.emailList.length && !formattedAddress && (
                  <p className="text-xs text-gray-400">No contact info</p>
                )}
              </>
            )}
          </div>

          {/* Recent Activity */}
          <div className="px-5 py-4">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-3">Recent Activity</p>

            {loading ? (
              <div className="space-y-2">
                {[1, 2, 3].map(i => <div key={i} className="h-4 bg-gray-100 rounded animate-pulse" />)}
              </div>
            ) : calls.length === 0 ? (
              <p className="text-xs text-gray-400">No call history</p>
            ) : (
              <div className="space-y-2">
                {calls.map(c => (
                  <div key={c.id} className="flex items-start gap-2">
                    <OutcomeDot outcome={c.outcome} />
                    <div className="min-w-0">
                      <span className="text-xs text-gray-500 mr-2">{formatDate(c.happenedAt)}</span>
                      <OutcomeLabel outcome={c.outcome} />
                      {c.outcome === 'answered' && formatDuration(c.durationSecs) && (
                        <span className="text-xs text-gray-400 ml-2">{formatDuration(c.durationSecs)}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
