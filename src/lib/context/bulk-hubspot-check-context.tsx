'use client'

import { createContext, useContext, useState, useRef, useCallback, type ReactNode } from 'react'

export type BulkCheckSkipCode = 'NO_FOLDER' | 'NO_SCREENSHOT' | 'SESSION_EXPIRED_PREV'

export type BulkCheckDeal = {
  hubspotId: string
  name: string | null
  hasFolder: boolean
  hasScreenshot: boolean
}

export type BulkCheckResult = {
  hubspotId: string
  name?: string | null
  filesLinked?: boolean
  sessionExpired?: boolean
  checkedAt?: string
  error?: string
  skipped?: boolean
  skipCode?: BulkCheckSkipCode
  skipReason?: string
}

type BulkHubspotCheckContextValue = {
  pending: BulkCheckDeal[]
  running: boolean
  results: BulkCheckResult[]
  progress: number
  activeDealName: string | null
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

      // ── Skip: no Drive folder ────────────────────────────────────────────────
      if (!deal.hasFolder) {
        result = {
          hubspotId: deal.hubspotId, name: deal.name,
          skipped: true, skipCode: 'NO_FOLDER', skipReason: 'No Drive folder linked',
        }
        setResults(prev => [...prev, result])
        setProgress(prev => prev + 1)
        setActiveDealName(null)
        continue
      }

      try {
        // ── Screenshot exists → reanalyze path (no browser) ──────────────────
        const endpoint = deal.hasScreenshot
          ? `/api/deals/${deal.hubspotId}/drive/hubspot-check/reanalyze`
          : `/api/deals/${deal.hubspotId}/drive/hubspot-check`

        const res = await fetch(endpoint, {
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
          // Session expired on browser check → stop all subsequent browser checks
          if (json.sessionExpired && !deal.hasScreenshot) {
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

      // Human-like delay between deals (8–15s) to avoid HubSpot/Cloudflare bot detection.
      // Reanalyze path skips the browser but still delays to avoid hammering the API.
      if (!abortRef.current && !deal.hasScreenshot) {
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
