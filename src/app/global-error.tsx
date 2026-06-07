'use client'
import * as Sentry from '@sentry/nextjs'
import { useEffect } from 'react'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    Sentry.captureException(error)
  }, [error])

  return (
    <html>
      <body className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8 max-w-md w-full">
          <h2 className="text-lg font-semibold text-gray-900 mb-2">Something went wrong</h2>
          <p className="text-sm text-gray-500 mb-4">
            An unexpected error occurred. It has been logged automatically.
          </p>
          {error.digest && (
            <p className="text-xs text-gray-400 font-mono mb-4">ID: {error.digest}</p>
          )}
          <button
            onClick={reset}
            className="bg-gray-900 text-white px-4 py-2 rounded-md text-sm hover:bg-gray-700 transition-colors"
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  )
}
