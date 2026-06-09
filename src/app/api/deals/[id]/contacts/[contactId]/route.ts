import { NextRequest, NextResponse } from 'next/server'
import { isAuthenticated, unauthorizedResponse } from '@/lib/auth/require-session'
import { getContactsForDeal, getContactStats, getRecentCallsForContact } from '@/lib/db/contacts'
import { normalizeToE164 } from '@/lib/integrations/justcall/normalize'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; contactId: string }> }
) {
  if (!(await isAuthenticated())) return unauthorizedResponse()

  const { id: dealHubspotId, contactId: contactIdStr } = await params
  const contactId = parseInt(contactIdStr, 10)

  const contacts = await getContactsForDeal(dealHubspotId)
  const contact = contacts.find(c => c.id === contactId)
  if (!contact) return NextResponse.json({ error: 'Contact not found' }, { status: 404 })

  const rawPhones = Array.isArray(contact.phoneNumbers) ? (contact.phoneNumbers as string[]) : []
  const e164Phones = rawPhones.map(normalizeToE164).filter((p): p is string => p !== null)

  const [stats, recentCalls] = await Promise.all([
    getContactStats(dealHubspotId, e164Phones),
    getRecentCallsForContact(dealHubspotId, e164Phones),
  ])

  return NextResponse.json({
    contact: {
      id: contact.id,
      contactHubspotId: contact.contactHubspotId,
      name: contact.name,
      contactType: contact.contactType,
      ownershipStatus: contact.ownershipStatus,
      isDeceased: contact.isDeceased,
      doNotContact: contact.doNotContact,
      phoneNumbers: rawPhones,
      emailList: Array.isArray(contact.emailList) ? contact.emailList : [],
      address: contact.address ?? null,
      city: contact.city ?? null,
      state: contact.state ?? null,
      zip: contact.zip ?? null,
    },
    stats: {
      ...stats,
      lastConversationDate: stats.lastConversationDate?.toISOString() ?? null,
      lastCallDate: stats.lastCallDate?.toISOString() ?? null,
    },
    recentCalls: recentCalls.map(c => ({
      id: c.id,
      happenedAt: c.happenedAt.toISOString(),
      direction: c.direction,
      outcome: c.outcome,
      durationSecs: c.durationSecs,
    })),
  })
}
