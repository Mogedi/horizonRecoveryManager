'use client'

import { useState } from 'react'
import useSWR from 'swr'
import type { Band, EvidenceItem, ScoredCandidate, Address } from '@/lib/research/types'

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
  const [form, setForm] = useState({ name: '', address: '', city: '', state: 'GA', parcelId: '', county: '', goal: 'find_heirs' })
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [sel, setSel] = useState<Selected>(null)
  const { data, mutate } = useSWR<ResearchData>('/api/research', fetcher, { refreshInterval: 5_000 })

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm(f => ({ ...f, [k]: e.target.value }))

  async function enqueue(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name.trim()) { setMsg('Name is required'); return }
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
          <input className={`${input} w-56`} value={form.address} onChange={set('address')} placeholder="Property address" />
          <input className={`${input} w-32`} value={form.city} onChange={set('city')} placeholder="City" />
          <input className={`${input} w-16`} value={form.state} onChange={set('state')} placeholder="GA" />
          <select className={input} value={form.goal} onChange={set('goal')}>
            <option value="find_heirs">Find heirs</option><option value="locate_owner">Locate owner</option>
            <option value="mailing_address">Mailing address</option><option value="contact">Contact</option>
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
  // eslint-disable-next-line react-hooks/purity -- live "stalled?" check, recomputed each render (polled 5s)
  const stalled = request?.status === 'running' && (!last || Date.now() - new Date(last.createdAt).getTime() > 4 * 60_000)
  return (
    <div className="p-6 max-w-2xl">
      <h2 className="text-lg font-bold text-gray-900">{request?.query?.name ?? 'Run'}</h2>
      <p className="text-xs text-gray-400 mb-4">#{request?.id} · {request?.goal} · {request?.status}{request ? ` · ${elapsed(request.createdAt)}` : ''}{stalled ? ' · ⚠ stalled?' : ''}</p>
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
  dossier: { subject: { name: string; deceased: boolean | null; dateOfDeath?: string }; candidatePeople: ScoredCandidate[]; confidence: { band: Band; score: number; justification: { note: string }[]; conflicts: { note: string }[] }; reviewStatus: string; documents: { id: number; kind: string; label: string | null; sourceUrl: string | null }[] }
  evidence: { evidence: EvidenceItem[]; notes: string[] } | null
  cost: { usd: number; model: string | null; inTokens: number; outTokens: number; runSeconds: number } | null
}

function evidenceText(e: EvidenceItem): string {
  switch (e.kind) {
    case 'identity': return `Identity: ${e.value.name}${e.value.ageOrDob ? ` (${e.value.ageOrDob})` : ''}`
    case 'address': return `Address [${e.value.kind}]: ${e.value.line1}${e.value.city ? `, ${e.value.city}` : ''} ${e.value.state ?? ''}`
    case 'phone': return `Phone: ${e.value.number}`
    case 'email': return `Email: ${e.value.address}`
    case 'relationship': return `Relationship: ${e.value.person} — ${e.value.relationToSubject}`
    case 'deceased': return `Deceased: ${e.value.isDeceased ? 'yes' : 'no'}${e.value.dateOfDeath ? ` (${e.value.dateOfDeath})` : ''} [${e.value.basis}]`
    case 'property': return `Property: ${e.value.owner}${e.value.parcelId ? ` · parcel ${e.value.parcelId}` : ''}`
    default: return e.value.text
  }
}

function DossierDetail({ id }: { id: number }) {
  const { data, isLoading } = useSWR<DossierDetailData>(`/api/research/dossier/${id}`, fetcher)
  if (isLoading || !data) return <div className="p-6 text-sm text-gray-400">Loading…</div>
  const { dossier, evidence, cost } = data
  return (
    <div className="p-6 max-w-2xl space-y-5">
      <div>
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-bold text-gray-900">{dossier.subject.name}</h2>
          <span className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase ${BAND[dossier.confidence.band]}`}>{dossier.confidence.band}</span>
          {dossier.subject.deceased === true && <span className="text-xs text-red-600">deceased{dossier.subject.dateOfDeath ? ` ${dossier.subject.dateOfDeath}` : ''}</span>}
          <span className="ml-auto text-xs text-gray-400">{cost ? `${money(cost.usd)} · ${cost.runSeconds}s` : ''}</span>
        </div>
        {cost && <p className="text-[10px] text-gray-400 mt-0.5">{cost.model} · {cost.inTokens.toLocaleString()} in / {cost.outTokens.toLocaleString()} out</p>}
      </div>

      {/* Candidates / heirs */}
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-2">People ({dossier.candidatePeople.length})</p>
        <div className="space-y-2">
          {dossier.candidatePeople.map(c => (
            <div key={c.localId} className="border border-gray-200 rounded-lg p-3">
              <div className="flex justify-between text-sm">
                <span className="font-medium text-gray-900">{c.name ?? '—'}{c.relationToSubject ? <span className="ml-2 text-xs text-gray-500">{c.relationToSubject}</span> : null}</span>
                <span className="text-[11px] text-gray-400">score {c.score}</span>
              </div>
              {c.phones.length > 0 && <p className="text-xs text-gray-700 mt-1">📞 {c.phones.join(' · ')}</p>}
              {c.emails.length > 0 && <p className="text-xs text-gray-700">✉ {c.emails.join(' · ')}</p>}
              {c.addresses.map((a: Address, i) => <p key={i} className="text-xs text-gray-500">{a.line1}{a.city ? `, ${a.city}` : ''} {a.state ?? ''} <span className="text-[9px] text-gray-300">[{a.kind}]</span></p>)}
            </div>
          ))}
        </div>
      </div>

      {/* Evidence / sources */}
      {evidence && evidence.evidence.length > 0 && (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-2">Evidence ({evidence.evidence.length})</p>
          <ul className="space-y-1">
            {evidence.evidence.map((e, i) => (
              <li key={i} className="text-xs text-gray-700 flex justify-between gap-3">
                <span>{evidenceText(e)}</span>
                <a href={e.provenance.url} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline shrink-0">{e.provenance.sourceId}</a>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Documents */}
      {dossier.documents.length > 0 && (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-2">Documents</p>
          {dossier.documents.map(d => <p key={d.id} className="text-xs text-gray-700">{d.kind}{d.label ? ` — ${d.label}` : ''}{d.sourceUrl ? <a href={d.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-blue-500 ml-2">source</a> : null}</p>)}
        </div>
      )}
    </div>
  )
}
