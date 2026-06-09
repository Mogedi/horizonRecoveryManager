'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { formatAmount, relativeDate, formatDate } from '@/lib/utils/format'
import { refreshHighlight } from '@/lib/utils/search-highlight'
import { DealBadges } from '@/components/analytics/DealBadges'
import { SectionHeader, ActivityItem, ContactItem } from './deal-panel/shared'
import { OutreachSection } from './deal-panel/OutreachSection'
import { AiSummaryBlock } from './deal-panel/AiSummaryBlock'
import { SnoozeModal } from './deal-panel/SnoozeModal'
import { ContactPanel } from './ContactPanel'
import { TaskPromptInline } from './deal-panel/TaskPromptInline'
import type { PanelData, OutreachMatrix } from './deal-panel/types'
import { SNOOZE_CATEGORY_LABELS } from './deal-panel/types'

type GmailEmail = {
  id: number
  externalId: string
  happenedAt: string
  direction: string | null
  body: string | null
  metadata: { subject?: string; from?: string; to?: string } | null
}

type DriveFile = {
  id: string
  name: string
  mimeType: string
  modifiedAt: string | null
  webViewLink: string | null
  iconLink: string | null
  sizeBytes?: number | null
}

type DocStatus = {
  type: string
  label: string
  found: boolean
  file: DriveFile | null
  possibleMatch: DriveFile | null
  possibleMatchReason: string | null
}

type DocChecklist = {
  required: DocStatus[]
  unclassified: DriveFile[]
}

type DocEvidence = {
  propertyAddress: string | null
  parcelId: string | null
  saleDate: string | null
  grantor: string | null
  grantee: string | null
  otherDetails: string | null
}

type RequiredDocResult = {
  type: string
  label: string
  status: 'present_verified' | 'present_mismatch' | 'present_unverified' | 'missing'
  fileId: string | null
  fileName: string | null
  details: string
  evidence: DocEvidence | null
  mismatches: string[]
}

type ConsolidatedData = {
  propertyAddress: string | null
  parcelId: string | null
  taxSaleDate: string | null
  saleAmount: string | null
  grantor: string | null
  grantee: string | null
  county: string | null
  state: string | null
  zipCode: string | null
  bookPage: string | null
  currentOwner: string | null
  assessedValue: string | null
  deedRecordedDate: string | null
  taxLienAgainst: string | null
  taxLienDebtors: string[] | null
}

type OwnerTrackingEntry = { name: string; tracked: boolean }

type VerifyReport = {
  fileClassifications: Array<{ fileId: string; fileName: string; docType: string; confidence: string; extractedDetails: string }>
  requiredDocuments: RequiredDocResult[]
  consolidatedData: ConsolidatedData
  summary: string
  overallMatch: boolean
  confidence: 'high' | 'medium' | 'low'
  confidenceReason: string
  ownerTrackingCheck: OwnerTrackingEntry[] | null
  propertyContext: { address: string | null; parcelId: string | null; taxSaleDate: string | null }
  skippedFiles: string[]
  verifiedAt: string
}

type DriveResult = {
  configured: boolean
  matchMethod: 'cached' | 'exact_folder' | 'fuzzy_folder' | 'fulltext_fallback' | 'unconfigured_fallback' | null
  folderPath: string | null
  folderLink: string | null
  files: DriveFile[]
  docChecklist: DocChecklist
  docVerification: VerifyReport | null
  docVerificationAt: string | null
  hubspotCheck: HubSpotCheckResult | null
  hubspotCheckAt: string | null
  hubspotScreenshot: string | null
  hubspotDocStatus: HubSpotDocStatusEntry[] | null
  stale: boolean
  cachedAt: string | null
  warning: string | null
}

// Per-doc-type HubSpot link status — mirrors HubSpotDocStatus from drive-check.ts
type HubSpotDocStatusEntry = {
  type: string
  label: string
  linked: boolean
  fileName: string | null
}

type HubSpotCheckResult = {
  checked: boolean
  filesLinked: boolean
  linkedFiles: string[]
  missingFiles: string[]
  confidence: 'high' | 'medium' | 'low'
  findings: string[]
  sessionExpired: boolean
  screenshotBase64: string | null
  checkedAt: string
  // Per-doc-type link status — populated from DB (via drive route) or SSE verdict event.
  // This is the primary source for HS badges — avoids re-doing string matching at display time.
  docStatuses: HubSpotDocStatusEntry[] | null
}

export default function DealPanel({
  hubspotId,
  onClose,
  inline = false,
}: {
  hubspotId: string
  onClose: () => void
  inline?: boolean
}) {
  const [data, setData] = useState<PanelData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [outreachData, setOutreachData] = useState<OutreachMatrix | null>(null)
  const [outreachError, setOutreachError] = useState<string | null>(null)

  const [layer2State, setLayer2State] = useState<'idle' | 'confirming' | 'loading' | 'done'>('idle')
  const [layer2CallMsg, setLayer2CallMsg] = useState<string | null>(null)
  const [layer2Error, setLayer2Error] = useState<string | null>(null)

  const [showSnooze, setShowSnooze] = useState(false)
  const [selectedContactId, setSelectedContactId] = useState<number | null>(null)
  const [snoozeRemoving, setSnoozeRemoving] = useState(false)
  const [showSnoozeHistory, setShowSnoozeHistory] = useState(false)

  const [summaryState, setSummaryState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [summaryError, setSummaryError] = useState<string | null>(null)
  const [taskPromptState, setTaskPromptState] = useState<'idle' | 'open' | 'done' | 'dismissed'>('idle')

  const [gmailEmails, setGmailEmails] = useState<GmailEmail[] | null>(null)
  const [driveResult, setDriveResult] = useState<DriveResult | null>(null)
  const [driveLoading, setDriveLoading] = useState(true)
  const [driveError, setDriveError] = useState<string | null>(null)
  const [verifyState, setVerifyState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [verifyReport, setVerifyReport] = useState<VerifyReport | null>(null)
  const [hubspotCheckState, setHubspotCheckState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [hubspotCheckResult, setHubspotCheckResult] = useState<HubSpotCheckResult | null>(null)
  const [hubspotScreenshotPending, setHubspotScreenshotPending] = useState(false)
  const [showHubspotScreenshot, setShowHubspotScreenshot] = useState(false)
  const [hubspotCheckStep, setHubspotCheckStep] = useState(0)
  const hubspotCheckStepRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [preCheckPrompt, setPreCheckPrompt] = useState<null | 'verify-first' | 'use-screenshot'>(null)
  const pendingHubspotCheckRef = useRef(false)
  const [verifyError, setVerifyError] = useState<string | null>(null)
  // docType → fileId manually assigned by Mo
  const [manualOverrides, setManualOverrides] = useState<Record<string, string>>({})

  // Link folder flow (used when Drive returns fulltext_fallback)
  const [linkFolderStep, setLinkFolderStep] = useState<'idle' | 'input' | 'preview' | 'linking' | 'error'>('idle')
  const [linkFolderUrl, setLinkFolderUrl] = useState('')
  const [linkFolderPreview, setLinkFolderPreview] = useState<{ id: string; name: string; fileCount: number; webViewLink: string | null } | null>(null)
  const [linkFolderError, setLinkFolderError] = useState<string | null>(null)
  const fetchGmail = useCallback(async () => {
    const res = await fetch(`/api/deals/${hubspotId}/google`)
    if (res.ok) {
      const json = await res.json()
      setGmailEmails(json.emails ?? [])
    }
  }, [hubspotId])

  const fetchDrive = useCallback(async () => {
    setDriveLoading(true)
    setDriveError(null)
    try {
      const res = await fetch(`/api/deals/${hubspotId}/drive`)
      if (!res.ok) throw new Error(`${res.status}`)
      const json: DriveResult = await res.json()
      setDriveResult(json.configured ? json : null)
      // Hydrate cached verification result — so the panel shows saved data immediately
      if (json.docVerification) {
        setVerifyReport(json.docVerification)
        setVerifyState('done')
      }
      // Hydrate saved HubSpot check — shows last-checked result without re-running
      if (json.hubspotCheck) {
        setHubspotCheckResult({
          ...json.hubspotCheck,
          screenshotBase64: json.hubspotScreenshot,
          docStatuses: json.hubspotDocStatus ?? null,
        })
        setHubspotCheckState('done')
        setHubspotScreenshotPending(false)
      }
    } catch (e) {
      setDriveError(e instanceof Error ? e.message : 'Drive unavailable')
    } finally {
      setDriveLoading(false)
    }
  }, [hubspotId])

  const runVerify = useCallback(async (overrides?: Record<string, string>) => {
    setVerifyState('loading')
    setVerifyError(null)
    try {
      const res = await fetch(`/api/deals/${hubspotId}/drive/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ overrides: overrides ?? manualOverrides }),
      })
      const json = await res.json()
      if (!res.ok) {
        setVerifyError(json?.error ?? `Error ${res.status}`)
        setVerifyState('error')
        return
      }
      setVerifyReport(json)
      setVerifyState('done')
    } catch (e) {
      setVerifyError(e instanceof Error ? e.message : 'Verification failed')
      setVerifyState('error')
    }
  }, [hubspotId, manualOverrides])

  const assignDoc = useCallback((docType: string, file: DriveFile) => {
    const next = { ...manualOverrides, [docType]: file.id }
    setManualOverrides(next)
    // immediately re-verify with the new assignment
    runVerify(next)
  }, [manualOverrides, runVerify])

  const runHubspotCheck = useCallback(async () => {
    setPreCheckPrompt(null)
    setHubspotCheckState('loading')
    setHubspotCheckResult(null)
    setHubspotScreenshotPending(false)
    setShowHubspotScreenshot(false)
    setHubspotCheckStep(0)
    hubspotCheckStepRef.current = setInterval(() => {
      setHubspotCheckStep(s => Math.min(s + 1, 1))
    }, 4000)
    try {
      const res = await fetch(`/api/deals/${hubspotId}/drive/hubspot-check/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      if (!res.ok || !res.body) { setHubspotCheckState('error'); return }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const parts = buf.split('\n\n')
        buf = parts.pop() ?? ''
        for (const part of parts) {
          if (!part.startsWith('data: ')) continue
          try {
            const event = JSON.parse(part.slice(6)) as { type: string; [k: string]: unknown }
            if (event.type === 'verdict') {
              if (hubspotCheckStepRef.current) clearInterval(hubspotCheckStepRef.current)
              setHubspotCheckResult({
                ...(event as unknown as HubSpotCheckResult),
                screenshotBase64: null,
                docStatuses: (event as { docStatuses?: HubSpotDocStatusEntry[] }).docStatuses ?? null,
              })
              setHubspotCheckState('done')
              setHubspotScreenshotPending(true)
            } else if (event.type === 'screenshot') {
              setHubspotCheckResult(prev => prev ? { ...prev, screenshotBase64: event.base64 as string } : prev)
              setHubspotScreenshotPending(false)
            } else if (event.type === 'error') {
              setHubspotCheckState('error')
            }
          } catch { /* ignore malformed event */ }
        }
      }
    } catch {
      setHubspotCheckState('error')
    } finally {
      if (hubspotCheckStepRef.current) clearInterval(hubspotCheckStepRef.current)
    }
  }, [hubspotId])

  const runReanalyze = useCallback(async () => {
    setPreCheckPrompt(null)
    setHubspotCheckState('loading')
    setHubspotCheckStep(0)
    setHubspotScreenshotPending(false)
    try {
      const res = await fetch(`/api/deals/${hubspotId}/drive/hubspot-check/reanalyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const json = await res.json()
      if (!res.ok || 'error' in json) { setHubspotCheckState('error'); return }
      setHubspotCheckResult({ ...json, screenshotBase64: json.screenshotBase64 ?? null })
      setHubspotCheckState('done')
    } catch {
      setHubspotCheckState('error')
    }
  }, [hubspotId])

  const fetchDeal = useCallback(async () => {
    setError(null)
    try {
      const [dealRes, outreachRes] = await Promise.all([
        fetch(`/api/deals/${hubspotId}`),
        fetch(`/api/deals/${hubspotId}/outreach`),
      ])
      if (!dealRes.ok) throw new Error(`${dealRes.status} ${dealRes.statusText}`)
      const json = await dealRes.json()
      setData(json)
      if (json.layer2SyncedAt) setLayer2State('done')
      if (json.summaryData) setSummaryState('done')
      if (outreachRes.ok) {
        const outreach = await outreachRes.json()
        setOutreachData(outreach)
        setOutreachError(null)
      } else {
        const body = await outreachRes.json().catch(() => ({}))
        setOutreachError(body?.error ?? `Outreach data unavailable (${outreachRes.status})`)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load deal')
    } finally {
      setLoading(false)
    }
  }, [hubspotId])

  useEffect(() => { fetchDeal() }, [fetchDeal])
  useEffect(() => { fetchGmail() }, [fetchGmail])
  useEffect(() => { fetchDrive() }, [fetchDrive])
  useEffect(() => { if (!loading && data) refreshHighlight() }, [loading, data])

  // Auto-advance to HubSpot check after "Verify first" prompt verify completes
  useEffect(() => {
    if (!pendingHubspotCheckRef.current || verifyState !== 'done') return
    pendingHubspotCheckRef.current = false
    const hasShot = !!(driveResult?.hubspotScreenshot || hubspotCheckResult?.screenshotBase64)
    if (hasShot) setPreCheckPrompt('use-screenshot')
    else void runHubspotCheck()
  }, [verifyState, driveResult, hubspotCheckResult, runHubspotCheck])

  const startLayer2 = async () => {
    setLayer2State('confirming')
    const res = await fetch(`/api/sync/layer2/${hubspotId}`)
    const json = await res.json()
    setLayer2CallMsg(json.callRangeMessage ?? '5–50+ API calls')
  }

  const confirmLayer2 = async () => {
    setLayer2State('loading')
    setLayer2Error(null)
    try {
      const res = await fetch(`/api/sync/layer2/${hubspotId}`, { method: 'POST' })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body?.error ?? `Sync failed: ${res.status}`)
      }
      await fetchDeal()
      setLayer2State('done')
    } catch (e) {
      setLayer2Error(e instanceof Error ? e.message : 'Layer 2 sync failed')
      setLayer2State('idle')
    }
  }

  const removeSnooze = async () => {
    setSnoozeRemoving(true)
    try {
      await fetch(`/api/deals/${hubspotId}/snooze`, { method: 'DELETE' })
      await fetchDeal()
    } finally {
      setSnoozeRemoving(false)
    }
  }

  const generateSummary = async () => {
    setSummaryState('loading')
    setSummaryError(null)
    setTaskPromptState('idle')
    try {
      const res = await fetch(`/api/deals/${hubspotId}/summary`, { method: 'POST' })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body?.error ?? `Failed: ${res.status}`)
      }
      const result = await res.json()
      await fetchDeal()
      setSummaryState('done')
      if (result.summary?.mo_action_required === true) {
        setTaskPromptState('open')
      }
    } catch (e) {
      setSummaryError(e instanceof Error ? e.message : 'Summary generation failed')
      setSummaryState('error')
    }
  }

  const { deal, activities, contacts, snooze, snoozeHistory, summaryData } = data ?? {}

  const panelContent = (
    <div id="deal-panel" className={inline ? 'h-full flex flex-col bg-white overflow-hidden' : 'fixed right-0 top-0 h-full z-50 w-full max-w-xl bg-white shadow-2xl flex flex-col overflow-hidden'}>
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-200 shrink-0">
        <div className="flex items-start justify-between gap-3">
          <button onClick={onClose} className="text-xs text-gray-400 hover:text-gray-600 mt-0.5 shrink-0">
            ✕ Close
          </button>
          {deal?.hubspotUrl && (
            <a
              href={deal.hubspotUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-blue-600 hover:underline shrink-0"
            >
              Open in HubSpot ↗
            </a>
          )}
        </div>

        {loading && <div className="mt-3 h-5 w-48 bg-gray-100 rounded animate-pulse" />}
        {!loading && deal && (
          <div className="mt-2">
            <h2 className="font-semibold text-gray-900 text-base leading-snug">
              {deal.name ?? 'Unnamed deal'}
            </h2>
            <p className="text-xs text-gray-500 mt-1">
              {deal.stageName ?? deal.stage ?? '—'}
              {deal.ownerName ? ` · ${deal.ownerName}` : ''}
              {deal.amount ? ` · ${formatAmount(deal.amount)}` : ''}
            </p>
            {deal.propertyAddress && (
              <p className="text-xs text-gray-500 mt-0.5">
                {deal.propertyAddress}
              </p>
            )}
            {deal.parcelId && (
              <p className="text-xs text-gray-400 mt-0.5">
                {deal.parcelId}
              </p>
            )}
            {data?.enriched && (
              <DealBadges enriched={data.enriched} />
            )}
          </div>
        )}
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {error && (
          <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            {error}
          </div>
        )}

        {!loading && deal && (
          <>
            {/* Snooze status + actions */}
            <div className="flex items-center gap-2 mb-4">
              {snooze ? (
                <div className="flex-1 flex items-center gap-2 px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg">
                  <span className="text-xs text-gray-500 flex-1">
                    Snoozed until {formatDate(snooze.snoozeUntil)} · {SNOOZE_CATEGORY_LABELS[snooze.category] ?? snooze.category}
                    {snooze.freeformNote ? ` — ${snooze.freeformNote}` : ''}
                  </span>
                  <button
                    onClick={removeSnooze}
                    disabled={snoozeRemoving}
                    className="text-xs text-gray-400 hover:text-red-600 disabled:opacity-40 shrink-0"
                  >
                    {snoozeRemoving ? '…' : 'Remove'}
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setShowSnooze(true)}
                  className="px-3 py-1.5 text-sm text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
                >
                  Snooze
                </button>
              )}
            </div>

            {/* Layer 2 pull */}
            {layer2State === 'idle' && (
              <button
                onClick={startLayer2}
                className="w-full py-2 text-sm text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 mb-4"
              >
                Load Full Detail
              </button>
            )}
            {layer2State === 'confirming' && (
              <div className="mb-4 px-4 py-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                <p className="text-sm text-yellow-800 mb-2">{layer2CallMsg}</p>
                <div className="flex gap-2">
                  <button
                    onClick={confirmLayer2}
                    className="px-3 py-1.5 text-sm text-white bg-gray-900 rounded-md hover:bg-gray-700"
                  >
                    Confirm — Load
                  </button>
                  <button
                    onClick={() => setLayer2State('idle')}
                    className="px-3 py-1.5 text-sm text-gray-600 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
            {layer2State === 'loading' && (
              <div className="mb-4 px-4 py-3 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-500 animate-pulse">
                Loading full detail from HubSpot…
              </div>
            )}
            {layer2Error && (
              <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                {layer2Error}
              </div>
            )}
            {layer2State === 'done' && (
              <button
                onClick={startLayer2}
                className="text-xs text-gray-400 hover:text-gray-600 mb-4"
              >
                ↻ Refresh contacts & activity from HubSpot
              </button>
            )}

            {/* AI Summary */}
            {layer2State === 'done' && (
              <>
                <SectionHeader title="AI Summary" />
                {summaryState === 'idle' && (
                  <button
                    onClick={generateSummary}
                    className="w-full py-2 text-sm text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 mb-4"
                  >
                    Generate AI Summary
                  </button>
                )}
                {summaryState === 'loading' && (
                  <div className="mb-4 px-4 py-3 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-500 animate-pulse">
                    Generating summary — this may take up to 20 seconds…
                  </div>
                )}
                {summaryState === 'error' && (
                  <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-lg">
                    <p className="text-sm font-medium text-red-800">Summary unavailable</p>
                    {summaryError && (
                      <p className="text-xs text-red-600 mt-0.5">{summaryError}</p>
                    )}
                    <button
                      onClick={generateSummary}
                      className="mt-2 text-xs text-red-700 underline"
                    >
                      Retry
                    </button>
                  </div>
                )}
                {summaryState === 'done' && summaryData && (
                  <AiSummaryBlock
                    summary={summaryData.json}
                    generatedAt={summaryData.generatedAt}
                    lastActivityDate={deal.lastActivityDate}
                    onRegenerate={generateSummary}
                  />
                )}
                {summaryState === 'done' && summaryData?.json.mo_action_required && taskPromptState === 'open' && (
                  <TaskPromptInline
                    suggestedTitle={summaryData.json.suggested_next_step}
                    hubspotId={hubspotId}
                    onDone={() => setTaskPromptState('done')}
                    onDismiss={() => setTaskPromptState('dismissed')}
                  />
                )}
                {summaryState === 'done' && taskPromptState === 'done' && (
                  <div className="mb-4 px-3 py-2 bg-green-50 border border-green-200 rounded text-xs text-green-700">
                    Task created and added to your task list.
                  </div>
                )}
              </>
            )}

            {/* Call Outreach — primary contact view when outreach data is available */}
            {outreachError && (
              <>
                <SectionHeader title="Call Outreach" />
                <div className="mb-4 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">
                  {outreachError} — try refreshing or restarting the dev server
                </div>
              </>
            )}
            {outreachData && !outreachError && (
              <OutreachSection
                matrix={outreachData}
                panelContacts={contacts ?? []}
              />
            )}

            {/* Contacts — only shown when outreach data is NOT available */}
            {!outreachData && !outreachError && (
              <>
                <SectionHeader title={
                  layer2State === 'done'
                    ? `Contacts (${contacts?.length ?? 0})`
                    : `Contacts (${deal.contactCount > 0 ? `${deal.contactCount} — load full detail for names` : '0'})`
                } />
                {contacts && contacts.length > 0 ? (
                  contacts.map(c => (
                    <ContactItem key={c.id} contact={c} onSelect={() => setSelectedContactId(c.id)} />
                  ))
                ) : (
                  <p className="text-sm text-gray-400">
                    {layer2State === 'done' ? 'No contacts linked' : 'Load full detail to see contacts'}
                  </p>
                )}
              </>
            )}

            {/* Activity timeline */}
            <SectionHeader title={`Activity (${activities?.length ?? 0})`} />
            {activities && activities.length > 0 ? (
              activities.map(a => <ActivityItem key={a.id} activity={a} />)
            ) : (
              <p className="text-sm text-gray-400">
                {layer2State === 'done' ? 'No activity recorded' : 'Load full detail to see activity timeline'}
              </p>
            )}

            {/* Gmail */}
            {gmailEmails !== null && (
              <>
                <SectionHeader title={`Gmail (${gmailEmails.length})`} />
                {gmailEmails.length === 0 ? (
                  <p className="text-sm text-gray-400 mb-4">No emails linked to this deal</p>
                ) : (
                  <div className="space-y-2 mb-4">
                    {gmailEmails.slice(0, 10).map(email => {
                      const meta = email.metadata as { subject?: string; from?: string; to?: string } | null
                      return (
                        <div key={email.id} className="px-3 py-2 bg-gray-50 rounded-lg text-xs">
                          <div className="flex items-center justify-between gap-2 mb-0.5">
                            <span className="font-medium text-gray-800 truncate">
                              {meta?.subject ?? '(no subject)'}
                            </span>
                            <span className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded-full ${
                              email.direction === 'outbound'
                                ? 'bg-blue-100 text-blue-700'
                                : 'bg-gray-100 text-gray-500'
                            }`}>
                              {email.direction === 'outbound' ? 'sent' : 'received'}
                            </span>
                          </div>
                          <p className="text-gray-500 truncate">
                            {email.direction === 'outbound' ? `To: ${meta?.to ?? '—'}` : `From: ${meta?.from ?? '—'}`}
                          </p>
                          <p className="text-gray-400 mt-0.5">{relativeDate(email.happenedAt)}</p>
                        </div>
                      )
                    })}
                    {gmailEmails.length > 10 && (
                      <p className="text-xs text-gray-400">+ {gmailEmails.length - 10} more</p>
                    )}
                  </div>
                )}
              </>
            )}

            {/* Drive */}
            <div className="flex items-center justify-between mb-1">
              <SectionHeader title="Google Drive" />
              {driveResult && (
                <button
                  onClick={() => {
                    if (hubspotCheckState === 'loading') return
                    const hasShot = !!(driveResult.hubspotScreenshot || hubspotCheckResult?.screenshotBase64)
                    if (!verifyReport) {
                      setPreCheckPrompt('verify-first')
                    } else if (hasShot) {
                      setPreCheckPrompt('use-screenshot')
                    } else {
                      void runHubspotCheck()
                    }
                  }}
                  disabled={hubspotCheckState === 'loading'}
                  className="shrink-0 flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-md bg-white border border-gray-300 text-gray-600 hover:border-blue-400 hover:text-blue-600 hover:bg-blue-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  title="Screenshot HubSpot deal page and verify Drive files are linked"
                >
                  <span>📷</span>
                  <span>{hubspotCheckState === 'loading' ? 'Checking…' : hubspotCheckResult ? '↻ Recheck HubSpot' : 'Check HubSpot'}</span>
                </button>
              )}
            </div>

            {/* Pre-check prompts — shown before launching browser or reanalyze */}
            {preCheckPrompt === 'verify-first' && (
              <div className="mb-3 px-3 py-2.5 bg-amber-50 border border-amber-200 rounded-lg">
                <p className="text-xs text-amber-800 mb-2">
                  Documents haven&apos;t been verified — file detection will use the classifier, which may miss matches.
                </p>
                <div className="flex gap-2 flex-wrap">
                  <button
                    onClick={() => {
                      pendingHubspotCheckRef.current = true
                      setPreCheckPrompt(null)
                      void runVerify()
                    }}
                    className="text-[11px] px-2.5 py-1 rounded-md bg-amber-700 text-white hover:bg-amber-800 transition-colors"
                  >
                    Verify documents first
                  </button>
                  <button
                    onClick={() => void runHubspotCheck()}
                    className="text-[11px] px-2.5 py-1 rounded-md bg-white border border-amber-300 text-amber-800 hover:bg-amber-100 transition-colors"
                  >
                    Run check anyway
                  </button>
                  <button
                    onClick={() => setPreCheckPrompt(null)}
                    className="text-[11px] px-2.5 py-1 rounded-md text-gray-500 hover:text-gray-700 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {preCheckPrompt === 'use-screenshot' && (
              <div className="mb-3 px-3 py-2.5 bg-blue-50 border border-blue-200 rounded-lg">
                <p className="text-xs text-blue-800 mb-2">
                  A screenshot already exists for this deal.
                </p>
                <div className="flex gap-2 flex-wrap">
                  <button
                    onClick={() => void runReanalyze()}
                    className="text-[11px] px-2.5 py-1 rounded-md bg-blue-600 text-white hover:bg-blue-700 transition-colors"
                  >
                    Re-analyze existing screenshot
                  </button>
                  <button
                    onClick={() => void runHubspotCheck()}
                    className="text-[11px] px-2.5 py-1 rounded-md bg-white border border-blue-300 text-blue-700 hover:bg-blue-100 transition-colors"
                  >
                    Take fresh screenshot
                  </button>
                  <button
                    onClick={() => setPreCheckPrompt(null)}
                    className="text-[11px] px-2.5 py-1 rounded-md text-gray-500 hover:text-gray-700 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* HubSpot check — loading state with step progress */}
            {hubspotCheckState === 'loading' && (() => {
              const steps = [
                'Opening HubSpot deal page…',
                'Reading file list from sidebar…',
              ]
              return (
                <div className="mb-3 px-3 py-2.5 bg-blue-50 border border-blue-100 rounded-lg">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-3 h-3 border-2 border-blue-400 border-t-transparent rounded-full animate-spin shrink-0" />
                    <p className="text-xs font-medium text-blue-700">{steps[hubspotCheckStep]}</p>
                  </div>
                  <div className="flex gap-1">
                    {steps.map((_, i) => (
                      <div key={i} className={`h-1 flex-1 rounded-full transition-colors ${i <= hubspotCheckStep ? 'bg-blue-400' : 'bg-blue-100'}`} />
                    ))}
                  </div>
                </div>
              )
            })()}

            {/* HubSpot check — result card: session warning (if any) + screenshot thumbnail */}
            {hubspotCheckState === 'done' && hubspotCheckResult && (
              <div className="mb-3 border border-gray-200 rounded-lg overflow-hidden">
                {/* Session expired warning — only shown when cookies need refreshing */}
                {hubspotCheckResult.sessionExpired && (
                  <div className="px-3 py-2 flex items-center gap-2 bg-gray-50">
                    <span className="text-sm shrink-0 text-gray-400">⚠</span>
                    <p className="text-[11px] font-medium text-gray-600">Session expired — re-capture cookies</p>
                  </div>
                )}
                {/* Phase 2: screenshot still loading in background */}
                {hubspotScreenshotPending && !hubspotCheckResult.screenshotBase64 && (
                  <div className="px-3 py-1.5 border-t border-gray-100 flex items-center gap-2 bg-gray-50/60">
                    <div className="w-2.5 h-2.5 border-2 border-gray-300 border-t-gray-500 rounded-full animate-spin shrink-0" />
                    <span className="text-[10px] text-gray-400">Capturing screenshot…</span>
                  </div>
                )}
                {/* Screenshot thumbnail — appears when Phase 2 completes */}
                {hubspotCheckResult.screenshotBase64 && (
                  <button
                    onClick={() => setShowHubspotScreenshot(v => !v)}
                    className="w-full block text-left focus:outline-none group"
                    title={showHubspotScreenshot ? 'Click to collapse screenshot' : 'Click to expand screenshot'}
                  >
                    {showHubspotScreenshot ? (
                      <div className="relative">
                        <img
                          src={`data:image/jpeg;base64,${hubspotCheckResult.screenshotBase64}`}
                          alt="HubSpot deal page screenshot"
                          className="w-full block"
                        />
                        <div className="absolute bottom-0 inset-x-0 py-1.5 bg-black/40 text-center">
                          <span className="text-[10px] text-white">▲ collapse</span>
                        </div>
                      </div>
                    ) : (
                      <div className="relative overflow-hidden h-24">
                        <img
                          src={`data:image/jpeg;base64,${hubspotCheckResult.screenshotBase64}`}
                          alt="HubSpot deal page screenshot"
                          className="w-full block"
                        />
                        <div className="absolute inset-0 bg-gradient-to-b from-transparent to-white/90 flex items-end justify-center pb-1.5">
                          <span className="text-[10px] text-gray-500 group-hover:text-blue-600">▼ expand screenshot</span>
                        </div>
                      </div>
                    )}
                  </button>
                )}
              </div>
            )}
            {driveLoading && (
              <div className="mb-4 space-y-1">
                <div className="h-3 w-3/4 bg-gray-100 rounded animate-pulse" />
                <div className="h-8 bg-gray-100 rounded animate-pulse" />
                <div className="h-8 bg-gray-100 rounded animate-pulse" />
              </div>
            )}
            {!driveLoading && driveError && (
              <p className="text-xs text-red-500 mb-4">{driveError}</p>
            )}
            {!driveLoading && !driveResult && !driveError && (
              <p className="text-xs text-gray-400 mb-4">Google Drive not configured</p>
            )}
            {!driveLoading && driveResult && (
              <div className="mb-4">
                {/* Folder path breadcrumb */}
                {driveResult.folderPath && (
                  <div className="flex items-start gap-1.5 mb-2">
                    <div className="flex-1 min-w-0">
                      {driveResult.folderLink ? (
                        <a
                          href={driveResult.folderLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[11px] text-blue-600 hover:underline leading-tight block"
                          title={driveResult.folderPath}
                        >
                          {driveResult.folderPath} ↗
                        </a>
                      ) : (
                        <span className="text-[11px] text-gray-500 leading-tight block" title={driveResult.folderPath}>
                          {driveResult.folderPath}
                        </span>
                      )}
                    </div>
                    {driveResult.matchMethod === 'fuzzy_folder' && (
                      <span className="shrink-0 text-[10px] px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded-full">fuzzy match</span>
                    )}
                    {driveResult.stale && (
                      <span className="shrink-0 text-[10px] px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded-full" title={driveResult.warning ?? ''}>stale</span>
                    )}
                  </div>
                )}

                {/* Fallback / stale warning */}
                {driveResult.warning && !driveResult.stale && (
                  <div className="mb-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded text-xs text-amber-800">
                    ⚠ {driveResult.warning}
                  </div>
                )}

                {/* Link folder — shown only when Drive fell back to fulltext search */}
                {driveResult.matchMethod === 'fulltext_fallback' && (() => {
                  function extractFolderId(input: string): string | null {
                    const m = input.trim().match(/\/folders\/([a-zA-Z0-9_-]+)/)
                    if (m) return m[1]
                    if (/^[a-zA-Z0-9_-]{20,}$/.test(input.trim())) return input.trim()
                    return null
                  }

                  async function lookupFolder() {
                    const folderId = extractFolderId(linkFolderUrl)
                    if (!folderId) {
                      setLinkFolderError('Paste a Google Drive folder URL or folder ID')
                      return
                    }
                    setLinkFolderStep('preview')
                    setLinkFolderError(null)
                    try {
                      const res = await fetch(`/api/deals/${hubspotId}/drive/link-folder`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ folderId, preview: true }),
                      })
                      const json = await res.json()
                      if (!res.ok) { setLinkFolderError(json.error ?? 'Lookup failed'); setLinkFolderStep('input'); return }
                      setLinkFolderPreview({ id: folderId, name: json.name, fileCount: json.fileCount, webViewLink: json.webViewLink })
                    } catch {
                      setLinkFolderError('Network error — try again')
                      setLinkFolderStep('input')
                    }
                  }

                  async function commitLink() {
                    if (!linkFolderPreview) return
                    setLinkFolderStep('linking')
                    try {
                      const res = await fetch(`/api/deals/${hubspotId}/drive/link-folder`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ folderId: linkFolderPreview.id, preview: false }),
                      })
                      const json = await res.json()
                      if (!res.ok) { setLinkFolderError(json.error ?? 'Link failed'); setLinkFolderStep('preview'); return }
                      // Reset state and refresh drive
                      setLinkFolderStep('idle')
                      setLinkFolderUrl('')
                      setLinkFolderPreview(null)
                      fetchDrive()
                    } catch {
                      setLinkFolderError('Network error — try again')
                      setLinkFolderStep('preview')
                    }
                  }

                  if (linkFolderStep === 'idle') {
                    return (
                      <div className="mb-2">
                        <button
                          onClick={() => setLinkFolderStep('input')}
                          className="text-[11px] px-2.5 py-1 rounded border border-blue-300 text-blue-600 bg-blue-50 hover:bg-blue-100"
                        >
                          📁 Link Drive folder manually
                        </button>
                      </div>
                    )
                  }

                  if (linkFolderStep === 'input' || linkFolderStep === 'preview') {
                    const isLoading = linkFolderStep === 'preview' && !linkFolderPreview
                    return (
                      <div className="mb-2 p-3 bg-blue-50 border border-blue-200 rounded text-xs">
                        {linkFolderPreview ? (
                          <div>
                            <p className="text-gray-700 mb-1">
                              Found: <span className="font-medium">{linkFolderPreview.name}</span>
                              <span className="text-gray-500 ml-1">({linkFolderPreview.fileCount} files)</span>
                            </p>
                            <p className="text-amber-700 mb-2">Link this folder to <span className="font-medium">{deal.name ?? 'this deal'}</span>?</p>
                            <div className="flex gap-2">
                              <button
                                onClick={commitLink}
                                className="px-2.5 py-1 rounded bg-blue-600 text-white hover:bg-blue-700 font-medium"
                              >
                                Yes, link it
                              </button>
                              <button
                                onClick={() => { setLinkFolderStep('input'); setLinkFolderPreview(null) }}
                                className="px-2.5 py-1 rounded border border-gray-300 text-gray-600 hover:bg-gray-100"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div>
                            <p className="text-gray-600 mb-1.5">Paste a Google Drive folder URL or folder ID:</p>
                            <div className="flex gap-1.5 items-center">
                              <input
                                type="text"
                                value={linkFolderUrl}
                                onChange={e => { setLinkFolderUrl(e.target.value); setLinkFolderError(null) }}
                                onKeyDown={e => { if (e.key === 'Enter') lookupFolder() }}
                                placeholder="https://drive.google.com/drive/folders/..."
                                className="flex-1 px-2 py-1 border border-gray-300 rounded text-xs focus:outline-none focus:border-blue-400 bg-white"
                                autoFocus
                              />
                              <button
                                onClick={lookupFolder}
                                disabled={isLoading || !linkFolderUrl.trim()}
                                className="px-2.5 py-1 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                {isLoading ? '…' : 'Look up'}
                              </button>
                              <button
                                onClick={() => { setLinkFolderStep('idle'); setLinkFolderUrl(''); setLinkFolderError(null) }}
                                className="text-gray-400 hover:text-gray-600"
                              >
                                ✕
                              </button>
                            </div>
                            {linkFolderError && <p className="mt-1.5 text-red-600">{linkFolderError}</p>}
                          </div>
                        )}
                      </div>
                    )
                  }

                  if (linkFolderStep === 'linking') {
                    return (
                      <div className="mb-2 p-3 bg-blue-50 border border-blue-200 rounded text-xs text-blue-700">
                        Linking folder…
                      </div>
                    )
                  }

                  return null
                })()}

                {/* Document verification panel */}
                <div className="mb-3 border border-gray-100 rounded-lg overflow-hidden">

                  {/* Header */}
                  <div className="flex items-center justify-between px-3 py-1.5 bg-gray-50 border-b border-gray-100">
                    <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
                      <span className="text-[11px] font-medium text-gray-600 shrink-0">Required Documents</span>
                      {driveResult.docVerificationAt && (
                        <span className="text-[10px] text-gray-400 shrink-0" title={new Date(driveResult.docVerificationAt).toLocaleString()}>
                          verified {relativeDate(driveResult.docVerificationAt)}
                        </span>
                      )}
                      {verifyReport && (
                        <span className={`shrink-0 text-[9px] px-1.5 py-0.5 rounded-full font-medium ${
                          verifyReport.confidence === 'high' ? 'bg-green-100 text-green-700' :
                          verifyReport.confidence === 'medium' ? 'bg-amber-100 text-amber-700' :
                          'bg-red-100 text-red-600'
                        }`} title={verifyReport.confidenceReason}>
                          {verifyReport.confidence} confidence
                        </span>
                      )}
                      {driveResult.docVerificationAt && driveResult.cachedAt &&
                       new Date(driveResult.cachedAt) > new Date(driveResult.docVerificationAt) && (
                        <span className="text-[10px] text-amber-600 shrink-0" title="Drive files were refreshed after last verification">⚠ files updated</span>
                      )}
                      {/* HubSpot check timestamp — inline with doc status */}
                      {hubspotCheckResult && hubspotCheckResult.checkedAt && !hubspotCheckResult.sessionExpired && (
                        <span
                          className="shrink-0 text-[9px] px-1.5 py-0.5 rounded-full font-medium bg-orange-50 text-orange-600 border border-orange-200"
                          title={`HubSpot check: ${new Date(hubspotCheckResult.checkedAt).toLocaleString()}`}
                        >
                          HS {hubspotCheckResult.filesLinked ? '✓' : '!'}
                        </span>
                      )}
                      {hubspotCheckResult?.sessionExpired && (
                        <span className="shrink-0 text-[9px] px-1.5 py-0.5 rounded-full font-medium bg-gray-100 text-gray-500 border border-gray-200">
                          HS session expired
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => runVerify()}
                        disabled={verifyState === 'loading' || driveResult.matchMethod === 'fulltext_fallback'}
                        title={driveResult.matchMethod === 'fulltext_fallback' ? 'No Drive folder linked — index this deal\'s folder first before verifying' : undefined}
                        className="text-[10px] px-2 py-0.5 rounded bg-white border border-gray-200 text-gray-500 hover:text-gray-700 hover:border-gray-300 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {verifyState === 'loading' ? '…' : verifyReport ? '↻ Re-verify' : '✓ Verify match'}
                      </button>
                    </div>
                  </div>

                  {/* Document rows — detailed when verified, name-based preview otherwise */}
                  {(() => {
                    const fileById = new Map(driveResult.files.map(f => [f.id, f]))

                    // Type → linked status map. Built from hubspotDocStatus (pre-computed at
                    // check time with full context). No string matching here — just a key lookup.
                    const hsStatusByType = new Map<string, boolean>(
                      (hubspotCheckResult?.docStatuses ?? [])
                        .map(d => [d.type, d.linked])
                    )
                    const hsCheckDone = !!(hubspotCheckResult && !hubspotCheckResult.sessionExpired && hubspotCheckResult.docStatuses)

                    const HsBadge = ({ type }: { type: string }) => {
                      if (!hsCheckDone) return null
                      const linked = hsStatusByType.get(type)
                      if (linked === undefined) return null  // this doc type wasn't part of the check
                      return (
                        <span className={`shrink-0 text-[9px] px-1.5 py-0.5 rounded-full font-medium border ${
                          linked
                            ? 'bg-orange-50 text-orange-600 border-orange-200'
                            : 'bg-red-50 text-red-400 border-red-200'
                        }`}>
                          {linked ? 'HS ✓' : 'HS ✗'}
                        </span>
                      )
                    }

                    if (verifyReport) {
                      return (
                        <div className="divide-y divide-gray-50">
                          {verifyReport.requiredDocuments.map(r => {
                            const file = r.fileId ? fileById.get(r.fileId) : null
                            const statusColor = r.status === 'present_verified' ? 'text-green-500'
                              : r.status === 'missing' ? 'text-red-400' : 'text-amber-400'
                            const statusIcon = r.status === 'present_verified' ? '✓'
                              : r.status === 'missing' ? '✗' : '~'
                            return (
                              <div key={r.type} className="px-3 py-2">
                                <div className="flex items-center gap-2">
                                  <span className={`text-sm shrink-0 ${statusColor}`}>{statusIcon}</span>
                                  <HsBadge type={r.type} />
                                  <span className="text-[11px] font-medium text-gray-700 w-32 shrink-0">{r.label}</span>
                                  {file?.webViewLink ? (
                                    <a href={file.webViewLink} target="_blank" rel="noopener noreferrer"
                                       className="text-[11px] text-blue-600 hover:underline truncate flex-1">
                                      {r.fileName} ↗
                                    </a>
                                  ) : r.fileName ? (
                                    <span className="text-[11px] text-gray-500 truncate flex-1">{r.fileName}</span>
                                  ) : (
                                    <span className="text-[11px] text-gray-400 italic flex-1">not found in this folder</span>
                                  )}
                                </div>
                                <p className={`text-[10px] ml-6 mt-0.5 leading-snug ${r.status === 'present_unverified' ? 'text-amber-600' : 'text-gray-500'}`}>
                                  {r.details}
                                </p>
                                {r.mismatches.map((m, i) => (
                                  <p key={i} className="text-[10px] text-red-600 ml-6">✗ {m}</p>
                                ))}
                              </div>
                            )
                          })}
                        </div>
                      )
                    }

                    // No verification yet — name-based preview with possible-match buttons
                    return (
                      <div className="divide-y divide-gray-50">
                        {driveResult.docChecklist.required.map(doc => (
                          <div key={doc.type} className="px-3 py-1.5">
                            <div className="flex items-center gap-2">
                              <span className={`text-sm shrink-0 ${doc.found ? 'text-green-500' : doc.possibleMatch ? 'text-amber-400' : 'text-red-400'}`}>
                                {doc.found ? '✓' : doc.possibleMatch ? '?' : '✗'}
                              </span>
                              <HsBadge type={doc.type} />
                              <span className="text-[11px] text-gray-600 w-32 shrink-0">{doc.label}</span>
                              {doc.file ? (
                                <a href={doc.file.webViewLink ?? '#'} target="_blank" rel="noopener noreferrer"
                                   className="text-[11px] text-blue-600 hover:underline truncate flex-1">
                                  {doc.file.name} ↗
                                </a>
                              ) : doc.possibleMatch ? (
                                <a href={doc.possibleMatch.webViewLink ?? '#'} target="_blank" rel="noopener noreferrer"
                                   className="text-[11px] text-amber-700 hover:underline truncate flex-1">
                                  {doc.possibleMatch.name} ↗
                                </a>
                              ) : (
                                <span className="text-[11px] text-gray-400 italic flex-1">not found in this folder</span>
                              )}
                            </div>
                            {!doc.found && doc.possibleMatch && (
                              <div className="flex items-center gap-2 mt-0.5 ml-6">
                                <span className="text-[10px] text-amber-600">{doc.possibleMatchReason}</span>
                                <button onClick={() => assignDoc(doc.type, doc.possibleMatch!)} disabled={verifyState === 'loading'}
                                   className="shrink-0 text-[10px] px-2 py-0.5 rounded bg-amber-50 border border-amber-300 text-amber-700 hover:bg-amber-100 disabled:opacity-50">
                                  Use this file & verify
                                </button>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )
                  })()}

                  {/* Summary + KV data (only when verified) */}
                  {verifyState === 'done' && verifyReport && (
                    <div className={`border-t ${verifyReport.overallMatch ? 'border-green-100' : 'border-amber-100'}`}>
                      <div className={`px-3 py-2 ${verifyReport.overallMatch ? 'bg-green-50' : 'bg-amber-50'}`}>
                        <p className={`text-[11px] font-medium ${verifyReport.overallMatch ? 'text-green-700' : 'text-amber-700'}`}>
                          {verifyReport.overallMatch ? '✓ Documents match the property' : '⚠ Verification issues found'}
                        </p>
                        {verifyReport.summary && (
                          <div className="mt-1 space-y-0.5">
                            {verifyReport.summary.split('\n').map((line, i) => {
                              const subBullet = /^\s{2,}[-*]/.test(line)
                              const topBullet = !subBullet && /^[-*]/.test(line.trim())
                              const text = line.replace(/^[\s\-*]+/, '').trim()
                              if (!text) return null
                              const rendered = text.split(/\*\*(.+?)\*\*/g).map((chunk, j) =>
                                j % 2 === 1 ? <strong key={j}>{chunk}</strong> : chunk
                              )
                              if (subBullet) return (
                                <p key={i} className="text-[10px] text-gray-500 pl-4 leading-snug">
                                  · {rendered}
                                </p>
                              )
                              if (topBullet) return (
                                <p key={i} className="text-[10px] text-gray-700 leading-snug">{rendered}</p>
                              )
                              return (
                                <p key={i} className="text-[10px] text-gray-600 leading-snug">{rendered}</p>
                              )
                            })}
                          </div>
                        )}
                      </div>

                      {verifyReport.consolidatedData && (() => {
                        const d = verifyReport.consolidatedData
                        const topPairs = [
                          ['Address', d.propertyAddress],
                          ['County', d.county],
                        ].filter(([, v]) => v) as [string, string][]

                        const restPairs = [
                          ['State', d.state], ['ZIP', d.zipCode],
                          ['Parcel', d.parcelId],
                          ['Sale Date', d.taxSaleDate], ['Sale Amount', d.saleAmount],
                          ['Deed Recorded', d.deedRecordedDate], ['Book / Page', d.bookPage],
                          ['Grantor', d.grantor], ['Grantee', d.grantee],
                          ['Current Owner', d.currentOwner], ['Assessed Value', d.assessedValue],
                        ].filter(([, v]) => v) as [string, string][]

                        const tracking = verifyReport.ownerTrackingCheck
                        const hasTaxLien = d.taxLienAgainst || (tracking && tracking.length > 0)

                        return (
                          <div className="px-3 py-2 bg-white border-t border-gray-100">
                            <p className="text-[10px] font-medium text-gray-500 mb-1.5">Extracted Data</p>

                            {/* Tax Lien Against — first */}
                            {hasTaxLien && (
                              <div className="mb-2 pb-2 border-b border-gray-100">
                                <span className="text-[9px] text-gray-400 uppercase tracking-wide">Tax Lien Against</span>
                                {d.taxLienAgainst ? (
                                  <p className="text-[11px] text-gray-800 leading-tight mt-0.5 italic">&ldquo;{d.taxLienAgainst}&rdquo;</p>
                                ) : (
                                  <p className="text-[11px] text-gray-400 italic mt-0.5">Not mentioned in document</p>
                                )}
                                {tracking && tracking.length > 0 && (
                                  <div className="mt-1 space-y-0.5">
                                    {tracking.map((entry, i) => (
                                      <div key={i} className="flex items-center gap-1.5">
                                        <span className={`text-[10px] shrink-0 ${entry.tracked ? 'text-green-500' : 'text-red-400'}`}>
                                          {entry.tracked ? '✓' : '✗'}
                                        </span>
                                        <span className="text-[11px] text-gray-700">{entry.name}</span>
                                        {!entry.tracked && (
                                          <span className="text-[10px] text-red-500">— not tracked, consider reaching out</span>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            )}

                            {/* Address + County */}
                            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 mb-2">
                              {topPairs.map(([k, v]) => (
                                <div key={k}>
                                  <span className="text-[9px] text-gray-400 uppercase tracking-wide">{k}</span>
                                  <p className="text-[11px] text-gray-800 leading-tight">{v}</p>
                                </div>
                              ))}
                            </div>

                            {/* Remaining fields */}
                            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                              {restPairs.map(([k, v]) => (
                                <div key={k}>
                                  <span className="text-[9px] text-gray-400 uppercase tracking-wide">{k}</span>
                                  <p className="text-[11px] text-gray-800 leading-tight">{v}</p>
                                </div>
                              ))}
                            </div>
                          </div>
                        )
                      })()}
                    </div>
                  )}

                  {verifyState === 'error' && (
                    <div className="px-3 py-2 border-t border-red-100 bg-red-50">
                      <p className="text-[11px] text-red-600">Verification failed: {verifyError}</p>
                    </div>
                  )}
                </div>

                {/* File list */}
                {driveResult.files.length === 0 ? (
                  <p className="text-xs text-gray-400">No files in this folder</p>
                ) : (
                  <div className="space-y-1">
                    {driveResult.files.map(f => (
                      <a
                        key={f.id}
                        href={f.webViewLink ?? '#'}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 px-3 py-2 bg-gray-50 rounded-lg hover:bg-gray-100 text-xs text-gray-800"
                      >
                        {f.iconLink && <img src={f.iconLink} alt="" className="w-4 h-4 shrink-0" />}
                        <span className="truncate flex-1">{f.name}</span>
                        {f.modifiedAt && (
                          <span className="text-gray-400 shrink-0">{relativeDate(f.modifiedAt)}</span>
                        )}
                      </a>
                    ))}
                  </div>
                )}

                <button onClick={fetchDrive} className="mt-2 text-xs text-gray-400 hover:text-gray-600">
                  ↻ Refresh
                </button>
              </div>
            )}

            {/* Snooze history */}
            {snoozeHistory && snoozeHistory.length > 0 && (
              <>
                <button
                  onClick={() => setShowSnoozeHistory(v => !v)}
                  className="mt-6 text-xs text-gray-400 hover:text-gray-600"
                >
                  {showSnoozeHistory ? '▾' : '▸'} Snooze history ({snoozeHistory.length})
                </button>
                {showSnoozeHistory && (
                  <div className="mt-2 space-y-1">
                    {snoozeHistory.map(s => (
                      <div key={s.id} className="text-xs text-gray-400 py-1">
                        {SNOOZE_CATEGORY_LABELS[s.category] ?? s.category} · until {formatDate(s.snoozeUntil)}
                        {s.wokeAt ? ` · removed ${relativeDate(s.wokeAt)}` : ' · active'}
                        {s.freeformNote ? ` — ${s.freeformNote}` : ''}
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  )

  if (inline) {
    return (
      <>
        {panelContent}
        {showSnooze && (
          <SnoozeModal
            hubspotId={hubspotId}
            onClose={() => setShowSnooze(false)}
            onSuccess={() => { setShowSnooze(false); fetchDeal(); onClose() }}
          />
        )}
      </>
    )
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/20" onClick={onClose} />
      {panelContent}
      {showSnooze && (
        <SnoozeModal
          hubspotId={hubspotId}
          onClose={() => setShowSnooze(false)}
          onSuccess={() => { setShowSnooze(false); fetchDeal(); onClose() }}
        />
      )}
      {selectedContactId !== null && (
        <ContactPanel
          dealHubspotId={hubspotId}
          contactId={selectedContactId}
          onClose={() => setSelectedContactId(null)}
        />
      )}
    </>
  )
}
