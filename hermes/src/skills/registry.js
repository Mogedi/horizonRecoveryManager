// Skill registry — the single place skills are registered. Each skill bundles its tool defs,
// tool handlers, a short playbook (injected only when the skill is active), and metadata.
//
// Hermes shows a lightweight MENU (name + description) always, but loads a skill's full tools +
// playbook only when it's relevant (progressive disclosure) — see router.js / chat.js.
import caseLookup from './case-lookup.js'
import emailAssistant from './email-assistant.js'
import outreachPlanner from './outreach-planner.js'
import schedules from './scheduler.js'
import dataExplorer from './data-explorer.js'
import webResearch from './web-research.js'
import calendar from './calendar.js'
import taskManager from './task-manager.js'
import memory from './memory.js'
import documents from './documents.js'
import { loadOverrides, isSkillEnabled, setSkillEnabled } from './state.js'

export const ALL_SKILLS = [
  caseLookup, emailAssistant, outreachPlanner, schedules,
  dataExplorer, webResearch, calendar, taskManager, memory, documents,
]

export function getSkill(name) {
  return ALL_SKILLS.find((s) => s.name === name) ?? null
}

// Skills that are effectively ON (default ± Mo's persisted override).
export async function getEnabledSkills() {
  const overrides = await loadOverrides()
  return ALL_SKILLS.filter((s) => isSkillEnabled(s, overrides))
}

// Always-on skills (core lookup) are loaded every turn regardless of the router.
export function alwaysOnSkills(skills) {
  return skills.filter((s) => s.alwaysOn)
}

// One-line-per-skill menu for the router + system prompt.
export function skillMenu(skills) {
  return skills.map((s) => `- ${s.name}: ${s.description}`).join('\n')
}

// Merge a set of skills into the tool list + handler map + playbook fragments for the chat loop.
// serverTools are Anthropic-executed tools (e.g. web_search) with no local handler.
export function assembleTools(skills) {
  const tools = []
  const handlers = {}
  const playbooks = []
  const serverTools = []
  for (const s of skills) {
    for (const t of s.tools ?? []) tools.push(t)
    for (const [name, fn] of Object.entries(s.handlers ?? {})) handlers[name] = fn
    for (const st of s.serverTools ?? []) serverTools.push(st)
    if (s.playbook) playbooks.push(`[${s.name}] ${s.playbook}`)
  }
  return { tools, handlers, playbooks, serverTools }
}

// Status list for the /skills command.
export async function skillStatus() {
  const overrides = await loadOverrides()
  return ALL_SKILLS.map((s) => ({
    name: s.name,
    description: s.description,
    enabled: isSkillEnabled(s, overrides),
    writes: !!s.writes,
    defaultEnabled: s.defaultEnabled !== false,
  }))
}

export { setSkillEnabled }
