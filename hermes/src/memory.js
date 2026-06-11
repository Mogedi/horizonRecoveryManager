// Hermes long-term memory — durable facts/preferences Mo wants remembered across chats.
// Stored as JSONL in hermes/data/ (gitignored, excluded from deploy rsync, survives PM2 restarts).
// Operational data, not business facts — kept local to Hermes. Reviewable + forgettable.
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'

const PATH = fileURLToPath(new URL('../data/memory.jsonl', import.meta.url))
let cache = null

async function load() {
  if (cache) return cache
  try {
    const txt = await readFile(PATH, 'utf8')
    cache = txt.split('\n').filter(Boolean).map((l) => JSON.parse(l))
  } catch {
    cache = []
  }
  return cache
}

async function persist() {
  await mkdir(dirname(PATH), { recursive: true })
  await writeFile(PATH, cache.map((m) => JSON.stringify(m)).join('\n') + (cache.length ? '\n' : ''))
}

export async function remember(content, tags = []) {
  const all = await load()
  const text = String(content || '').trim()
  if (!text) throw new Error('nothing to remember')
  // De-dupe identical content.
  const existing = all.find((m) => m.content.toLowerCase() === text.toLowerCase())
  if (existing) return existing
  const entry = { id: randomUUID().slice(0, 8), content: text, tags: Array.isArray(tags) ? tags : [], createdAt: new Date().toISOString() }
  all.push(entry)
  await persist()
  return entry
}

// Keyword/recency recall. With no query, returns the most recent. Used by tools AND auto-recall.
export async function recall(query = '', limit = 8) {
  const all = await load()
  if (!query) return all.slice(-limit).reverse()
  const q = String(query).toLowerCase()
  const words = q.split(/\W+/).filter((w) => w.length > 2)
  const scored = all.map((m) => {
    const c = m.content.toLowerCase()
    let s = c.includes(q) ? 5 : 0
    for (const w of words) if (c.includes(w)) s += 1
    for (const t of m.tags || []) if (q.includes(String(t).toLowerCase())) s += 2
    return { m, s }
  })
  const hits = scored.filter((x) => x.s > 0).sort((a, b) => b.s - a.s).map((x) => x.m)
  return hits.slice(0, limit)
}

export async function forget(id) {
  const all = await load()
  const i = all.findIndex((m) => m.id === id)
  if (i < 0) return false
  all.splice(i, 1)
  await persist()
  return true
}

export async function allMemories() {
  return (await load()).slice().reverse()
}
