'use client'

import { useEffect, useState, useCallback } from 'react'
import { formatAmount, relativeDate, formatDate } from '@/lib/utils/format'
import { refreshHighlight } from '@/lib/utils/search-highlight'
import { DealBadges } from '@/components/analytics/DealBadges'
import { SectionHeader } from './deal-panel/shared'
import { AiSummaryBlock } from './deal-panel/AiSummaryBlock'
import { SnoozeModal } from './deal-panel/SnoozeModal'
import { StoryTab } from './deal-panel/StoryTab'
import { ContactsTab } from './deal-panel/ContactsTab'
import { CallsTab } from './deal-panel/CallsTab'
import { NotesTab } from './deal-panel/NotesTab'
import { EmailsTab } from './deal-panel/EmailsTab'
import { DocumentsTab } from './deal-panel/DocumentsTab'
import { TaskPromptInline } from './deal-panel/TaskPromptInline'
import { getPipelineGroup, defaultTabForPipelineGroup } from '@/lib/utils/pipeline-group'
import type { PanelData, OutreachMatrix } from './deal-panel/types'
import { SNOOZE_CATEGORY_LABELS } from './deal-panel/types'

type TabId = 'story' | 'tasks' | 'contacts' | 'calls' | 'emails' | 'documents' | 'notes'
const TAB_IDS: TabId[] = ['story', 'tasks', 'contacts', 'calls', 'emails', 'documents', 'notes']

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
  const [snoozeRemoving, setSnoozeRemoving] = useState(false)
  const [showSnoozeHistory, setShowSnoozeHistory] = useState(false)

  const [activeTab, setActiveTab] = useState<TabId>('story')
  const [tabSetByUser, setTabSetByUser] = useState(false)
  const [summaryState, setSummaryState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [summaryError, setSummaryError] = useState<string | null>(null)
  const [taskPromptState, setTaskPromptState] = useState<'idle' | 'open' | 'done' | 'dismissed'>('idle')

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
  useEffect(() => { if (!loading && data) refreshHighlight() }, [loading, data])

  useEffect(() => {
    if (!data?.deal?.stage || tabSetByUser) return
    setActiveTab(defaultTabForPipelineGroup(getPipelineGroup(data.deal.stage)))
  }, [data?.deal?.stage, tabSetByUser])

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

  const { deal, activities, contacts, snooze, snoozeHistory, summaryData, layer2SyncedAt } = data ?? {}

  function tabLabel(tab: TabId): string {
    if (tab === 'contacts') {
      const n = contacts?.length ?? (deal?.contactCount ?? 0)
      return n > 0 ? `Contacts (${n})` : 'Contacts'
    }
    if (tab === 'calls') {
      const n = outreachData?.totalOutboundCalls ?? 0
      return n > 0 ? `Calls (${n})` : 'Calls'
    }
    if (tab === 'notes') {
      const n = activities?.filter(a => a.type === 'note').length ?? 0
      return n > 0 ? `Notes (${n})` : 'Notes'
    }
    const LABELS: Record<TabId, string> = {
      story: 'Story', tasks: 'Tasks', contacts: 'Contacts',
      calls: 'Calls', emails: 'Emails', documents: 'Documents', notes: 'Notes',
    }
    return LABELS[tab]
  }

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

      {/* Panel controls */}
      <div className="px-6 py-3 border-b border-gray-100 shrink-0">
        {error && (
          <div className="mb-2 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            {error}
          </div>
        )}
        {!loading && deal && (
          <>
            {/* Snooze status + actions */}
            <div className="flex items-center gap-2 mb-2">
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
                className="w-full py-2 text-sm text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 mb-2"
              >
                Load Full Detail
              </button>
            )}
            {layer2State === 'confirming' && (
              <div className="mb-2 px-4 py-3 bg-yellow-50 border border-yellow-200 rounded-lg">
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
              <div className="mb-2 px-4 py-3 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-500 animate-pulse">
                Loading full detail from HubSpot…
              </div>
            )}
            {layer2Error && (
              <div className="mb-2 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                {layer2Error}
              </div>
            )}
            {layer2State === 'done' && (
              <button
                onClick={startLayer2}
                className="text-xs text-gray-400 hover:text-gray-600 mb-2"
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
                    className="w-full py-2 text-sm text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 mb-2"
                  >
                    Generate AI Summary
                  </button>
                )}
                {summaryState === 'loading' && (
                  <div className="mb-2 px-4 py-3 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-500 animate-pulse">
                    Generating summary — this may take up to 20 seconds…
                  </div>
                )}
                {summaryState === 'error' && (
                  <div className="mb-2 px-4 py-3 bg-red-50 border border-red-200 rounded-lg">
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
                  <div className="mb-2 px-3 py-2 bg-green-50 border border-green-200 rounded text-xs text-green-700">
                    Task created and added to your task list.
                  </div>
                )}
              </>
            )}

            {/* Snooze history */}
            {snoozeHistory && snoozeHistory.length > 0 && (
              <>
                <button
                  onClick={() => setShowSnoozeHistory(v => !v)}
                  className="mt-2 text-xs text-gray-400 hover:text-gray-600"
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

      {/* Tab strip */}
      {!loading && deal && (
        <div className="shrink-0 border-b border-gray-200 flex overflow-x-auto">
          {TAB_IDS.map(tab => (
            <button
              key={tab}
              onClick={() => { setActiveTab(tab); setTabSetByUser(true) }}
              className={`px-4 py-2.5 text-xs font-medium whitespace-nowrap border-b-2 -mb-px transition-colors ${
                activeTab === tab
                  ? 'border-gray-900 text-gray-900'
                  : 'border-transparent text-gray-400 hover:text-gray-600'
              }`}
            >
              {tabLabel(tab)}
            </button>
          ))}
        </div>
      )}

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto">
        {!loading && deal && (
          <>
            {activeTab === 'story' && (
              <StoryTab dealHubspotId={hubspotId} layer2SyncedAt={layer2SyncedAt ?? null} />
            )}

            {activeTab === 'tasks' && (
              <div className="px-6 py-6 text-center text-sm text-gray-400">
                Tasks — coming soon
              </div>
            )}

            {activeTab === 'contacts' && (
              <ContactsTab
                hubspotId={hubspotId}
                contacts={contacts}
                layer2SyncedAt={layer2SyncedAt ?? null}
                contactCount={deal.contactCount}
              />
            )}

            {activeTab === 'calls' && (
              <CallsTab
                outreachData={outreachData}
                outreachError={outreachError}
                contacts={contacts}
                layer2SyncedAt={layer2SyncedAt ?? null}
              />
            )}

            {activeTab === 'emails' && (
              <EmailsTab hubspotId={hubspotId} />
            )}

            {activeTab === 'documents' && (
              <DocumentsTab hubspotId={hubspotId} dealName={deal.name} />
            )}

            {activeTab === 'notes' && (
              <NotesTab activities={activities} layer2SyncedAt={layer2SyncedAt ?? null} />
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
    </>
  )
}
