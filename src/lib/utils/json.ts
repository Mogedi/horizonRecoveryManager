import { type Prisma } from '@prisma/client'

// Safely cast unknown values to Prisma's Json type.
// JSON.parse/stringify clone surfaces non-serializable content immediately
// rather than failing cryptically at DB write time.
export function asJson(v: unknown): Prisma.InputJsonValue | undefined {
  if (v === undefined) return undefined
  return JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue
}
