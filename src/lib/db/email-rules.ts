import { prisma } from './client'

// Learned per-sender rules for Gmail body-pulling. Decide once per sender, then cache.

export async function getAllSenderRules(): Promise<Map<string, boolean>> {
  const rows = await prisma.emailSenderRule.findMany({ select: { sender: true, pullBody: true } })
  return new Map(rows.map((r) => [r.sender, r.pullBody]))
}

export async function upsertSenderRule(
  sender: string,
  pullBody: boolean,
  opts: { classification?: string; reason?: string; confidence?: number; source?: string } = {}
): Promise<void> {
  const data = {
    pullBody,
    classification: opts.classification ?? null,
    reason: opts.reason ?? null,
    confidence: opts.confidence ?? null,
    source: opts.source ?? 'auto',
  }
  await prisma.emailSenderRule.upsert({
    where: { sender },
    create: { sender, ...data },
    update: data,
  })
}
