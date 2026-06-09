'use client'

import { LayerTwoGate } from './LayerTwoGate'
import { OutreachSection } from './OutreachSection'
import type { Contact, OutreachMatrix } from './types'

type CallsTabProps = {
  outreachData: OutreachMatrix | null
  outreachError: string | null
  contacts: Contact[] | undefined
  layer2SyncedAt: string | null
}

export function CallsTab({ outreachData, outreachError, contacts, layer2SyncedAt }: CallsTabProps) {
  return (
    <LayerTwoGate layer2SyncedAt={layer2SyncedAt} label="call history">
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
          <p className="text-sm text-gray-400 text-center py-4">No call data available</p>
        )}
      </div>
    </LayerTwoGate>
  )
}
