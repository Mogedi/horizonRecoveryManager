'use client'

import { createContext, useContext, useState, useRef, useCallback, type ReactNode } from 'react'

export type BulkCheckDeal = { hubspotId: string; name: string | null }

export type BulkCheckResult = {
  hubspotId: string
  name?: string | null
  filesLinked?: boolean
  sessionExpired?: boolean
  checkedAt?: string
  error?: string
  skipped?: boolean
}

type BulkHubspotCheckContextValue = {
  pending: BulkCheckDeal[]
  running: boolean
  results: BulkCheckResult[]
  progress: number                  // number of deals processed so far
  activeDealName: string | null     // deal currently being checked
  uncheckedOnly: boolean
  setUncheckedOnly: (v: boolean) => void
  reload: () => Promise<void>
  runAll: () => Promise<void>
  stop: () => void
  loadError: string | null
}

const BulkHubspotCheckContext = createContext<BulkHubspotCheckContextValue | null>(null)

function sleep(ms: number) {
  return new Promise<void>(resolve => setTimeout(resolve, ms))
}

export function BulkHubspotCheckProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<BulkCheckDeal[]>([])
  const [running, setRunning] = useState(false)
  const [results, setResults] = useState<BulkCheckResult[]>([])
  const [progress, setProgress] = useState(0)
  const [activeDealName, setActiveDealName] = useState<string | null>(null)
  const [uncheckedOnly, setUncheckedOnly] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const abortRef = useRef(false)

  const reload = useCallback(async () => {
    setLoadError(null)
    try {
      const url = `/api/admin/hubspot-check-all${uncheckedOnly ? '?uncheckedOnly=1' : ''}`
      const res = await fetch(url)
      if (!res.ok) throw new Error(`${res.status}`)
      const json = await res.json() as { pending: BulkCheckDeal[] }
      setPending(json.pending)
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Failed to load deals')
    }
  }, [uncheckedOnly])

  const runAll = useCallback(async () => {
    if (running) return
    setRunning(true)
    setResults([])
    setProgress(0)
    abortRef.current = false

    // Reload to get fresh list respecting uncheckedOnly flag
    let queue: BulkCheckDeal[] = []
    try {
      const url = `/api/admin/hubspot-check-all${uncheckedOnly ? '?uncheckedOnly=1' : ''}`
      const res = await fetch(url)
      if (!res.ok) throw new Error(`${res.status}`)
      const json = await res.json() as { pending: BulkCheckDeal[] }
      queue = json.pending
      setPending(json.pending)
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Failed to load deals')
      setRunning(false)
      return
    }

    for (const deal of queue) {
      if (abortRef.current) break
      setActiveDealName(deal.name)

      let result: BulkCheckResult
      try {
        const res = await fetch(`/api/deals/${deal.hubspotId}/drive/hubspot-check`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        })
        const json = await res.json()
        if (!res.ok || 'error' in json) {
          result = { hubspotId: deal.hubspotId, name: deal.name, error: json?.error ?? `Error ${res.status}` }
        } else {
          result = {
            hubspotId: deal.hubspotId,
            name: deal.name,
            filesLinked: json.filesLinked,
            sessionExpired: json.sessionExpired,
            checkedAt: json.checkedAt,
          }
          // If session expired on the first check, stop — all subsequent checks will fail too
          if (json.sessionExpired) {
            setResults(prev => [...prev, result])
            setProgress(prev => prev + 1)
            setActiveDealName(null)
            break
          }
        }
      } catch (e) {
        result = { hubspotId: deal.hubspotId, name: deal.name, error: e instanceof Error ? e.message : 'Network error' }
      }

      setResults(prev => [...prev, result])
      setProgress(prev => prev + 1)

      // Human-like delay between deals (8–15s) to avoid HubSpot/Cloudflare bot detection
      if (!abortRef.current) {
        await sleep(8000 + Math.random() * 7000)
      }
    }

    setActiveDealName(null)
    setRunning(false)
  }, [running, uncheckedOnly])

  const stop = useCallback(() => {
    abortRef.current = true
  }, [])

  return (
    <BulkHubspotCheckContext.Provider value={{
      pending, running, results, progress, activeDealName,
      uncheckedOnly, setUncheckedOnly,
      reload, runAll, stop, loadError,
    }}>
      {children}
    </BulkHubspotCheckContext.Provider>
  )
}

export function useBulkHubspotCheck() {
  const ctx = useContext(BulkHubspotCheckContext)
  if (!ctx) throw new Error('useBulkHubspotCheck must be used inside BulkHubspotCheckProvider')
  return ctx
}
