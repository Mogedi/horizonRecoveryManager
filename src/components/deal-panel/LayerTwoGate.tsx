'use client'

type LayerTwoGateProps = {
  layer2SyncedAt: string | null
  label: string
  children: React.ReactNode
}

export function LayerTwoGate({ layer2SyncedAt, label, children }: LayerTwoGateProps) {
  if (layer2SyncedAt) return <>{children}</>
  return (
    <div className="px-6 py-8 text-center">
      <p className="text-sm text-gray-400">Load full detail to see {label}</p>
    </div>
  )
}
