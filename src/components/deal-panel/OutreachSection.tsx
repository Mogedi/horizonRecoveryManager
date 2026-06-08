'use client'

import { useState } from 'react'
import { relativeDate } from '@/lib/utils/format'
import { SectionHeader } from './shared'
import type { Contact, OutreachMatrix, OutreachPhone, SessionCall, DetailedOutcome } from './types'

// ─── Phone analytics helpers ──────────────────────────────────────────────────

type PhoneStats = {
  total: number
  convCount: number
  vmCount: number
  noAnsCount: number
  deadCount: number
  pendingCount: number
}

function phoneStats(phone: OutreachPhone): PhoneStats {
  let convCount = 0, vmCount = 0, noAnsCount = 0, deadCount = 0, pendingCount = 0
  for (const a of phone.attempts) {
    const d = a.detailedOutcome
    if (d === 'conversation') convCount++
    else if (d === 'voicemail_msg_left' || d === 'voicemail_full' || d === 'voicemail_no_msg') vmCount++
    else if (d === 'no_answer' || d === 'busy') noAnsCount++
    else if (d === 'dead_line') deadCount++
    else pendingCount++
  }
  return { total: phone.attempts.length, convCount, vmCount, noAnsCount, deadCount, pendingCount }
}

function phoneInference(s: PhoneStats): string | null {
  if (s.total === 0) return null
  const known = s.convCount + s.vmCount + s.noAnsCount + s.deadCount
  if (s.convCount > 0) return `Reached — spoken ${s.convCount} time${s.convCount !== 1 ? 's' : ''}`
  if (s.deadCount > 0 && s.deadCount >= s.total / 2) return 'Possibly disconnected — dead line detected'
  if (s.vmCount > 0 && s.noAnsCount === 0 && known > 0) return 'Reliably reaches voicemail — active number'
  if (s.vmCount > 0 && s.vmCount >= known / 2 && known > 0) return 'Often reaches voicemail'
  if (s.noAnsCount > 0 && s.noAnsCount === known && s.total >= 3) return 'Never answered — possible wrong number or call-screening'
  if (s.noAnsCount > 0 && s.noAnsCount > known / 2 && known > 0) return 'Mostly no answer'
  if (s.pendingCount === s.total) return null
  return null
}

function formatPhone(e164: string): string {
  const m = e164.match(/^\+1(\d{3})(\d{3})(\d{4})$/)
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : e164
}

function formatDuration(secs: number | null): string {
  if (!secs || secs <= 0) return '0s'
  if (secs < 60) return `${secs}s`
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

function transcriptStatusMessage(call: SessionCall): string | null {
  if (call.transcriptStatus === 'available') return null
  if (call.transcriptStatus === 'too_short') {
    return `Call too short to transcribe (${formatDuration(call.durationSecs)})`
  }
  if (call.transcriptStatus === 'no_recording') return 'No recording available'
  if (call.transcriptStatus === 'not_started') return 'Transcript pending'
  return null
}

// ─── Outcome display ──────────────────────────────────────────────────────────

type OutcomeConfig = { label: string; tooltip: string; dotClass: string; textClass: string }

// Traffic light: green = real conversation, amber = voicemail/brief contact, red = no contact, gray = unknown
const OUTCOME_META: Record<DetailedOutcome, OutcomeConfig> = {
  conversation:          { label: 'Conversation',   tooltip: 'Back-and-forth dialogue — someone actually spoke with the contact.',                              dotClass: 'text-green-500',  textClass: 'text-green-700 font-medium' },
  voicemail_msg_left:    { label: 'Voicemail left', tooltip: 'Reached voicemail and left a callback message.',                                                 dotClass: 'text-amber-400',  textClass: 'text-amber-600' },
  voicemail_full:        { label: 'Mailbox full',   tooltip: 'Reached voicemail — mailbox was full, no message could be left.',                                dotClass: 'text-amber-400',  textClass: 'text-amber-600' },
  voicemail_no_msg:      { label: 'VM — no msg',    tooltip: 'Reached voicemail but no message was left. Unusual — Kathleen should always leave one.',         dotClass: 'text-amber-500',  textClass: 'text-amber-700 font-semibold' },
  dead_line:             { label: 'Dead line',       tooltip: 'Carrier confirmed: this number is disconnected or no longer in service.',                        dotClass: 'text-red-400',    textClass: 'text-red-600' },
  no_answer:             { label: 'No answer',       tooltip: 'Phone rang out — nobody picked up.',                                                             dotClass: 'text-red-300',    textClass: 'text-red-500' },
  busy:                  { label: 'Busy',            tooltip: 'Got a busy signal.',                                                                             dotClass: 'text-red-300',    textClass: 'text-red-500' },
  brief_answered:        { label: 'Brief call',      tooltip: 'Too short to confirm a real conversation — may be a misclassified VM greeting or instant hang-up.', dotClass: 'text-amber-300',  textClass: 'text-amber-500' },
  pending_transcript:    { label: 'Transcribing…',  tooltip: 'Recording captured — transcript not yet processed.',                                             dotClass: 'text-gray-300',   textClass: 'text-gray-400' },
  recording_unavailable: { label: 'No recording',   tooltip: 'Call was answered but JustCall didn\'t capture audio.',                                          dotClass: 'text-gray-300',   textClass: 'text-gray-400' },
}

function OutcomeChip({ detailedOutcome }: { detailedOutcome: DetailedOutcome }) {
  const meta = OUTCOME_META[detailedOutcome]
  return (
    <span className={`shrink-0 ${meta.textClass}`} title={meta.tooltip}>
      <span className={`mr-1 ${meta.dotClass}`}>●</span>
      {meta.label}
    </span>
  )
}

// ─── OutreachSection ──────────────────────────────────────────────────────────
// Primary contact view when outreach data is available.
// The separate HubSpot Contacts section is hidden when this section renders.

export function OutreachSection({
  matrix,
  panelContacts,
}: {
  matrix: OutreachMatrix
  panelContacts: Contact[]
}) {
  const [expandedDays, setExpandedDays] = useState<Set<string>>(() => new Set())
  const [expandedTranscripts, setExpandedTranscripts] = useState<Set<number>>(() => new Set())

  function toggleDay(date: string) {
    setExpandedDays(prev => {
      const next = new Set(prev)
      if (next.has(date)) next.delete(date)
      else next.add(date)
      return next
    })
  }

  function toggleTranscript(id: number) {
    setExpandedTranscripts(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const contactMeta = new Map(panelContacts.map(c => [c.contactHubspotId, c]))

  if (matrix.totalOutboundCalls === 0) {
    return (
      <>
        <SectionHeader title="Call Outreach" />
        <p className="text-sm text-gray-400 mb-4">No JustCall activity recorded for this deal.</p>
      </>
    )
  }

  const lastDate = matrix.lastCalledAt
    ? new Date(matrix.lastCalledAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : null

  const spokenWithIds = new Set(
    matrix.days.flatMap(d =>
      d.calls.filter(c => c.detailedOutcome === 'conversation' && c.contactHubspotId).map(c => c.contactHubspotId!)
    )
  )
  const spokenWithCount = spokenWithIds.size

  return (
    <>
      <SectionHeader title="Call Outreach" />

      <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs">
        <span>
          <span className="font-semibold text-gray-800">{matrix.outreachDays}</span>
          <span className="text-gray-400 ml-1">day{matrix.outreachDays !== 1 ? 's' : ''}</span>
        </span>
        <span>
          <span className="font-semibold text-gray-800">{matrix.totalOutboundCalls}</span>
          <span className="text-gray-400 ml-1">calls</span>
        </span>
        <span className={spokenWithCount === matrix.contactsTotal ? 'text-green-600 font-semibold' : spokenWithCount > 0 ? 'text-amber-600 font-semibold' : 'text-gray-400'}>
          {spokenWithCount}/{matrix.contactsTotal} spoken with
        </span>
        {lastDate && <span className="text-gray-400">Last {lastDate}</span>}
      </div>

      {matrix.days.length > 0 && (
        <div className="mb-4 rounded-lg border border-gray-100 overflow-hidden text-xs">
          {matrix.days.map(day => {
            const isOpen = expandedDays.has(day.date)
            const label = new Date(day.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
            const noContactCount = day.callCount - day.conversationCount - day.voicemailCount - day.deadLineCount
            const summaryParts = [
              day.conversationCount > 0 ? `${day.conversationCount} conversation${day.conversationCount !== 1 ? 's' : ''}` : null,
              day.voicemailCount > 0 ? `${day.voicemailCount} VM${day.voicemailCount !== 1 ? 's' : ''}` : null,
              noContactCount > 0 ? `${noContactCount} no answer` : null,
            ].filter(Boolean)
            const conversationContacts = [...new Set(
              day.calls.filter(c => c.detailedOutcome === 'conversation' && c.contactName).map(c => c.contactName!)
            )]

            return (
              <div key={day.date} className="border-b border-gray-100 last:border-0">
                <button
                  onClick={() => toggleDay(day.date)}
                  className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-gray-50 transition-colors"
                >
                  <span className="text-gray-400 w-14 shrink-0">{label}</span>
                  <span className="text-gray-500 shrink-0">{day.callCount} calls</span>
                  <span className={`shrink-0 ${day.conversationCount > 0 ? 'text-green-700 font-medium' : 'text-gray-400'}`}>
                    {summaryParts.length > 0 ? summaryParts.join(' · ') : 'No contact made'}
                  </span>
                  {conversationContacts.length > 0 && (
                    <span className="text-gray-400 flex-1 truncate">{conversationContacts.join(', ')}</span>
                  )}
                  <span className="text-gray-300 ml-auto shrink-0">{isOpen ? '▾' : '▸'}</span>
                </button>

                {isOpen && (
                  <div className="border-t border-gray-100 bg-gray-50/50 divide-y divide-gray-100">
                    {day.calls.map(call => {
                      const time = call.displayTime ?? '—'
                      const transcriptOpen = expandedTranscripts.has(call.activityEventId)
                      const statusMsg = transcriptStatusMessage(call)
                      return (
                        <div
                          key={call.activityEventId}
                          className={`px-3 py-2 ${call.detailedOutcome === 'conversation' ? 'border-l-2 border-green-400 pl-2.5' : ''}`}
                        >
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-gray-400 w-16 shrink-0">{time}</span>
                            <span className="text-gray-700 font-medium min-w-0 truncate">
                              {call.contactName ?? formatPhone(call.phoneNumber)}
                            </span>
                            {call.contactName && (
                              <span className="text-gray-400 font-mono shrink-0">{formatPhone(call.phoneNumber)}</span>
                            )}
                            <span className="text-gray-400 ml-auto shrink-0">{formatDuration(call.durationSecs)}</span>
                            <OutcomeChip detailedOutcome={call.detailedOutcome} />
                          </div>

                          {call.displaySummary && (
                            <p className="mt-1 text-gray-500 leading-snug pl-6">{call.displaySummary}</p>
                          )}
                          {!call.displaySummary && statusMsg && (
                            <p className="mt-1 text-gray-400 italic pl-6">{statusMsg}</p>
                          )}

                          {call.transcriptStatus === 'available' && call.transcript && (
                            <div className="pl-6 mt-1">
                              <button
                                onClick={() => toggleTranscript(call.activityEventId)}
                                className="text-gray-400 hover:text-gray-600 underline underline-offset-2"
                              >
                                {transcriptOpen ? '▾ Hide transcript' : '▸ Show transcript'}
                              </button>
                              {transcriptOpen && (
                                <div className="mt-2 p-2 bg-white border border-gray-200 rounded text-gray-600 whitespace-pre-wrap leading-relaxed max-h-48 overflow-y-auto">
                                  {call.transcript}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      <div className="space-y-3 mb-4">
        {matrix.contacts.map((contact, i) => {
          const meta = contactMeta.get(contact.contactHubspotId)
          return (
            <div key={contact.contactHubspotId ?? i} className="rounded-lg border border-gray-100 overflow-hidden">
              <div className="flex items-start justify-between px-3 py-2 bg-gray-50 border-b border-gray-100">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-sm font-medium text-gray-800">
                      {contact.name ?? 'Unknown contact'}
                    </span>
                    {meta?.isDeceased && (
                      <span className="text-xs text-gray-400">Deceased</span>
                    )}
                    {meta?.doNotContact && (
                      <span className="text-xs bg-red-50 text-red-600 px-1.5 py-0.5 rounded">DNC</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                    {contact.contactType && (
                      <span className="text-xs text-gray-400">{contact.contactType}</span>
                    )}
                    {meta?.ownershipStatus && (
                      <span className="text-xs text-gray-400">· {meta.ownershipStatus}</span>
                    )}
                    {meta?.emailList && meta.emailList.length > 0 && (
                      <span className="text-xs text-gray-400 truncate">· {meta.emailList[0]}</span>
                    )}
                  </div>
                </div>
                {(() => {
                  const hasConvo = spokenWithIds.has(contact.contactHubspotId ?? '')
                  return (
                    <span className={`text-xs px-1.5 py-0.5 rounded-full shrink-0 ml-2 ${hasConvo ? 'bg-green-100 text-green-700' : contact.totalAttempts > 0 ? 'bg-amber-50 text-amber-600' : 'bg-gray-50 text-gray-400'}`}>
                      {hasConvo ? 'Conversation' : contact.totalAttempts > 0 ? `${contact.totalAttempts} attempt${contact.totalAttempts !== 1 ? 's' : ''}` : 'not called'}
                    </span>
                  )
                })()}
              </div>
              {contact.phones.length === 0 ? (
                <div className="px-3 py-2 text-xs text-gray-400">No phone numbers</div>
              ) : (
                <div className="divide-y divide-gray-50">
                  {contact.phones.map(phone => {
                    const s = phoneStats(phone)
                    const inference = phoneInference(s)
                    return (
                      <div key={phone.numberE164} className="px-3 py-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          {phone.lastDetailedOutcome ? (
                            <span className={`text-xs shrink-0 ${OUTCOME_META[phone.lastDetailedOutcome].dotClass}`}>●</span>
                          ) : (
                            <span className="text-xs text-gray-200 shrink-0">○</span>
                          )}
                          <span className="text-xs text-gray-700 font-mono shrink-0">
                            {formatPhone(phone.numberE164)}
                          </span>
                          <span className="text-xs text-gray-400 shrink-0">
                            {s.total > 0 ? `${s.total} call${s.total !== 1 ? 's' : ''}` : 'not called'}
                          </span>
                          {s.convCount > 0 && (
                            <span className="text-xs text-green-600 shrink-0">Conv ×{s.convCount}</span>
                          )}
                          {s.vmCount > 0 && (
                            <span className="text-xs text-amber-500 shrink-0">VM ×{s.vmCount}</span>
                          )}
                          {s.noAnsCount > 0 && (
                            <span className="text-xs text-red-400 shrink-0">No ans ×{s.noAnsCount}</span>
                          )}
                          {s.deadCount > 0 && (
                            <span className="text-xs text-rose-500 shrink-0">Dead ×{s.deadCount}</span>
                          )}
                          {phone.lastCalledAt && (
                            <span className="text-xs text-gray-300 ml-auto shrink-0">
                              {relativeDate(phone.lastCalledAt)}
                            </span>
                          )}
                        </div>
                        {inference && (
                          <p className="text-xs text-gray-400 mt-0.5 pl-3.5 italic">{inference}</p>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </>
  )
}
