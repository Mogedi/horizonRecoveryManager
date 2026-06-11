import { TaskCategory, TaskStatus } from '@prisma/client'
import { prisma } from './client'

export type { TaskCategory, TaskStatus }

export type TaskRow = {
  id: number
  dealHubspotId: string | null
  title: string
  notes: string | null
  status: TaskStatus
  dueDate: Date | null
  category: TaskCategory
  source: string
  createdAt: Date
  completedAt: Date | null
  deal: { name: string | null; hubspotId: string } | null
}

export async function getOpenTasks(): Promise<TaskRow[]> {
  return prisma.internalTask.findMany({
    where: { status: TaskStatus.open },
    orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }],
    include: { deal: { select: { name: true, hubspotId: true } } },
  })
}

export async function getRecentCompletedTasks(days = 30): Promise<TaskRow[]> {
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - days)
  return prisma.internalTask.findMany({
    where: { status: TaskStatus.done, completedAt: { gte: cutoff } },
    orderBy: { completedAt: 'desc' },
    include: { deal: { select: { name: true, hubspotId: true } } },
  })
}

export async function getOpenTaskCount(): Promise<number> {
  return prisma.internalTask.count({ where: { status: TaskStatus.open } })
}

export type CreateTaskInput = {
  dealHubspotId?: string | null
  title: string
  notes?: string | null
  dueDate?: Date | null
  category: TaskCategory
  source?: string                 // 'manual' (UI) | 'hermes' (agent)
  idempotencyKey?: string | null  // agent retry-dedup
}

export async function createTask(input: CreateTaskInput): Promise<TaskRow> {
  return prisma.internalTask.create({
    data: {
      dealHubspotId: input.dealHubspotId ?? null,
      title: input.title,
      notes: input.notes ?? null,
      dueDate: input.dueDate ?? null,
      category: input.category,
      source: input.source ?? 'manual',
      idempotencyKey: input.idempotencyKey ?? null,
    },
    include: { deal: { select: { name: true, hubspotId: true } } },
  })
}

export async function getTaskById(id: number): Promise<TaskRow | null> {
  return prisma.internalTask.findUnique({
    where: { id },
    include: { deal: { select: { name: true, hubspotId: true } } },
  })
}

export async function getTaskByIdempotencyKey(idempotencyKey: string): Promise<TaskRow | null> {
  return prisma.internalTask.findUnique({
    where: { idempotencyKey },
    include: { deal: { select: { name: true, hubspotId: true } } },
  })
}

export async function completeTask(id: number): Promise<TaskRow> {
  return prisma.internalTask.update({
    where: { id },
    data: { status: TaskStatus.done, completedAt: new Date() },
    include: { deal: { select: { name: true, hubspotId: true } } },
  })
}

export async function deleteTask(id: number): Promise<void> {
  await prisma.internalTask.delete({ where: { id } })
}

export async function getOpenTaskCountForDeal(dealHubspotId: string): Promise<number> {
  return prisma.internalTask.count({
    where: { dealHubspotId, status: TaskStatus.open },
  })
}
