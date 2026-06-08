'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import useSWR from 'swr'

const fetcher = (url: string) => fetch(url).then(r => r.ok ? r.json() : Promise.reject(new Error(r.statusText)))

type TaskDeal = { name: string | null; hubspotId: string } | null

type Task = {
  id: number
  dealHubspotId: string | null
  title: string
  notes: string | null
  status: 'open' | 'done'
  dueDate: string | null
  category: string
  createdAt: string
  completedAt: string | null
  deal: TaskDeal
}

type TasksResponse = { open: Task[]; completed: Task[] }

const CATEGORIES = ['case', 'business', 'vendor', 'legal', 'networking', 'other'] as const
type Category = typeof CATEGORIES[number]

const CATEGORY_LABELS: Record<Category, string> = {
  case: 'Case',
  business: 'Business',
  vendor: 'Vendor',
  legal: 'Legal',
  networking: 'Networking',
  other: 'Other',
}

function formatDueDate(dateStr: string | null): { label: string; overdue: boolean } {
  if (!dateStr) return { label: '', overdue: false }
  const due = new Date(dateStr)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const overdue = due < today
  const diffMs = due.getTime() - today.getTime()
  const diffDays = Math.round(diffMs / 86_400_000)
  let label: string
  if (diffDays === 0) label = 'Due today'
  else if (diffDays === 1) label = 'Due tomorrow'
  else if (diffDays === -1) label = 'Overdue by 1 day'
  else if (diffDays < 0) label = `Overdue by ${Math.abs(diffDays)} days`
  else label = `Due in ${diffDays} days`
  return { label, overdue }
}

function TaskItem({
  task,
  onComplete,
  onDelete,
  onOpenDeal,
}: {
  task: Task
  onComplete: (id: number) => void
  onDelete: (id: number) => void
  onOpenDeal: (hubspotId: string) => void
}) {
  const { label: dueDateLabel, overdue } = formatDueDate(task.dueDate)

  return (
    <div className="flex items-start gap-3 py-3 border-b border-gray-100 last:border-0 group">
      <button
        onClick={() => onComplete(task.id)}
        className="mt-0.5 w-4 h-4 rounded border border-gray-300 hover:border-gray-500 flex-shrink-0 flex items-center justify-center hover:bg-gray-50"
        title="Mark complete"
      >
      </button>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-gray-900 leading-snug">{task.title}</p>
        {task.notes && (
          <p className="text-xs text-gray-500 mt-0.5 truncate">{task.notes}</p>
        )}
        <div className="flex items-center gap-2 mt-1 flex-wrap">
          {task.deal && (
            <button
              onClick={() => onOpenDeal(task.deal!.hubspotId)}
              className="text-xs text-blue-600 hover:underline truncate max-w-[200px]"
              title="Open deal on dashboard"
            >
              {task.deal.name ?? task.deal.hubspotId}
            </button>
          )}
          {dueDateLabel && (
            <span className={`text-xs ${overdue ? 'text-red-600 font-medium' : 'text-gray-400'}`}>
              {dueDateLabel}
            </span>
          )}
        </div>
      </div>
      <button
        onClick={() => onDelete(task.id)}
        className="opacity-0 group-hover:opacity-100 text-xs text-gray-400 hover:text-red-600 transition-opacity px-1 flex-shrink-0"
        title="Delete task"
      >
        ✕
      </button>
    </div>
  )
}

function CompletedTaskItem({ task }: { task: Task }) {
  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-gray-100 last:border-0">
      <span className="mt-0.5 w-4 h-4 rounded border border-gray-300 bg-gray-100 flex-shrink-0 flex items-center justify-center text-gray-400 text-xs">
        ✓
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-gray-400 line-through leading-snug">{task.title}</p>
        {task.deal && (
          <p className="text-xs text-gray-400 mt-0.5 truncate">{task.deal.name ?? task.deal.hubspotId}</p>
        )}
      </div>
      <span className="text-xs text-gray-300 flex-shrink-0">
        {task.completedAt ? new Date(task.completedAt).toLocaleDateString() : ''}
      </span>
    </div>
  )
}

function AddTaskForm({ onCreated }: { onCreated: () => void }) {
  const [title, setTitle] = useState('')
  const [notes, setNotes] = useState('')
  const [category, setCategory] = useState<Category>('case')
  const [dueDate, setDueDate] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          notes: notes.trim() || null,
          category,
          dueDate: dueDate || null,
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body?.error ?? `Failed: ${res.status}`)
      }
      setTitle('')
      setNotes('')
      setDueDate('')
      setCategory('case')
      onCreated()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create task')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={submit} className="mb-6 p-4 bg-white border border-gray-200 rounded-lg">
      <div className="space-y-3">
        <input
          type="text"
          placeholder="Task title"
          value={title}
          onChange={e => setTitle(e.target.value)}
          className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-gray-400"
          required
        />
        <div className="flex gap-2">
          <select
            value={category}
            onChange={e => setCategory(e.target.value as Category)}
            className="px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-gray-400"
          >
            {CATEGORIES.map(c => (
              <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
            ))}
          </select>
          <input
            type="date"
            value={dueDate}
            onChange={e => setDueDate(e.target.value)}
            className="px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-gray-400"
          />
        </div>
        <textarea
          placeholder="Notes (optional)"
          value={notes}
          onChange={e => setNotes(e.target.value)}
          rows={2}
          className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-gray-400 resize-none"
        />
        {error && (
          <p className="text-xs text-red-600">{error}</p>
        )}
        <button
          type="submit"
          disabled={submitting || !title.trim()}
          className="px-4 py-2 text-sm text-white bg-gray-900 rounded-md hover:bg-gray-700 disabled:opacity-40"
        >
          {submitting ? 'Adding…' : 'Add Task'}
        </button>
      </div>
    </form>
  )
}

export default function TasksPage() {
  const router = useRouter()
  const { data, error, isLoading, mutate } = useSWR<TasksResponse>('/api/tasks', fetcher)
  const [showForm, setShowForm] = useState(false)

  const handleComplete = async (id: number) => {
    await fetch(`/api/tasks/${id}`, { method: 'PATCH' })
    await mutate()
  }

  const handleDelete = async (id: number) => {
    if (!confirm('Delete this task?')) return
    await fetch(`/api/tasks/${id}`, { method: 'DELETE' })
    await mutate()
  }

  const handleOpenDeal = (hubspotId: string) => {
    router.push(`/dashboard?deal=${hubspotId}`)
  }

  const openTasks = data?.open ?? []
  const completedTasks = data?.completed ?? []

  // Group open tasks by category
  const grouped = CATEGORIES.reduce<Record<Category, Task[]>>((acc, cat) => {
    acc[cat] = openTasks.filter(t => t.category === cat)
    return acc
  }, {} as Record<Category, Task[]>)

  return (
    <div className="p-8 max-w-2xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Tasks</h1>
          <p className="text-sm text-gray-500 mt-1">
            {openTasks.length} open task{openTasks.length !== 1 ? 's' : ''}
          </p>
        </div>
        <button
          onClick={() => setShowForm(v => !v)}
          className="px-3 py-1.5 text-sm text-white bg-gray-900 rounded-md hover:bg-gray-700"
        >
          {showForm ? 'Cancel' : '+ Add Task'}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {error.message ?? 'Failed to load tasks'}
        </div>
      )}

      {/* Add task form */}
      {showForm && (
        <AddTaskForm
          onCreated={() => {
            setShowForm(false)
            mutate()
          }}
        />
      )}

      {/* Loading */}
      {isLoading && (
        <div className="space-y-2">
          {[0, 1, 2].map(i => (
            <div key={i} className="h-12 bg-gray-100 rounded animate-pulse" />
          ))}
        </div>
      )}

      {/* Open tasks by category */}
      {!isLoading && (
        <>
          {openTasks.length === 0 ? (
            <div className="text-center py-16 text-gray-400 text-sm">
              No open tasks. Click "+ Add Task" to create one.
            </div>
          ) : (
            <div className="space-y-4">
              {CATEGORIES.filter(cat => grouped[cat].length > 0).map(cat => (
                <div key={cat} className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                  <div className="px-4 py-2 bg-gray-50 border-b border-gray-200">
                    <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                      {CATEGORY_LABELS[cat]}
                    </span>
                    <span className="ml-2 text-xs text-gray-400">
                      {grouped[cat].length}
                    </span>
                  </div>
                  <div className="px-4">
                    {grouped[cat].map(task => (
                      <TaskItem
                        key={task.id}
                        task={task}
                        onComplete={handleComplete}
                        onDelete={handleDelete}
                        onOpenDeal={handleOpenDeal}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Completed (last 30 days) */}
          {completedTasks.length > 0 && (
            <div className="mt-8">
              <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">
                Completed — last 30 days
              </h2>
              <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                <div className="px-4">
                  {completedTasks.map(task => (
                    <CompletedTaskItem key={task.id} task={task} />
                  ))}
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
