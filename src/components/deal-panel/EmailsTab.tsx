'use client'

import { useEffect, useState } from 'react'
import { relativeDate } from '@/lib/utils/format'
import { groupEmailsByCounterparty } from '@/lib/utils/email-grouping'

type GmailEmail = {
  id: number
  externalId: string
  happenedAt: string
  direction: string | null
  body: string | null
  metadata: { subject?: string; from?: string; to?: string } | null
}

type EmailsTabProps = {
  hubspotId: string
}

export function EmailsTab({ hubspotId }: EmailsTabProps) {
  const [emails, setEmails] = useState<GmailEmail[] | null>(null)
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set())

  useEffect(() => {
    fetch(`/api/deals/${hubspotId}/google`)
      .then(r => r.ok ? r.json() : null)
      .then(j => setEmails(j?.emails ?? []))
      .catch(() => setEmails([]))
  }, [hubspotId])

  function toggleGroup(counterparty: string) {
    setOpenGroups(prev => {
      const next = new Set(prev)
      if (next.has(counterparty)) next.delete(counterparty)
      else next.add(counterparty)
      return next
    })
  }

  if (emails === null) {
    return (
      <div className="px-6 py-6 space-y-2">
        <div className="h-3 w-3/4 bg-gray-100 rounded animate-pulse" />
        <div className="h-10 bg-gray-100 rounded animate-pulse" />
        <div className="h-10 bg-gray-100 rounded animate-pulse" />
      </div>
    )
  }

  const groups = groupEmailsByCounterparty(emails)

  return (
    <div className="px-6 py-4">
      <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 mt-6">
        Emails ({emails.length})
      </h3>
      {groups.length === 0 ? (
        <p className="text-sm text-gray-400">No emails linked to this deal</p>
      ) : (
        <div className="space-y-1">
          {groups.map(group => {
            const isOpen = openGroups.has(group.counterparty)
            return (
              <div key={group.counterparty} className="border border-gray-100 rounded-lg overflow-hidden">
                <button
                  onClick={() => toggleGroup(group.counterparty)}
                  className="w-full flex items-center justify-between px-3 py-2.5 bg-gray-50 hover:bg-gray-100 text-left transition-colors"
                >
                  <div className="min-w-0">
                    <span className="text-sm font-medium text-gray-800 block truncate">
                      {group.counterparty}
                    </span>
                    <span className="text-xs text-gray-400">
                      {group.count} email{group.count !== 1 ? 's' : ''} · last {relativeDate(group.lastDate)}
                    </span>
                  </div>
                  <span className="text-gray-400 text-xs ml-2 shrink-0">{isOpen ? '▾' : '▸'}</span>
                </button>

                {isOpen && (
                  <div className="divide-y divide-gray-50">
                    {group.emails.map(email => {
                      const meta = email.metadata
                      return (
                        <div key={email.id} className="px-3 py-2.5 text-xs">
                          <div className="flex items-center justify-between gap-2 mb-0.5">
                            <span className="font-medium text-gray-800 truncate">
                              {meta?.subject ?? '(no subject)'}
                            </span>
                            <span className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded-full ${
                              email.direction === 'outbound'
                                ? 'bg-blue-100 text-blue-700'
                                : 'bg-gray-100 text-gray-500'
                            }`}>
                              {email.direction === 'outbound' ? 'sent' : 'received'}
                            </span>
                          </div>
                          <p className="text-gray-400">{relativeDate(email.happenedAt)}</p>
                          {email.body && (
                            <p className="text-gray-500 mt-1 leading-snug line-clamp-2">{email.body}</p>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
