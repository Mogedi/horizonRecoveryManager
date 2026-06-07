'use client'

export default function SettingsError({
  error,
  reset,
}: {
  error: Error
  reset: () => void
}) {
  return (
    <div className="p-8 max-w-2xl mx-auto">
      <div className="px-5 py-4 bg-red-50 border border-red-200 rounded-lg">
        <p className="text-sm font-medium text-red-800">Settings failed to load</p>
        <p className="text-xs text-red-600 mt-1">{error.message}</p>
        <button
          onClick={reset}
          className="mt-3 px-3 py-1.5 text-xs text-white bg-red-700 rounded hover:bg-red-800"
        >
          Try again
        </button>
      </div>
    </div>
  )
}
