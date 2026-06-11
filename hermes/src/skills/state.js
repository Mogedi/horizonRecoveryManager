// Persisted skill on/off state. Lives in a local JSON file on the VPS (hermes/data/), NOT the
// dashboard DB — skill enablement is Hermes's own operational config, and its read-only Neon role
// can't write app_settings. The file is gitignored and survives deploys (rsync has no --delete).
//
// Model: per-skill `overrides` map (name → true|false). Effective state = override ?? defaultEnabled.
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const STATE_PATH = fileURLToPath(new URL('../../data/skills-state.json', import.meta.url))

let cache = null

export async function loadOverrides() {
  if (cache) return cache
  try {
    const parsed = JSON.parse(await readFile(STATE_PATH, 'utf8'))
    cache = parsed && typeof parsed.overrides === 'object' ? parsed.overrides : {}
  } catch {
    cache = {} // no file yet → all defaults
  }
  return cache
}

export async function setSkillEnabled(name, enabled) {
  const overrides = await loadOverrides()
  overrides[name] = !!enabled
  await mkdir(dirname(STATE_PATH), { recursive: true })
  await writeFile(STATE_PATH, JSON.stringify({ overrides }, null, 2))
}

// Effective enablement for one skill, given the loaded overrides map.
export function isSkillEnabled(skill, overrides) {
  if (skill.name in overrides) return overrides[skill.name]
  return skill.defaultEnabled !== false
}
