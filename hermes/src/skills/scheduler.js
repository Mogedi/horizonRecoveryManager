// Skill: schedules — answer "what's coming up" / "did the digest run?" about Hermes's scheduled
// jobs. Reads the live job table + in-memory last-run record from the running scheduler.
import { getSchedules, getLastRuns } from '../schedules.js'

export default {
  name: 'schedules',
  description: "Hermes's own scheduled jobs: what runs and when (syncs, transcription, doc-verify, the morning digest), and whether each last ran ok.",
  playbook:
    'Use list_schedules to answer questions about upcoming/automated jobs. The result includes the ' +
    'current ET time so you can work out what runs next. last_run is null if a job has not fired since ' +
    'the last restart (history beyond that lives in the server logs, which you cannot read).',
  writes: false,
  defaultEnabled: true,
  tools: [
    {
      name: 'list_schedules',
      description: "Hermes's scheduled jobs — each one's cadence (in plain English), what it does, and its most recent run (time + ok/failed), plus the current ET time.",
      input_schema: { type: 'object', properties: {} },
    },
  ],
  handlers: {
    list_schedules: async () => {
      const lastRuns = getLastRuns()
      const nowET = new Date().toLocaleString('en-US', { timeZone: 'America/New_York', dateStyle: 'full', timeStyle: 'short' })
      const jobs = getSchedules().map((j) => ({
        name: j.name,
        runs: j.when,
        does: j.what,
        last_run: lastRuns[j.name] ?? null,
      }))
      return { now_et: nowET, jobs }
    },
  },
}
