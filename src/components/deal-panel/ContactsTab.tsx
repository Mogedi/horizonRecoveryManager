'use client'

import { useState } from 'react'
import { SectionHeader, ContactItem } from './shared'
import { ContactPanel } from '@/components/ContactPanel'
import type { Contact } from './types'

type ContactsTabProps = {
  contacts: Contact[] | undefined
  layer2State: 'idle' | 'confirming' | 'loading' | 'done'
  contactCount: number
}

export function ContactsTab({ contacts, layer2State, contactCount }: ContactsTabProps) {
  const [selectedContactId, setSelectedContactId] = useState<number | null>(null)

  const label = layer2State === 'done'
    ? `Contacts (${contacts?.length ?? 0})`
    : `Contacts (${contactCount > 0 ? `${contactCount} — load full detail for names` : '0'})`

  return (
    <>
      <div className="px-6 py-4">
        <SectionHeader title={label} />
        {contacts && contacts.length > 0 ? (
          contacts.map(c => (
            <ContactItem key={c.id} contact={c} onSelect={() => setSelectedContactId(c.id)} />
          ))
        ) : (
          <p className="text-sm text-gray-400">
            {layer2State === 'done' ? 'No contacts linked' : 'Load full detail to see contacts'}
          </p>
        )}
      </div>

      {selectedContactId !== null && (
        <ContactPanel
          contactId={selectedContactId}
          onClose={() => setSelectedContactId(null)}
        />
      )}
    </>
  )
}
