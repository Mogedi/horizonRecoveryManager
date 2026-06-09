'use client'

import { useState } from 'react'
import { ContactItem } from './shared'
import { LayerTwoGate } from './LayerTwoGate'
import { ContactPanel } from '@/components/ContactPanel'
import type { Contact } from './types'

type ContactsTabProps = {
  hubspotId: string
  contacts: Contact[] | undefined
  layer2SyncedAt: string | null
  contactCount: number
}

export function ContactsTab({ hubspotId, contacts, layer2SyncedAt, contactCount }: ContactsTabProps) {
  const [selectedContactId, setSelectedContactId] = useState<number | null>(null)

  const count = contacts?.length ?? contactCount
  const label = `Contacts (${count})`

  return (
    <>
      <LayerTwoGate layer2SyncedAt={layer2SyncedAt} label="contacts">
        <div className="px-6 py-4">
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 mt-6">
            {label}
          </h3>
          {contacts && contacts.length > 0 ? (
            contacts.map(c => (
              <ContactItem key={c.id} contact={c} onSelect={() => setSelectedContactId(c.id)} />
            ))
          ) : (
            <p className="text-sm text-gray-400">No contacts linked</p>
          )}
        </div>
      </LayerTwoGate>

      {selectedContactId !== null && (
        <ContactPanel
          dealHubspotId={hubspotId}
          contactId={selectedContactId}
          onClose={() => setSelectedContactId(null)}
        />
      )}
    </>
  )
}
