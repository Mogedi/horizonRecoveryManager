'use client'

import { useState } from 'react'
import useSWR from 'swr'
import type {
  Band, EvidenceItem, ScoredCandidate, Address, ActionableContact, FamilyMember, RankedContact,
  Conflict, Completeness, TimelineStep, SourceIntelEntry, RelationCategory, ContactRank, CandidatePerson,
  PropertyRecord, LinkageType, CoverageStatus,
} from '@/lib/research/types'
import { caseTypeWantsProperty, CASE_TYPES, CASE_TYPE_LABELS, type CaseType } from '@/lib/research/case-type'

const fetcher = (url: string) => fetch(url).then(r => (r.ok ? r.json() : Promise.reject(new Error(r.statusText))))

type DossierRow = { id: number; subject: { name: string; deceased: boolean | null; dateOfDeath?: string }; confidence: { band: Band; score: number }; reviewStatus: string; createdAt: string; usd: number | null }
type RequestRow = { id: number; query: { name?: string }; goal: string; status: string; createdAt: string }
type Progress = { step: string | null; message: string; createdAt: string }
type CostTrend = { runs: number; totalUsd: number; avgUsd: number; byDay: { day: string; runs: number; avgUsd: number }[] }
type ResearchData = { dossiers: DossierRow[]; requests: RequestRow[]; progress: Record<string, Progress[]>; costTrend: CostTrend }
type Selected = { type: 'dossier' | 'request'; id: number } | null

const BAND: Record<Band, string> = { high: 'bg-emerald-100 text-emerald-800', medium: 'bg-amber-100 text-amber-800', low: 'bg-gray-100 text-gray-600', conflicting: 'bg-red-100 text-red-800' }
const STATUS: Record<string, string> = { pending: 'text-gray-400', running: 'text-blue-600', done: 'text-emerald-600', failed: 'text-red-600' }
const input = 'px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500'

function elapsed(iso: string) {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000))
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`
}
const money = (u: number | null | undefined) => (u == null ? '—' : `$${u.toFixed(2)}`)

export default function ResearchPage() {
  const [form, setForm] = useState({ name: '', address: '', goal: 'find_heirs', caseType: 'unknown' })
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [sel, setSel] = useState<Selected>(null)
  const { data, mutate } = useSWR<ResearchData>('/api/research', fetcher, { refreshInterval: 5_000 })

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm(f => ({ ...f, [k]: e.target.value }))

  async function enqueue(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name.trim()) { setMsg('Name is required'); return }
    // Ask for an address only when the run actually needs one (a property search).
    if (form.goal === 'property_records' && !form.address.trim()) { setMsg('Add the full property address for a property search'); return }
    setBusy(true); setMsg(null)
    try {
      const res = await fetch('/api/research', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? `Error ${res.status}`)
      setMsg(`Queued request #${json.requestId}`); mutate()
    } catch (err) { setMsg(err instanceof Error ? err.message : 'Failed') } finally { setBusy(false) }
  }

  const active = (data?.requests ?? []).filter(r => r.status === 'pending' || r.status === 'running')

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Search form */}
      <form onSubmit={enqueue} className="shrink-0 px-6 pt-5 pb-4 border-b border-gray-200 bg-white">
        <div className="max-w-5xl flex flex-wrap items-end gap-3">
          <input className={`${input} w-44`} value={form.name} onChange={set('name')} placeholder="Name (Last, First) *" />
          <input className={`${input} w-80`} value={form.address} onChange={set('address')} placeholder="Full property address (e.g. 301 Lowell St, Atlanta, GA 30310)" />
          <select className={input} value={form.caseType} onChange={set('caseType')} title="Case type — drives whether property research runs">
            {CASE_TYPES.map(ct => <option key={ct} value={ct}>{CASE_TYPE_LABELS[ct]}</option>)}
          </select>
          <select className={input} value={form.goal} onChange={set('goal')}>
            <option value="find_heirs">Find heirs</option><option value="locate_owner">Locate owner</option>
            <option value="mailing_address">Mailing address</option><option value="contact">Contact</option>
            <option value="property_records">Property records</option>
          </select>
          <button type="submit" disabled={busy} className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50">{busy ? 'Queuing…' : 'Research'}</button>
          {msg && <span className="text-xs text-gray-500">{msg}</span>}
          <span className="ml-auto text-xs text-gray-400">avg {money(data?.costTrend?.avgUsd)}/run · {data?.costTrend?.runs ?? 0} runs · {money(data?.costTrend?.totalUsd)} total</span>
        </div>
      </form>

      {/* Master-detail */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: list */}
        <div className="w-80 shrink-0 border-r border-gray-200 overflow-y-auto bg-gray-50">
          {active.length > 0 && (
            <div className="p-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1">In progress</p>
              {active.map(r => (
                <button key={r.id} onClick={() => setSel({ type: 'request', id: r.id })}
                  className={`w-full text-left px-3 py-2 rounded-lg mb-1 ${sel?.type === 'request' && sel.id === r.id ? 'bg-blue-50 ring-1 ring-blue-200' : 'hover:bg-white'}`}>
                  <div className="flex justify-between text-sm"><span className="text-gray-800 truncate">{r.query?.name ?? '—'}</span><span className={`text-[11px] ${STATUS[r.status]}`}>{r.status}</span></div>
                  <div className="text-[10px] text-gray-400">#{r.id} · {r.goal} · {elapsed(r.createdAt)}</div>
                </button>
              ))}
            </div>
          )}
          <div className="p-3">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1">Dossiers</p>
            {(data?.dossiers ?? []).length === 0 ? <p className="text-xs text-gray-300 px-3">none yet</p>
              : (data?.dossiers ?? []).map(d => (
                <button key={d.id} onClick={() => setSel({ type: 'dossier', id: d.id })}
                  className={`w-full text-left px-3 py-2 rounded-lg mb-1 ${sel?.type === 'dossier' && sel.id === d.id ? 'bg-blue-50 ring-1 ring-blue-200' : 'hover:bg-white'}`}>
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-gray-800 truncate">{d.subject?.name ?? '—'}{d.subject?.deceased === true && <span className="ml-1 text-[9px] text-red-500">†</span>}</span>
                    <span className={`px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase ${BAND[d.confidence?.band] ?? ''}`}>{d.confidence?.band}</span>
                  </div>
                  <div className="text-[10px] text-gray-400 flex justify-between"><span>{d.reviewStatus}</span><span>{money(d.usd)}</span></div>
                </button>
              ))}
          </div>
        </div>

        {/* Right: detail */}
        <div className="flex-1 overflow-y-auto bg-white">
          {!sel && <div className="h-full flex items-center justify-center text-sm text-gray-400">Select a dossier or a run.</div>}
          {sel?.type === 'request' && <RequestDetail request={active.find(r => r.id === sel.id)} progress={data?.progress?.[String(sel.id)] ?? []} />}
          {sel?.type === 'dossier' && <DossierDetail id={sel.id} />}
        </div>
      </div>
    </div>
  )
}

function RequestDetail({ request, progress }: { request?: RequestRow; progress: Progress[] }) {
  const last = progress[progress.length - 1]
  // eslint-disable-next-line react-hooks/purity -- live quiet-check, recomputed each render (polled 5s)
  const quiet = request?.status === 'running' && (!last || Date.now() - new Date(last.createdAt).getTime() > 7 * 60_000)
  return (
    <div className="p-6 max-w-2xl">
      <h2 className="text-lg font-bold text-gray-900">{request?.query?.name ?? 'Run'}</h2>
      <p className="text-xs text-gray-400 mb-4">#{request?.id} · {request?.goal} · {request?.status}{request ? ` · ${elapsed(request.createdAt)}` : ''}{quiet ? ' · quiet (still running)' : ''}</p>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-2">Live progress</p>
      {progress.length === 0 ? <p className="text-sm text-gray-400">waiting for the agent to start…</p>
        : <ol className="space-y-1.5">{progress.map((p, i) => (
            <li key={i} className="text-sm text-gray-700 flex gap-2">
              <span className="text-[10px] text-gray-300 shrink-0 w-12">{new Date(p.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
              <span>{p.message}</span>
            </li>))}</ol>}
    </div>
  )
}

type DossierDetailData = {
  dossier: {
    caseId: string | null
    subject: { name: string; deceased: boolean | null; dateOfDeath?: string }
    candidatePeople: ScoredCandidate[]
    confidence: { band: Band; score: number; justification: { note: string }[]; conflicts: { note: string }[] }
    reviewStatus: string
    documents: { id: number; kind: string; label: string | null; sourceUrl: string | null }[]
    // v3 sections — null for dossiers derived before Phase B
    actionableContacts?: ActionableContact[] | null
    familyStructure?: { members: FamilyMember[] } | null
    completeness?: Completeness | null
    conflicts?: Conflict[] | null
    timeline?: TimelineStep[] | null
    sourceIntel?: SourceIntelEntry[] | null
    propertyRecord?: PropertyRecord | null
  }
  evidence: { evidence: EvidenceItem[]; candidates?: CandidatePerson[]; notes: string[] } | null
  cost: { usd: number; model: string | null; inTokens: number; outTokens: number; runSeconds: number } | null
  caseType: string | null
}

const RANK: Record<ContactRank, string> = { high: 'bg-emerald-100 text-emerald-700', medium: 'bg-amber-100 text-amber-700', low: 'bg-gray-100 text-gray-500' }
const CAT_ORDER: RelationCategory[] = ['spouse', 'child', 'grandchild', 'parent', 'grandparent', 'sibling', 'cousin', 'extended', 'friend', 'unknown']
const CAT_LABEL: Record<RelationCategory, string> = { spouse: 'Spouse', child: 'Children', grandchild: 'Grandchildren', parent: 'Parents', grandparent: 'Grandparents', sibling: 'Siblings', cousin: 'Cousins', extended: 'Extended family', friend: 'Friends', unknown: 'Other relatives' }
const Section = ({ title, n, children }: { title: string; n?: number; children: React.ReactNode }) => (
  <div>
    <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-2">{title}{n != null ? ` (${n})` : ''}</p>
    {children}
  </div>
)
const Flag = ({ ok, label }: { ok: boolean; label: string }) => (
  <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${ok ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>{ok ? '✓' : '⚠'} {label}</span>
)

const LINKAGE_LABEL: Record<LinkageType, string> = { current_owner: 'Current owner', prior_owner: 'Prior owner', related_party: 'Related party', possible: 'Possible match', unlinked: 'Not linked' }
const LINKAGE_STYLE: Record<LinkageType, string> = { current_owner: 'bg-emerald-100 text-emerald-700', prior_owner: 'bg-emerald-100 text-emerald-700', related_party: 'bg-blue-100 text-blue-700', possible: 'bg-amber-100 text-amber-700', unlinked: 'bg-red-100 text-red-700' }
const COVERAGE_MARK: Record<CoverageStatus, { m: string; c: string }> = { searched: { m: '✓', c: 'text-emerald-600' }, empty: { m: '∅', c: 'text-gray-400' }, not_attempted: { m: '⚠', c: 'text-amber-600' } }

// One-line summary of a property/lien/tax/transaction fact for the "verify by source" cards.
function propertyFactSummary(e: EvidenceItem): string {
  if (e.kind === 'property') {
    const v = e.value
    return [
      v.owner && `Owner: ${v.owner}`,
      v.parcelId && `Parcel: ${v.parcelId}`,
      v.assessedValue != null && `Assessed: $${v.assessedValue.toLocaleString()}`,
      v.taxStatus && `Tax: ${v.taxStatus}`,
      v.situsAddress && `Situs: ${v.situsAddress}`,
    ].filter(Boolean).join(' · ')
  }
  if (e.kind === 'lien') {
    const v = e.value
    return `Lien: ${v.holder}${v.amount != null ? ` $${v.amount.toLocaleString()}` : ''}${v.instrumentType ? ` (${v.instrumentType})` : ''}`
  }
  if (e.kind === 'tax_event') {
    const v = e.value
    return `Tax ${v.kind}${v.date ? ` ${v.date}` : ''}${v.surplusStated != null ? ` · surplus $${v.surplusStated.toLocaleString()} (stated)` : ''}`
  }
  if (e.kind === 'transaction') {
    const v = e.value
    const bp = v.deedBook ? ` · Book ${v.deedBook}${v.deedPage ? ` Pg ${v.deedPage}` : ''}` : ''
    return `${v.type ?? 'transfer'}${v.date ? ` ${v.date}` : ''}${v.grantor ? ` · grantor ${v.grantor}` : ''}${v.grantee ? ` → ${v.grantee}` : ''}${bp}`
  }
  return ''
}

function evidenceText(e: EvidenceItem): string {
  switch (e.kind) {
    case 'identity': return `Identity: ${e.value.name}${e.value.ageOrDob ? ` (${e.value.ageOrDob})` : ''}`
    case 'address': return `Address [${e.value.kind}]: ${e.value.line1}${e.value.city ? `, ${e.value.city}` : ''} ${e.value.state ?? ''}`
    case 'phone': return `Phone: ${e.value.number}`
    case 'email': return `Email: ${e.value.address}`
    case 'relationship': return `Relationship: ${e.value.person} — ${e.value.relationshipAsStated}`
    case 'deceased': return `Deceased: ${e.value.deceasedStatus}${e.value.dateOfDeath ? ` (${e.value.dateOfDeath})` : ''} [${e.value.basis}]`
    case 'property': return `Property: ${e.value.owner}${e.value.parcelId ? ` · parcel ${e.value.parcelId}` : ''}`
    case 'lien': return `Lien: ${e.value.holder}${e.value.amount != null ? ` · $${e.value.amount.toLocaleString()}` : ''}`
    case 'tax_event': return `Tax ${e.value.kind}${e.value.surplusStated != null ? ` · surplus $${e.value.surplusStated.toLocaleString()}` : ''}`
    case 'note': return e.value.text
    default: return ''
  }
}

function ContactLine({ icon, c }: { icon: string; c: RankedContact }) {
  const v = c.validation
  return (
    <div className="flex items-baseline gap-2 text-xs flex-wrap">
      <span className="shrink-0">{icon}</span>
      <span className="font-medium text-gray-800">{c.value}</span>
      {c.label && <span className="text-[9px] text-gray-400 uppercase">{c.label}</span>}
      <span className={`px-1 py-0.5 rounded text-[8px] font-bold uppercase ${RANK[c.rank]}`}>{c.rank}</span>
      {v ? (
        <>
          <span className={`px-1 py-0.5 rounded text-[9px] font-semibold ${v.verdict === 'good' ? 'bg-emerald-100 text-emerald-700' : v.verdict === 'bad' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`} title="Trestle phone validation">
            {v.verdict === 'good' ? '✓ live' : v.verdict === 'bad' ? '✗ dead' : '? uncertain'}
            {typeof v.activityScore === 'number' ? ` ${v.activityScore}` : ''}{v.lineType ? ` · ${v.lineType}` : ''}
          </span>
          {typeof v.nameMatch === 'boolean' && <span className={`text-[9px] font-medium ${v.nameMatch ? 'text-emerald-600' : 'text-red-500'}`}>{v.nameMatch ? 'name ✓' : 'name ✗'}</span>}
          {v.contactGrade && <span className="text-[9px] text-gray-400">grade {v.contactGrade}</span>}
        </>
      ) : c.notTested ? (
        <span className="px-1 py-0.5 rounded text-[9px] bg-gray-100 text-gray-400" title="A number was already confirmed for this person — skipped to save cost">not tested</span>
      ) : (
        c.contactMethodStatus && c.contactMethodStatus !== 'unverified' && <span className="text-[9px] text-blue-500">{c.contactMethodStatus}</span>
      )}
      <span className="text-[10px] text-gray-400 truncate">{c.reason}</span>
    </div>
  )
}

function DossierDetail({ id }: { id: number }) {
  const { data, isLoading } = useSWR<DossierDetailData>(`/api/research/dossier/${id}`, fetcher)
  const [propBusy, setPropBusy] = useState(false)
  const [propMsg, setPropMsg] = useState<string | null>(null)
  if (isLoading || !data) return <div className="p-6 text-sm text-gray-400">Loading…</div>
  const { dossier, evidence, cost } = data
  const actionable = dossier.actionableContacts ?? []
  const family = dossier.familyStructure?.members ?? []
  const conflicts = dossier.conflicts ?? []
  const timeline = dossier.timeline ?? []
  const completeness = dossier.completeness
  const property = dossier.propertyRecord
  const evItems = evidence?.evidence ?? []

  // "Run property search now" — a property-records run on THIS case, seeded from data we already hold
  // (subject + any known property parcel/address), so we don't re-pay for the people search.
  const propEv = evItems.find(e => e.kind === 'property')
  const propAddrEv = evItems.find(e => e.kind === 'address' && e.value.kind === 'property')
  const propAnchor = {
    parcelId: propEv?.kind === 'property' ? propEv.value.parcelId : undefined,
    address: (propEv?.kind === 'property' ? propEv.value.situsAddress : undefined)
      ?? (propAddrEv?.kind === 'address' ? propAddrEv.value.line1 : undefined),
  }
  async function runPropertySearch() {
    setPropBusy(true); setPropMsg(null)
    try {
      const res = await fetch('/api/research', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: dossier.subject.name, goal: 'property_records', caseId: dossier.caseId, ...propAnchor }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? `Error ${res.status}`)
      setPropMsg(json.skipped ? 'Recent property data already on file' : `Queued property run #${json.requestId}`)
    } catch (err) { setPropMsg(err instanceof Error ? err.message : 'Failed') } finally { setPropBusy(false) }
  }

  // CRM vs researched tally (evidence provenance).
  const crmCount = evItems.filter(e => e.provenance.isFromCrm).length
  const researchedCount = evItems.length - crmCount

  // Group evidence by person (candidate evidenceRefs); unreferenced items → "Other evidence".
  const groups: { name: string; items: { e: EvidenceItem; i: number }[] }[] = []
  if (evItems.length) {
    const assigned = new Set<number>()
    for (const c of evidence?.candidates ?? []) {
      const items = (c.evidenceRefs ?? []).filter(r => evItems[r]).map(r => { assigned.add(r); return { e: evItems[r], i: r } })
      if (items.length) groups.push({ name: c.name ?? c.localId, items })
    }
    const rest = evItems.map((e, i) => ({ e, i })).filter(x => !assigned.has(x.i))
    if (rest.length) groups.push({ name: groups.length ? 'Other evidence' : 'Evidence', items: rest })
  }

  return (
    <div className="p-6 max-w-2xl space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-bold text-gray-900">{dossier.subject.name}</h2>
          <span className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase ${BAND[dossier.confidence.band]}`}>{dossier.confidence.band}</span>
          {dossier.subject.deceased === true && <span className="text-xs text-red-600">deceased{dossier.subject.dateOfDeath ? ` ${dossier.subject.dateOfDeath}` : ''}</span>}
          <div className="ml-auto flex items-center gap-2">
            {caseTypeWantsProperty(data.caseType) ? (
              <button onClick={runPropertySearch} disabled={propBusy}
                className="px-3 py-1.5 bg-emerald-600 text-white text-xs font-medium rounded-lg hover:bg-emerald-700 disabled:opacity-50">
                {propBusy ? 'Queuing…' : '🏠 Run property search now'}
              </button>
            ) : (
              <span className="text-[10px] text-gray-400">property research n/a for {CASE_TYPE_LABELS[(data.caseType ?? 'unknown') as CaseType] ?? data.caseType}</span>
            )}
            <span className="text-xs text-gray-400">{cost ? `${money(cost.usd)} · ${cost.runSeconds}s` : ''}</span>
          </div>
        </div>
        {propMsg && <p className="text-[11px] text-emerald-700 mt-1">{propMsg}</p>}
        {cost && <p className="text-[10px] text-gray-400 mt-0.5">{cost.model} · {cost.inTokens.toLocaleString()} in / {cost.outTokens.toLocaleString()} out</p>}
      </div>

      {/* 1. Conflicts banner + Completeness */}
      {conflicts.length > 0 && (
        <div className="border border-red-200 bg-red-50 rounded-lg p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-red-600 mb-1">⚠ Conflicts — needs human review</p>
          {conflicts.map((c, i) => <p key={i} className="text-xs text-red-700">{c.description}</p>)}
        </div>
      )}
      {completeness && (
        <Section title="Research completeness">
          <div className="flex flex-wrap gap-1.5">
            <Flag ok={completeness.deathConfirmed} label="Death confirmed" />
            <Flag ok={completeness.closeFamilyIdentified} label="Close family identified" />
            <Flag ok={completeness.contactsFound} label="Contacts found" />
            <Flag ok={completeness.propertyConfirmed} label="Property confirmed" />
          </div>
        </Section>
      )}

      {/* 1b. Property record (parcel, owner-of-record, liens, tax/surplus) */}
      {property && (
        <Section title="Property record">
          <div className="border border-gray-200 rounded-lg p-3 space-y-2">
            {/* Subject ↔ property linkage — how the subject is tied (prior owner is the happy path) */}
            {property.linkage && (
              <div className="space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${LINKAGE_STYLE[property.linkage.type]}`}>{LINKAGE_LABEL[property.linkage.type]}</span>
                  {property.linkage.linkedThrough && <span className="text-[11px] text-gray-600">through {property.linkage.linkedThrough.name}{property.linkage.linkedThrough.relationshipAsStated ? ` (${property.linkage.linkedThrough.relationshipAsStated})` : ''}</span>}
                  {property.linkage.corroboratingSources > 0 && <span className="text-[10px] text-gray-400">{property.linkage.corroboratingSources} source{property.linkage.corroboratingSources > 1 ? 's' : ''}</span>}
                  {property.linkage.relationshipBasis.map(b => <span key={b} className="text-[9px] text-gray-400 uppercase tracking-wide">{b.replace(/_/g, ' ')}</span>)}
                </div>
                {property.linkage.evidence.map((ev, i) => <p key={i} className="text-[11px] text-gray-500">{ev}</p>)}
              </div>
            )}
            <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs text-gray-700">
              {property.ownerOfRecord && <div><span className="text-gray-400">Owner of record:</span> {property.ownerOfRecord}</div>}
              {property.parcelId && <div><span className="text-gray-400">Parcel:</span> {property.parcelId}</div>}
              {property.situsAddress && <div className="col-span-2"><span className="text-gray-400">Situs:</span> {property.situsAddress}</div>}
              {property.assessedValue != null && <div><span className="text-gray-400">Assessed:</span> ${property.assessedValue.toLocaleString()}</div>}
              {property.taxStatus && <div><span className="text-gray-400">Tax status:</span> {property.taxStatus}</div>}
            </div>
            {property.transactions && property.transactions.length > 0 && (
              <div className="text-xs">
                <p className="text-gray-400 mb-0.5">Transaction / deed history</p>
                {property.transactions.map((t, i) => (
                  <p key={i} className="text-gray-700">• {t.type ?? 'transfer'}{t.date ? ` ${t.date}` : ''}{t.grantor ? ` · ${t.grantor}` : ''}{t.grantee ? ` → ${t.grantee}` : ''}{t.deedBook ? ` · Book ${t.deedBook}${t.deedPage ? ` Pg ${t.deedPage}` : ''}` : ''}</p>
                ))}
              </div>
            )}
            {property.liens.length > 0 && (
              <div className="text-xs">
                <p className="text-gray-400 mb-0.5">Liens{property.lienTotalStated != null ? ` · $${property.lienTotalStated.toLocaleString()} stated total` : ''}</p>
                {property.liens.map((l, i) => <p key={i} className="text-gray-700">• {l.holder}{l.amount != null ? ` — $${l.amount.toLocaleString()}` : ''}{l.instrumentType ? ` (${l.instrumentType})` : ''}{l.recordedDate ? ` · ${l.recordedDate}` : ''}{l.released ? <span className="ml-1 text-[9px] text-gray-400 uppercase">released</span> : ''}</p>)}
              </div>
            )}
            {property.taxEvents.length > 0 && (
              <div className="text-xs">
                <p className="text-gray-400 mb-0.5">Tax events{property.surplusRelevant ? <span className="ml-1 text-emerald-700 font-semibold">surplus-relevant</span> : ''}{property.surplusStated != null ? ` · $${property.surplusStated.toLocaleString()} surplus (stated)` : ''}</p>
                {property.taxEvents.map((t, i) => <p key={i} className="text-gray-700">• {t.kind}{t.date ? ` ${t.date}` : ''}{t.surplusStated != null ? ` — surplus $${t.surplusStated.toLocaleString()} (stated)` : ''}</p>)}
              </div>
            )}
            {property.documents.length > 0 && (
              <div className="text-xs flex flex-wrap gap-2">
                {property.documents.map((d, i) => <a key={i} href={d.sourceUrl} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">📄 {d.kind}</a>)}
              </div>
            )}
            {/* Coverage — how hard we looked (distinct from confidence). Checklist, not a score. */}
            {property.coverage && (
              <div className="text-[10px] text-gray-400 flex flex-wrap gap-x-3 gap-y-0.5 pt-1 border-t border-gray-100">
                <span className="uppercase tracking-wider">Coverage:</span>
                {property.coverage.items.map(ci => (
                  <span key={ci.label} className={COVERAGE_MARK[ci.status].c}>{COVERAGE_MARK[ci.status].m} {ci.label}{ci.status === 'not_attempted' ? ' (not searched)' : ci.status === 'empty' ? ' (none found)' : ''}</span>
                ))}
                <span>· {property.coverage.transactionsFound} transaction{property.coverage.transactionsFound === 1 ? '' : 's'}</span>
              </div>
            )}
          </div>
        </Section>
      )}

      {/* 1c. Verify — property facts grouped by source (value + raw quote + link to confirm) */}
      {(() => {
        const propEv = evItems.map((e, i) => ({ e, i })).filter(x => x.e.kind === 'property' || x.e.kind === 'lien' || x.e.kind === 'tax_event' || x.e.kind === 'transaction')
        if (!propEv.length) return null
        const bySource = new Map<string, { e: EvidenceItem; i: number }[]>()
        for (const x of propEv) {
          const k = x.e.provenance.sourceId || 'unknown'
          const arr = bySource.get(k) ?? []
          arr.push(x); bySource.set(k, arr)
        }
        return (
          <Section title="Verify — property sources" n={bySource.size}>
            <div className="space-y-2">
              {[...bySource.entries()].map(([sourceId, items]) => {
                const url = items.find(x => x.e.provenance.url)?.e.provenance.url
                return (
                  <div key={sourceId} className="border border-gray-200 rounded-lg p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-gray-700">{sourceId}
                        <span className="ml-1.5 text-[9px] text-gray-400 uppercase">{items[0].e.provenance.sourceType}</span>
                      </span>
                      {url && <a href={url} target="_blank" rel="noreferrer" className="text-[11px] text-blue-600 hover:underline shrink-0">Open source ↗</a>}
                    </div>
                    <div className="mt-1.5 space-y-1.5">
                      {items.map(({ e, i }) => (
                        <div key={i} className="text-xs">
                          <div className="text-gray-700">{propertyFactSummary(e)}</div>
                          {e.provenance.sourceText && <div className="text-[10px] text-gray-400 italic">&ldquo;{e.provenance.sourceText}&rdquo;</div>}
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          </Section>
        )
      })()}

      {/* 2. Actionable Contacts (the top priority) */}
      {actionable.length > 0 ? (
        <Section title="Actionable contacts" n={actionable.length}>
          <div className="space-y-2">
            {actionable.map(c => (
              <div key={c.localId} className="border border-gray-200 rounded-lg p-3">
                <div className="flex justify-between items-center text-sm mb-1.5">
                  <span className="font-medium text-gray-900">{c.name ?? '—'}{c.relationshipAsStated ? <span className="ml-2 text-xs text-gray-500">{c.relationshipAsStated}</span> : null}</span>
                  <span className={`px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase ${BAND[c.confidence.band]}`}>{c.confidence.band}</span>
                </div>
                <div className="space-y-0.5">
                  {c.phones.map((p, i) => <ContactLine key={`p${i}`} icon="📞" c={p} />)}
                  {c.addresses.map((a, i) => <ContactLine key={`a${i}`} icon="🏠" c={a} />)}
                  {c.emails.map((e, i) => <ContactLine key={`e${i}`} icon="✉" c={e} />)}
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {c.confidence.checklist.map((ck, i) => <span key={i} className={`text-[9px] ${ck.present ? 'text-emerald-600' : 'text-gray-300'}`}>{ck.present ? '✓' : '✗'} {ck.label}</span>)}
                </div>
              </div>
            ))}
          </div>
        </Section>
      ) : dossier.candidatePeople.length > 0 && (
        // Fallback for pre-Phase-B dossiers
        <Section title="People" n={dossier.candidatePeople.length}>
          <div className="space-y-2">
            {dossier.candidatePeople.map(c => (
              <div key={c.localId} className="border border-gray-200 rounded-lg p-3">
                <div className="flex justify-between text-sm"><span className="font-medium text-gray-900">{c.name ?? '—'}{c.relationToSubject ? <span className="ml-2 text-xs text-gray-500">{c.relationToSubject}</span> : null}</span><span className="text-[11px] text-gray-400">score {c.score}</span></div>
                {c.phones.length > 0 && <p className="text-xs text-gray-700 mt-1">📞 {c.phones.join(' · ')}</p>}
                {c.emails.length > 0 && <p className="text-xs text-gray-700">✉ {c.emails.join(' · ')}</p>}
                {c.addresses.map((a: Address, i) => <p key={i} className="text-xs text-gray-500">{a.line1}{a.city ? `, ${a.city}` : ''} {a.state ?? ''} <span className="text-[9px] text-gray-300">[{a.kind}]</span></p>)}
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* 3. Family Structure (everyone, for understanding) */}
      {family.length > 0 && (
        <Section title="Family structure" n={family.length}>
          <div className="space-y-3">
            {CAT_ORDER.filter(cat => family.some(m => m.relationCategory === cat)).map(cat => (
              <div key={cat}>
                <p className="text-[10px] font-medium text-gray-500 mb-0.5">{CAT_LABEL[cat]}</p>
                {family.filter(m => m.relationCategory === cat).map((m, i) => (
                  <div key={i} className="flex items-baseline gap-2 text-xs">
                    <span className="text-gray-800">{m.name}</span>
                    {m.maidenName && <span className="text-[10px] text-gray-400">née {m.maidenName}</span>}
                    <span className="text-[10px] text-gray-400">{m.relationshipAsStated}</span>
                    {m.deceasedStatus === 'deceased' && <span className="text-[9px] text-red-500">†</span>}
                    {m.isFromCrm && <span className="text-[8px] px-1 rounded bg-blue-50 text-blue-500 uppercase">CRM</span>}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* 4. Research Timeline */}
      {timeline.length > 0 && (
        <Section title="Research timeline" n={timeline.length}>
          <ol className="space-y-1">
            {timeline.map((s, i) => (
              <li key={i} className="text-xs flex gap-2">
                <span className={`shrink-0 ${s.status === 'failed' || s.status === 'blocked' ? 'text-red-500' : s.status === 'done' ? 'text-emerald-500' : 'text-gray-300'}`}>{s.status === 'failed' || s.status === 'blocked' ? '✗' : s.status === 'done' ? '✓' : '•'}</span>
                <span className="text-gray-700">{s.intent}{s.reason ? <span className="text-gray-400"> — {s.reason}</span> : null}</span>
              </li>
            ))}
          </ol>
        </Section>
      )}

      {/* 5. Evidence grouped by person (raw quotes + attribution) */}
      {groups.length > 0 && (
        <Section title="Evidence" n={evItems.length}>
          <div className="space-y-3">
            {groups.map((g, gi) => (
              <div key={gi}>
                <p className="text-[10px] font-medium text-gray-500 mb-0.5">{g.name}</p>
                <ul className="space-y-1.5">
                  {g.items.map(({ e, i }) => (
                    <li key={i} className="text-xs">
                      <div className="flex justify-between gap-3">
                        <span className="text-gray-700">{evidenceText(e)}</span>
                        <a href={e.provenance.url} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline shrink-0">{e.provenance.sourceId}</a>
                      </div>
                      {e.provenance.sourceText && <p className="text-[10px] text-gray-400 italic">“{e.provenance.sourceText}”</p>}
                      <div className="text-[9px] text-gray-300 flex gap-2">
                        {e.provenance.sourceType && <span className="uppercase">{e.provenance.sourceType}</span>}
                        {e.provenance.retrievedAt && <span>{e.provenance.retrievedAt.slice(0, 10)}</span>}
                        {e.provenance.isFromCrm && <span className="text-blue-400">CRM</span>}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* 6. CRM vs researched + source intel */}
      {evItems.length > 0 && (
        <p className="text-[10px] text-gray-400">Sourced: {crmCount} from CRM · {researchedCount} researched
          {dossier.sourceIntel?.length ? ` · ${dossier.sourceIntel.map(s => `${s.sourceType} ${s.items}/${s.attempts}t`).join(' · ')}` : ''}</p>
      )}

      {/* Documents */}
      {dossier.documents.length > 0 && (
        <Section title="Documents">
          {dossier.documents.map(d => <p key={d.id} className="text-xs text-gray-700">{d.kind}{d.label ? ` — ${d.label}` : ''}{d.sourceUrl ? <a href={d.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-blue-500 ml-2">source</a> : null}</p>)}
        </Section>
      )}
    </div>
  )
}
