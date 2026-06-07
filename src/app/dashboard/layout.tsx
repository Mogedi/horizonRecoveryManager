import type { ReactNode } from 'react'
import Link from 'next/link'
import LogoutButton from '@/components/LogoutButton'

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50 flex">
      <aside className="w-56 bg-white border-r border-gray-200 flex flex-col shrink-0">
        <div className="px-4 py-5 border-b border-gray-200">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Horizon Recovery</p>
        </div>
        <nav className="flex-1 px-2 py-4 space-y-1">
          <Link href="/dashboard" className="flex items-center px-3 py-2 text-sm text-gray-700 rounded-md hover:bg-gray-50">
            Dashboard
          </Link>
          <Link href="/dashboard/tasks" className="flex items-center px-3 py-2 text-sm text-gray-700 rounded-md hover:bg-gray-50">
            Tasks
          </Link>
          <Link href="/dashboard/settings" className="flex items-center px-3 py-2 text-sm text-gray-700 rounded-md hover:bg-gray-50">
            Settings
          </Link>
          <Link href="/dashboard/roadmap" className="flex items-center px-3 py-2 text-sm text-gray-700 rounded-md hover:bg-gray-50">
            Roadmap
          </Link>
        </nav>
        <div className="px-4 py-4 border-t border-gray-200">
          <LogoutButton />
        </div>
      </aside>
      <main className="flex-1 overflow-auto">
        {children}
      </main>
    </div>
  )
}
