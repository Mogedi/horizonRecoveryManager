import type { ReactNode } from 'react'
import Link from 'next/link'
import LogoutButton from '@/components/LogoutButton'
import TaskCountBadge from '@/components/TaskCountBadge'

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Mobile warning — this dashboard requires a desktop browser */}
      <div className="md:hidden flex items-center justify-center min-h-screen p-8 bg-gray-50">
        <div className="text-center max-w-xs">
          <p className="text-base font-semibold text-gray-800">Desktop required</p>
          <p className="text-sm text-gray-500 mt-2">
            This dashboard is optimized for desktop browsers. Please open it on a laptop or desktop computer.
          </p>
        </div>
      </div>
    <div className="hidden md:flex min-h-screen bg-gray-50">
      <aside className="w-56 bg-white border-r border-gray-200 flex flex-col shrink-0">
        <div className="px-4 py-5 border-b border-gray-200">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Horizon Recovery</p>
        </div>
        <nav className="flex-1 px-2 py-4 space-y-1">
          <Link href="/dashboard" className="flex items-center px-3 py-2 text-sm text-gray-700 rounded-md hover:bg-gray-50">
            Queue
          </Link>
          <Link href="/dashboard/pipeline" className="flex items-center px-3 py-2 text-sm text-gray-700 rounded-md hover:bg-gray-50">
            Pipeline
          </Link>
          <Link href="/dashboard/contacts" className="flex items-center px-3 py-2 text-sm text-gray-700 rounded-md hover:bg-gray-50">
            Contacts
          </Link>
          <Link href="/dashboard/tasks" className="flex items-center px-3 py-2 text-sm text-gray-700 rounded-md hover:bg-gray-50">
            Tasks
            <TaskCountBadge />
          </Link>
          <Link href="/dashboard/research" className="flex items-center px-3 py-2 text-sm text-gray-700 rounded-md hover:bg-gray-50">
            Research
          </Link>
          <Link href="/dashboard/research/telemetry" className="flex items-center px-3 py-2 pl-6 text-xs text-gray-500 rounded-md hover:bg-gray-50">
            Telemetry
          </Link>
          <Link href="/dashboard/settings" className="flex items-center px-3 py-2 text-sm text-gray-700 rounded-md hover:bg-gray-50">
            Settings
          </Link>
        </nav>
        <div className="px-4 py-4 border-t border-gray-200">
          <LogoutButton />
        </div>
      </aside>
      <main className="flex-1 overflow-hidden">
        {children}
      </main>
    </div>
    </div>
  )
}
