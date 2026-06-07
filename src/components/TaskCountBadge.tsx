'use client'

import { useEffect, useState } from 'react'

export default function TaskCountBadge() {
  const [count, setCount] = useState<number | null>(null)

  useEffect(() => {
    fetch('/api/tasks/count')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (typeof data?.count === 'number') setCount(data.count)
      })
      .catch(() => {})
  }, [])

  if (!count) return null

  return (
    <span className="ml-auto inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 rounded-full bg-gray-900 text-white text-xs font-medium">
      {count}
    </span>
  )
}
