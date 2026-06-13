'use client'

import { useState } from 'react'
import type { Dossier, Band, SourceAttempt, EvidenceItem } from '@/lib/research/types'

type DossierResponse = Dossier & { dossierId: number | null; skipped: string[] }

const BAND_STYLE: Record<Band, string> = {
  high: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  medium: 'bg-amber-100 text-amber-800 border-amber-200',
  low: 'bg-gray-100 text-gray-600 border-gray-200',
  conflicting: 'bg-red-100 text-red-800 border-red-200',
}
const STATUS_STYLE: Record<string, string> = {
  success: 'text-emerald-600',
  empty: 'text-gray-400',
  blocked: 'text-red-600',
  captcha: 'text-red-600',
  error: 'text-orange-600',
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs">
      <span className="font-medium text-gray-500">{label}</span>
      {children}
    </label>
  )
}

const input = 'px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500'

export default function ResearchPage() {
  const [form, setForm] = useState({ name: '', address: '', city: '', state: 'GA', parcelId: '', county: '' })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<DossierResponse | null>(null)

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm(f => ({ ...f, [k]: e.target.value }))

  async function run(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name.trim()) { setError('Name is required'); return }
    setLoading(true); setError(null); setResult(null)
    try {
      const res = await fetch('/api/research', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? `Error ${res.status}`)
      setResult(json as DossierResponse)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed')
    } finally {
      setLoading(false)
    }
  }

  const best = result?.resolution.best

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-4xl mx-auto px-8 py-6 space-y-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Research</h1>
          <p className="text-sm text-gray-400 mt-0.5">Find a person from a name + property address. Public records first.</p>
        </div>

        <form onSubmit={run} className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Name *"><input className={input} value={form.name} onChange={set('name')} placeholder="Last, First" /></Field>
            <Field label="Property address"><input className={input} value={form.address} onChange={set('address')} placeholder="42 Edgewood Ave" /></Field>
            <Field label="City"><input className={input} value={form.city} onChange={set('city')} placeholder="Thomaston" /></Field>
            <Field label="State"><input className={input} value={form.state} onChange={set('state')} /></Field>
            <Field label="Parcel ID (optional)"><input className={input} value={form.parcelId} onChange={set('parcelId')} /></Field>
            <Field label="County (optional — auto-detected)"><input className={input} value={form.county} onChange={set('county')} /></Field>
          </div>
          <button type="submit" disabled={loading} className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50">
            {loading ? 'Researching…' : 'Research'}
          </button>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </form>

        {loading && <p className="text-sm text-gray-400">Running sources (this can take up to a minute)…</p>}

        {result && (
          <div className="space-y-5">
            {/* Verdict */}
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <div className="flex items-center gap-3">
                <span className={`px-2.5 py-1 rounded-md text-xs font-semibold border uppercase ${BAND_STYLE[result.resolution.band]}`}>
                  {result.resolution.band}
                </span>
                <span className="text-xs text-gray-400">score {result.resolution.score} · {result.candidates.length} candidate(s)</span>
              </div>
              {best ? (
                <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                  <Row label="Name" value={best.name} />
                  <Row label="Deceased" value={best.deceased === null ? 'unknown' : best.deceased ? 'yes' : 'no'} />
                  <Row label="Phones" value={best.phones.join(', ')} />
                  <Row label="Emails" value={best.emails.join(', ')} />
                  <Row label="Relatives" value={best.relatives.join(', ')} />
                  <Row label="Age/DOB" value={best.ageOrDob} />
                  <div className="col-span-2">
                    <span className="text-xs font-medium text-gray-500">Addresses</span>
                    <ul className="mt-1 space-y-0.5">
                      {best.addresses.map((a, i) => (
                        <li key={i} className="text-sm text-gray-800">{a.line1}{a.city ? `, ${a.city}` : ''} {a.state ?? ''} <span className="text-[10px] text-gray-400">[{a.kind}]</span></li>
                      ))}
                    </ul>
                  </div>
                </div>
              ) : <p className="mt-3 text-sm text-gray-400">No confident match. {result.resolution.ambiguities.join(' ')}</p>}
            </div>

            {/* Evidence + conflicts */}
            {(result.resolution.evidence.length > 0 || result.resolution.conflicts.length > 0) && (
              <div className="grid grid-cols-2 gap-4">
                <EvidenceList title="Evidence" items={result.resolution.evidence} />
                <EvidenceList title="Conflicts" items={result.resolution.conflicts} />
              </div>
            )}

            {/* Source telemetry */}
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2">Sources</h2>
              <div className="space-y-1">
                {result.attempts.map((a: SourceAttempt, i) => (
                  <div key={i} className="flex items-center justify-between text-sm">
                    <span className="text-gray-700">{a.sourceId}</span>
                    <span className="flex items-center gap-3 text-xs">
                      <span className={STATUS_STYLE[a.status] ?? 'text-gray-500'}>{a.status}{a.blockReason ? ` (${a.blockReason})` : ''}</span>
                      <span className="text-gray-400">{a.candidateCount} found · {a.latencyMs}ms</span>
                    </span>
                  </div>
                ))}
                {result.skipped.length > 0 && <p className="text-xs text-gray-400">skipped (circuit-breaker): {result.skipped.join(', ')}</p>}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <span className="text-xs font-medium text-gray-500">{label}: </span>
      <span className="text-sm text-gray-800">{value || '—'}</span>
    </div>
  )
}

function EvidenceList({ title, items }: { title: string; items: EvidenceItem[] }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2">{title}</h2>
      {items.length === 0 ? <p className="text-xs text-gray-300">none</p> : (
        <ul className="space-y-1">
          {items.map((e, i) => (
            <li key={i} className="text-xs text-gray-700">
              <span className="font-medium">{e.signal}</span> <span className="text-gray-400">(+{e.weight}, {e.sources.length} src)</span> — {e.note}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
