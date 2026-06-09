import { prisma } from './client'

export async function getContactsForDeal(hubspotId: string) {
  return prisma.dealContact.findMany({
    where: { dealHubspotId: hubspotId },
    select: {
      id: true,
      contactHubspotId: true,
      name: true,
      contactType: true,
      ownershipStatus: true,
      isDeceased: true,
      doNotContact: true,
      phoneNumbers: true,
      emailList: true,
      address: true,
      city: true,
      state: true,
      zip: true,
    },
  })
}

export type ContactStats = {
  totalCalls: number
  conversations: number
  lastConversationDate: Date | null
  lastCallDate: Date | null
  bestPhone: string | null
  bestPhoneSource: 'inferred'
}

export async function getContactStats(
  dealHubspotId: string,
  e164Phones: string[]
): Promise<ContactStats> {
  const empty: ContactStats = { totalCalls: 0, conversations: 0, lastConversationDate: null, lastCallDate: null, bestPhone: null, bestPhoneSource: 'inferred' }
  if (e164Phones.length === 0) return empty

  const calls = await prisma.activityEvent.findMany({
    where: {
      dealHubspotId,
      type: 'call',
      OR: [
        { toNumber: { in: e164Phones } },
        { fromNumber: { in: e164Phones } },
      ],
    },
    select: { happenedAt: true, outcome: true, toNumber: true, fromNumber: true },
  })

  if (calls.length === 0) return empty

  const answeredCalls = calls.filter(c => c.outcome === 'answered')

  const lastCallDate = calls.reduce<Date | null>((max, c) => !max || c.happenedAt > max ? c.happenedAt : max, null)
  const lastConversationDate = answeredCalls.reduce<Date | null>((max, c) => !max || c.happenedAt > max ? c.happenedAt : max, null)

  // Count answered calls per phone number to find the best
  const phoneCounts = new Map<string, number>()
  for (const call of answeredCalls) {
    const phone = call.toNumber ?? call.fromNumber
    if (phone) phoneCounts.set(phone, (phoneCounts.get(phone) ?? 0) + 1)
  }
  let bestPhone: string | null = null
  let bestCount = 0
  for (const [phone, count] of phoneCounts) {
    if (count > bestCount) { bestCount = count; bestPhone = phone }
  }

  return {
    totalCalls: calls.length,
    conversations: answeredCalls.length,
    lastConversationDate,
    lastCallDate,
    bestPhone,
    bestPhoneSource: 'inferred',
  }
}

export type ContactCall = {
  id: number
  happenedAt: Date
  direction: string | null
  outcome: string | null
  durationSecs: number | null
}

export async function getRecentCallsForContact(
  dealHubspotId: string,
  e164Phones: string[],
  limit = 5
): Promise<ContactCall[]> {
  if (e164Phones.length === 0) return []

  return prisma.activityEvent.findMany({
    where: {
      dealHubspotId,
      type: 'call',
      OR: [
        { toNumber: { in: e164Phones } },
        { fromNumber: { in: e164Phones } },
      ],
    },
    select: { id: true, happenedAt: true, direction: true, outcome: true, durationSecs: true },
    orderBy: { happenedAt: 'desc' },
    take: limit,
  })
}
