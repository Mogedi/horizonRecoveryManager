// Mo's living email style sheet — a DO / DON'T doc that grows over time. Stored on the VPS
// (hermes/data/, survives restarts, like memory + skills state). Referenced on every draft/revision.
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'

const PATH = fileURLToPath(new URL('../data/email-style.json', import.meta.url))

// Seed reflects Mo's stated preferences: warm/polite openers are fine when they're his; the hard
// no's are em-dashes, ellipses, AI stock phrases, and emojis he wouldn't use.
const SEED = {
  do: [
    { id: 's1', text: 'Be warm and polite when it fits — a friendly opener is good IF it matches how Mo actually writes.' },
    { id: 's2', text: "Mirror Mo's real sent emails: his greeting, sentence length, contractions, and sign-off." },
    { id: 's3', text: 'Keep it concise and direct — usually short.' },
  ],
  dont: [
    { id: 's4', text: 'NEVER use em-dashes (—) or en-dashes (–). Use commas, periods, or parentheses.' },
    { id: 's5', text: 'NEVER use ellipses — the three dots (...) — anywhere.' },
    { id: 's6', text: "No robotic AI stock phrases Mo wouldn't say (e.g. 'I hope this email finds you well', \"please don't hesitate\", 'looking forward to hearing from you', 'kindly', 'as per')." },
    { id: 's7', text: 'No emojis unless Mo uses them in his real sent mail.' },
    { id: 's8', text: 'No corporate filler or over-formality.' },
  ],
}

let cache = null
async function load() {
  if (cache) return cache
  try { cache = JSON.parse(await readFile(PATH, 'utf8')) } catch { cache = JSON.parse(JSON.stringify(SEED)) }
  if (!Array.isArray(cache.do)) cache.do = []
  if (!Array.isArray(cache.dont)) cache.dont = []
  return cache
}
async function persist() {
  await mkdir(dirname(PATH), { recursive: true })
  await writeFile(PATH, JSON.stringify(cache, null, 2))
}

export async function addStyle(kind, text) {
  const c = await load()
  const list = kind === 'dont' ? c.dont : c.do
  const e = { id: randomUUID().slice(0, 6), text: String(text || '').trim() }
  if (!e.text) throw new Error('empty rule')
  list.push(e)
  await persist()
  return e
}
export async function removeStyle(id) {
  const c = await load()
  for (const k of ['do', 'dont']) {
    const i = c[k].findIndex((x) => x.id === id)
    if (i >= 0) { c[k].splice(i, 1); await persist(); return true }
  }
  return false
}
export async function listStyle() {
  return load()
}
// Rendered for injection into drafting prompts.
export async function renderStyleSheet() {
  const c = await load()
  const fmt = (a) => (a.length ? a.map((x) => `- ${x.text}`).join('\n') : '- (none yet)')
  return (
    "MO'S EMAIL STYLE SHEET — follow it exactly:\nDO:\n" + fmt(c.do) + "\nDON'T:\n" + fmt(c.dont) +
    "\nBefore finalizing, re-read the draft: does it sound like Mo (a real person), not AI? Fix anything that reads AI-ish."
  )
}
