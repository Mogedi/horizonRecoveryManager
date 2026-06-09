'use client'

import { formatDate } from '@/lib/utils/format'
import type { Activity, Contact } from './types'

const ACTIVITY_ICONS: Record<string, string> = {
  note: '📝',
  email: '✉️',
  call: '📞',
  task: '✓',
}

export function SectionHeader({ title }: { title: string }) {
  return (
    <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 mt-6">
      {title}
    </h3>
  )
}

export function ActivityItem({ activity }: { activity: Activity }) {
  const icon = ACTIVITY_ICONS[activity.type] ?? '·'
  const label = activity.type.charAt(0).toUpperCase() + activity.type.slice(1)
  const who = activity.authorName ?? activity.authorOwnerId ?? 'Unknown'
  const direction = activity.direction === 'inbound' ? ' · Inbound' : activity.direction === 'outbound' ? ' · Outbound' : ''

  return (
    <div className="py-3 border-b border-gray-100 last:border-0">
      <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-1">
        <span>{icon}</span>
        <span className="font-medium text-gray-500">{label}{direction}</span>
        <span>·</span>
        <span>{who}</span>
        <span>·</span>
        <span>{formatDate(activity.timestamp)}</span>
      </div>
      {activity.body && (
        <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">
          {activity.body.length > 400 ? activity.body.slice(0, 400) + '…' : activity.body}
        </p>
      )}
    </div>
  )
}

export function ContactItem({ contact, onSelect }: { contact: Contact; onSelect?: () => void }) {
  const formattedAddress = [contact.address, contact.city, contact.state, contact.zip]
    .filter(Boolean).join(', ')

  const inner = (
    <div className="py-2.5 border-b border-gray-100 last:border-0">
      <div className="flex items-start justify-between gap-2">
        <div>
          <span className="font-medium text-gray-900 text-sm">{contact.name ?? 'Unknown'}</span>
          {contact.isDeceased && (
            <span className="ml-2 text-xs text-gray-400">Deceased</span>
          )}
          {contact.doNotContact && (
            <span className="ml-2 text-xs bg-red-50 text-red-600 px-1.5 py-0.5 rounded">DNC</span>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-xs text-gray-400">
            {contact.contactType ?? '—'}
            {contact.ownershipStatus ? ` · ${contact.ownershipStatus}` : ''}
          </span>
          {onSelect && <span className="text-gray-300 text-xs">›</span>}
        </div>
      </div>
      {contact.phoneNumbers.length > 0 && (
        <div className="mt-0.5 space-y-0.5">
          {contact.phoneNumbers.map(p => (
            <p key={p} className="text-xs text-gray-600">{p}</p>
          ))}
        </div>
      )}
      {contact.emailList.length > 0 && (
        <div className="mt-0.5 space-y-0.5">
          {contact.emailList.map(e => (
            <p key={e} className="text-xs text-gray-500">{e}</p>
          ))}
        </div>
      )}
      {formattedAddress && (
        <p className="text-xs text-gray-400 mt-0.5">{formattedAddress}</p>
      )}
      {contact.phoneNumbers.length === 0 && contact.emailList.length === 0 && !formattedAddress && (
        <p className="text-xs text-gray-400 mt-0.5">No contact info</p>
      )}
    </div>
  )

  if (onSelect) {
    return (
      <button
        onClick={onSelect}
        className="w-full text-left hover:bg-gray-50 cursor-pointer px-0 rounded transition-colors"
      >
        {inner}
      </button>
    )
  }
  return inner
}
