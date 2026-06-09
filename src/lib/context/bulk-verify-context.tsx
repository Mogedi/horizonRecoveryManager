'use client'

import { createContext, useContext, useState, useCallback, useRef, useEffect, type ReactNode } from 'react'

export type BulkVerifyDeal = { hubspotId: string; name: string | null }
export type BulkVerifyResult = {
  hubspotId: string
  name?: string | null
  overallMatch?: boolean
  confidence?: string
  summary?: string
  error?: string
  skipped?: boolean
  skipReason?: string   // human-readable reason from API when skipped is true
}

type BulkVerifyContextValue = {
  pending: BulkVerifyDeal[] | null
  running: boolean
  loadError: string | null
  results: BulkVerifyResult[]
  runQueue: BulkVerifyDeal[]
  activeDealNames: string[]
  currentRpm: number
  cooldownSecsLeft: number
  retryingSet: Set<string>
  runAll: () => Promise<void>
  stop: () => void
  retryDeal: (deal: BulkVerifyDeal) => Promise<void>
  reload: () => Promise<void>
}

const BulkVerifyContext = createContext<BulkVerifyContextValue | null>(null)

// 2 sequential workers — Anthropic Tier 1 allows 8,000 output tokens/minute.
// Natural backpressure: workers wait for a full response before starting the next deal.
// On 429: the affected worker cools down 60s (interruptible) and retries, up to 3×.
const CONCURRENCY = 2

export function BulkVerifyProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<BulkVerifyDeal[] | null>(null)
  const [running, setRunning] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [results, setResults] = useState<BulkVerifyResult[]>([])
  const [runQueue, setRunQueue] = useState<BulkVerifyDeal[]>([])
  const [activeDealNames, setActiveDealNames] = useState<string[]>([])
  const [currentRpm, setCurrentRpm] = useState(0)
  const [cooldownSecsLeft, setCooldownSecsLeft] = useState(0)
  const [retryingSet, setRetryingSet] = useState<Set<string>>(new Set())

  const abortRef = useRef(false)
  const nextIndexRef = useRef(0)
  const completedTsRef = useRef<number[]>([])
  const activeNamesRef = useRef(new Map<string, string>())

  const reload = useCallback(async () => {
    setLoadError(null)
    try {
      const res = await fetch('/api/admin/verify-all')
      if (!res.ok) throw new Error(`${res.status}`)
      const json = await res.json() as { count: number; deals: BulkVerifyDeal[] }
      setPending(json.deals)
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Failed to load')
    }
  }, [])

  useEffect(() => { reload() }, [reload])

  const upsertResult = useCallback((result: BulkVerifyResult) => {
    setResults(prev => {
      const idx = prev.findIndex(r => r.hubspotId === result.hubspotId)
      if (idx >= 0) { const next = [...prev]; next[idx] = result; return next }
      return [result, ...prev]
    })
  }, [])

  const recordCompletion = useCallback(() => {
    const now = Date.now()
    completedTsRef.current = completedTsRef.current.filter(t => now - t < 60_000)
    completedTsRef.current.push(now)
    setCurrentRpm(completedTsRef.current.length)
  }, [])

  const verifyOneDeal = useCallback(async (deal: BulkVerifyDeal): Promise<BulkVerifyResult> => {
    try {
      const res = await fetch('/api/admin/verify-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hubspotId: deal.hubspotId }),
      })
      const json = await res.json() as BulkVerifyResult & { reason?: string }
      return { ...json, name: json.name ?? deal.name, skipReason: json.skipReason ?? json.reason }
    } catch (e) {
      return { hubspotId: deal.hubspotId, name: deal.name, error: e instanceof Error ? e.message : 'Failed' }
    }
  }, [])

  const retryDeal = useCallback(async (deal: BulkVerifyDeal) => {
    setRetryingSet(prev => new Set([...prev, deal.hubspotId]))
    try {
      const result = await verifyOneDeal(deal)
      upsertResult(result)
      recordCompletion()
    } finally {
      setRetryingSet(prev => { const next = new Set(prev); next.delete(deal.hubspotId); return next })
    }
  }, [verifyOneDeal, upsertResult, recordCompletion])

  const runAll = useCallback(async () => {
    if (!pending || pending.length === 0) return
    abortRef.current = false
    setRunning(true)
    setCooldownSecsLeft(0)
    completedTsRef.current = []
    setCurrentRpm(0)
    activeNamesRef.current.clear()
    setActiveDealNames([])
    setRunQueue([...pending])
    nextIndexRef.current = 0

    const snap = [...pending]

    const workerFn = async (): Promise<void> => {
      while (!abortRef.current) {
        const idx = nextIndexRef.current++
        if (idx >= snap.length) break

        const deal = snap[idx]
        activeNamesRef.current.set(deal.hubspotId, deal.name ?? deal.hubspotId)
        setActiveDealNames([...activeNamesRef.current.values()])

        let finalResult: BulkVerifyResult | null = null

        for (let attempt = 0; attempt < 4 && !abortRef.current; attempt++) {
          const r = await verifyOneDeal(deal)
          const isRateLimit = !!(r.error?.includes('429') || r.error?.toLowerCase().includes('rate_limit'))

          if (!isRateLimit) {
            finalResult = r
            break
          }

          const retriesLeft = 3 - attempt
          upsertResult({
            ...r,
            error: `Rate limited — cooling down 60s (${retriesLeft} attempt${retriesLeft !== 1 ? 's' : ''} left)`,
          })

          for (let t = 120; t > 0 && !abortRef.current; t--) {
            setCooldownSecsLeft(Math.ceil(t / 2))
            await new Promise<void>(res => setTimeout(res, 500))
          }
          setCooldownSecsLeft(0)
        }

        if (finalResult === null) {
          finalResult = {
            hubspotId: deal.hubspotId,
            name: deal.name,
            error: 'Rate limited — 3 attempts exhausted, retry this deal manually',
          }
        }

        upsertResult(finalResult)
        recordCompletion()
        activeNamesRef.current.delete(deal.hubspotId)
        setActiveDealNames([...activeNamesRef.current.values()])
      }
    }

    await Promise.allSettled(Array.from({ length: CONCURRENCY }, workerFn))
    setCooldownSecsLeft(0)
    setActiveDealNames([])
    setRunning(false)
    reload()
  }, [pending, verifyOneDeal, upsertResult, recordCompletion, reload])

  const stop = useCallback(() => { abortRef.current = true }, [])

  return (
    <BulkVerifyContext.Provider value={{
      pending, running, loadError, results, runQueue, activeDealNames,
      currentRpm, cooldownSecsLeft, retryingSet,
      runAll, stop, retryDeal, reload,
    }}>
      {children}
    </BulkVerifyContext.Provider>
  )
}

export function useBulkVerify() {
  const ctx = useContext(BulkVerifyContext)
  if (!ctx) throw new Error('useBulkVerify must be used within BulkVerifyProvider')
  return ctx
}
