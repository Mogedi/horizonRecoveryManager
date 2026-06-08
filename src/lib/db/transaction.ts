import { prisma } from './client'
import type { Prisma } from '@prisma/client'

const DEFAULT_TIMEOUT_MS = 30_000
const DEFAULT_MAX_WAIT_MS = 5_000

export async function withTransaction<T>(
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  opts: { timeout?: number } = {}
): Promise<T> {
  return prisma.$transaction(fn, {
    timeout: opts.timeout ?? DEFAULT_TIMEOUT_MS,
    maxWait: DEFAULT_MAX_WAIT_MS,
  })
}

export async function withBatchTransaction<T>(
  ops: Prisma.PrismaPromise<T>[],
  opts: { timeout?: number } = {}
): Promise<T[]> {
  return prisma.$transaction(ops, {
    timeout: opts.timeout ?? DEFAULT_TIMEOUT_MS,
  })
}
