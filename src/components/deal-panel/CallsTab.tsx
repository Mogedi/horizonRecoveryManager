'use client'

import { OutreachSection } from './OutreachSection'
import type { Contact, OutreachMatrix } from './types'

type CallsTabProps = {
  outreachData: OutreachMatrix | null
  outreachError: string | null
  contacts: Contact[] | undefined
  layer2State: 'idle' | 'confirming' | 'loading' | 'done'
}

export function CallsTab({ outreachData, outreachError, contacts, layer2State }: CallsTabProps) {
  return (
    <div className="px-6 py-4">
      {outreachError ? (
        <div className="mb-4 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">
          {outreachError} — try refreshing or restarting the dev server
        </div>
      ) : outreachData ? (
        <OutreachSection
          matrix={outreachData}
          panelContacts={contacts ?? []}
        />
      ) : (
        <p className="text-sm text-gray-400 text-center py-4">
          {layer2State === 'done' ? 'No call data available' : 'Load full detail to see calls'}
        </p>
      )}
    </div>
  )
}
