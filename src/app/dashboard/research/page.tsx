'use client'

import { useState } from 'react'
import useSWR from 'swr'
import type { Band } from '@/lib/research/types'

const fetcher = (url: string) => fetch(url).then(r => (r.ok ? r.json() : Promise.reject(new Error(r.statusText))))

type DossierRow = {
  id: number
  subject: { name: string; deceased: boolean | null; dateOfDeath?: string }
  confidence: { band: Band; score: number }
  reviewStatus: string
  createdAt: string
}
type RequestRow = { id: number; query: { name?: string }; goal: string; status: string; createdAt: string }

const BAND_STYLE: Record<Band, string> = {
  high: 'bg-emerald-100 text-emerald-800',
  medium: 'bg-amber-100 text-amber-800',
  low: 'bg-gray-100 text-gray-600',
  conflicting: 'bg-red-100 text-red-800',
}
const STATUS_STYLE: Record<string, string> = {
  pending: 'text-gray-400', running: 'text-blue-600', done: 'text-emerald-600', failed: 'text-red-600',
}

const input = 'px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500'

export default function ResearchPage() {
  const [form, setForm] = useState({ name: '', address: '', city: '', state: 'GA', parcelId: '', county: '', goal: 'find_heirs' })
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const { data, mutate } = useSWR<{ dossiers: DossierRow[]; requests: RequestRow[] }>('/api/research', fetcher, { refreshInterval: 10_000 })

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm(f => ({ ...f, [k]: e.target.value }))

  async function enqueue(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name.trim()) { setMsg('Name is required'); return }
    setBusy(true); setMsg(null)
    try {
      const res = await fetch('/api/research', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? `Error ${res.status}`)
      setMsg(`Queued request #${json.requestId} — Hermes will process it.`)
      mutate()
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-4xl mx-auto px-8 py-6 space-y-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Research</h1>
          <p className="text-sm text-gray-400 mt-0.5">Probate / claimant research from a name + property address. Hermes researches; Horizon stores and scores.</p>
        </div>

        <form onSubmit={enqueue} className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <label className="flex flex-col gap-1 text-xs"><span className="font-medium text-gray-500">Name *</span><input className={input} value={form.name} onChange={set('name')} placeholder="Last, First" /></label>
            <label className="flex flex-col gap-1 text-xs"><span className="font-medium text-gray-500">Property address</span><input className={input} value={form.address} onChange={set('address')} placeholder="235 Whipporwill Ln SE" /></label>
            <label className="flex flex-col gap-1 text-xs"><span className="font-medium text-gray-500">City</span><input className={input} value={form.city} onChange={set('city')} placeholder="Calhoun" /></label>
            <label className="flex flex-col gap-1 text-xs"><span className="font-medium text-gray-500">State</span><input className={input} value={form.state} onChange={set('state')} /></label>
            <label className="flex flex-col gap-1 text-xs"><span className="font-medium text-gray-500">Parcel ID (optional)</span><input className={input} value={form.parcelId} onChange={set('parcelId')} /></label>
            <label className="flex flex-col gap-1 text-xs"><span className="font-medium text-gray-500">Goal</span>
              <select className={input} value={form.goal} onChange={set('goal')}>
                <option value="find_heirs">Find heirs</option>
                <option value="locate_owner">Locate owner</option>
                <option value="mailing_address">Mailing address</option>
                <option value="contact">Contact</option>
              </select>
            </label>
          </div>
          <button type="submit" disabled={busy} className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50">
            {busy ? 'Queuing…' : 'Research'}
          </button>
          {msg && <p className="text-sm text-gray-600">{msg}</p>}
        </form>

        {/* Queue */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2">Queue</h2>
          {(data?.requests ?? []).filter(r => r.status === 'pending' || r.status === 'running').length === 0
            ? <p className="text-xs text-gray-300">nothing queued</p>
            : (data?.requests ?? []).filter(r => r.status === 'pending' || r.status === 'running').map(r => (
              <div key={r.id} className="flex items-center justify-between text-sm py-0.5">
                <span className="text-gray-700">#{r.id} · {r.query?.name ?? '—'} <span className="text-gray-400">({r.goal})</span></span>
                <span className={`text-xs ${STATUS_STYLE[r.status] ?? ''}`}>{r.status}</span>
              </div>
            ))}
        </div>

        {/* Recent dossiers */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2">Recent dossiers</h2>
          {(data?.dossiers ?? []).length === 0
            ? <p className="text-xs text-gray-300">none yet</p>
            : (data?.dossiers ?? []).map(d => (
              <div key={d.id} className="flex items-center justify-between text-sm py-1 border-b border-gray-50 last:border-0">
                <span className="text-gray-800">
                  {d.subject?.name ?? '—'}
                  {d.subject?.deceased === true && <span className="ml-2 text-[10px] text-red-500">deceased</span>}
                </span>
                <span className="flex items-center gap-3">
                  <span className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase ${BAND_STYLE[d.confidence?.band] ?? ''}`}>{d.confidence?.band}</span>
                  <span className="text-[11px] text-gray-400">{d.reviewStatus}</span>
                </span>
              </div>
            ))}
        </div>
      </div>
    </div>
  )
}
