import { prisma } from './client'
import { PhoneStatus } from '@prisma/client'

// Look up the deal associated with a normalized E.164 phone number.
// Returns null if the number is not in the registry.
export async function lookupDealByPhone(numberE164: string): Promise<string | null> {
  const row = await prisma.phoneNumber.findFirst({
    where: { numberE164 },
    select: { dealHubspotId: true },
  })
  return row?.dealHubspotId ?? null
}

// Upsert a phone number into the registry.
// If the number already exists, updates status and lastSeenAt if provided.
export async function upsertPhoneNumber(
  numberE164: string,
  dealHubspotId: string | null,
  opts?: { contactName?: string; status?: PhoneStatus }
): Promise<void> {
  const existing = await prisma.phoneNumber.findFirst({ where: { numberE164, dealHubspotId } })

  if (existing) {
    await prisma.phoneNumber.update({
      where: { id: existing.id },
      data: {
        lastSeenAt: new Date(),
        ...(opts?.status ? { status: opts.status } : {}),
        ...(opts?.contactName ? { contactName: opts.contactName } : {}),
      },
    })
  } else {
    await prisma.phoneNumber.create({
      data: {
        numberE164,
        dealHubspotId,
        contactName: opts?.contactName ?? null,
        status: opts?.status ?? PhoneStatus.unknown,
        lastSeenAt: new Date(),
      },
    })
  }
}

// Mark a phone number as disconnected (called when JustCall confirms no answer repeatedly).
export async function markPhoneDisconnected(numberE164: string): Promise<void> {
  await prisma.phoneNumber.updateMany({
    where: { numberE164 },
    data: { status: PhoneStatus.disconnected, lastSeenAt: new Date() },
  })
}

// Populate phone_numbers from existing deal_contacts data (Layer 2 cache).
// Normalizes all phone numbers from deal_contacts.phoneNumbers JSON field.
// Returns counts: { processed, inserted, skipped }
export async function populateFromDealContacts(
  normalizeE164: (raw: string) => string | null
): Promise<{ processed: number; inserted: number; skipped: number }> {
  const contacts = await prisma.dealContact.findMany({
    where: { phoneNumbers: { not: null } },
    select: { dealHubspotId: true, name: true, phoneNumbers: true },
  })

  let processed = 0
  let inserted = 0
  let skipped = 0

  for (const contact of contacts) {
    const rawPhones = contact.phoneNumbers as string[] | null
    if (!rawPhones || !Array.isArray(rawPhones)) continue

    for (const raw of rawPhones) {
      if (typeof raw !== 'string') continue
      processed++

      const e164 = normalizeE164(raw)
      if (!e164) { skipped++; continue }

      const existing = await prisma.phoneNumber.findFirst({
        where: { numberE164: e164, dealHubspotId: contact.dealHubspotId },
      })
      if (!existing) {
        await prisma.phoneNumber.create({
          data: {
            numberE164: e164,
            dealHubspotId: contact.dealHubspotId,
            contactName: contact.name ?? null,
            status: PhoneStatus.unknown,
            lastSeenAt: new Date(),
          },
        })
        inserted++
      }
    }
  }

  return { processed, inserted, skipped }
}

// Get all phone numbers for a deal.
export async function getPhoneNumbersForDeal(dealHubspotId: string) {
  return prisma.phoneNumber.findMany({ where: { dealHubspotId }, orderBy: { createdAt: 'asc' } })
}
