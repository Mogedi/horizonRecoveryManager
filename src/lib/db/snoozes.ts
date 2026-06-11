import { prisma } from './client'
import { SnoozeCategory } from '@prisma/client'

const VALID_CATEGORIES = new Set<string>(Object.values(SnoozeCategory))

export function isValidSnoozeCategory(s: string): s is SnoozeCategory {
  return VALID_CATEGORIES.has(s)
}

export async function getActiveSnooze(hubspotId: string) {
  const today = new Date()
  return prisma.dealSnooze.findFirst({
    where: { dealHubspotId: hubspotId, snoozeUntil: { gte: today }, wokeAt: null },
    orderBy: { createdAt: 'desc' },
  })
}

export async function getSnoozeHistory(hubspotId: string) {
  return prisma.dealSnooze.findMany({
    where: { dealHubspotId: hubspotId },
    orderBy: { createdAt: 'desc' },
  })
}

export async function getSnoozeByIdempotencyKey(idempotencyKey: string) {
  return prisma.dealSnooze.findUnique({ where: { idempotencyKey } })
}

export async function createSnooze(
  hubspotId: string,
  category: SnoozeCategory,
  snoozeUntil: Date,
  freeformNote?: string,
  idempotencyKey?: string | null
) {
  const today = new Date()
  // Deactivate any existing active snooze
  await prisma.dealSnooze.updateMany({
    where: { dealHubspotId: hubspotId, snoozeUntil: { gte: today }, wokeAt: null },
    data: { wokeAt: new Date() },
  })
  return prisma.dealSnooze.create({
    data: {
      dealHubspotId: hubspotId,
      category,
      snoozeUntil,
      freeformNote: freeformNote ?? null,
      idempotencyKey: idempotencyKey ?? null,
    },
  })
}

export async function removeActiveSnooze(hubspotId: string) {
  const today = new Date()
  await prisma.dealSnooze.updateMany({
    where: { dealHubspotId: hubspotId, snoozeUntil: { gte: today }, wokeAt: null },
    data: { wokeAt: new Date() },
  })
}
