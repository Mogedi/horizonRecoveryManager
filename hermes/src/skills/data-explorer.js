// Skill: data-explorer — answer ANY data question by running read-only SQL against the DB.
// One general skill instead of a narrow skill per metric. The DATABASE_URL_READONLY role
// forbids writes; run_sql adds a SELECT-only guard + statement timeout + row cap.
import { runReadOnlySql, describeSchema } from '../cases-read.js'

const DATA_DICTIONARY = `
You can query the Horizon Recovery database directly with read-only SQL. If unsure of exact
columns or enum values, call describe_schema first. Postgres dialect.

KEY TABLES (call describe_schema for the full column list):
- deals — one row per case. hubspot_id, name, stage (a STAGE ID, not a name), amount (the surplus
  $ owed), county, property_address, parcel_id, tax_sale_date, contact_count, call_attempt_count,
  last_activity_date, stage_entered_at, drive_folder_id, hubspot_files_linked (bool — are case docs
  linked in HubSpot), hubspot_missing_count (int), hubspot_doc_status (jsonb per-doc-type status),
  doc_verification (jsonb).
- deal_enriched — analytics-friendly view of deals with derived columns: normalized_county,
  owner_name, unique_call_days, call_intensity, amount_bucket, case_age_months, tax_sale_year.
  Prefer this for analytics/grouping.
- deal_contacts — one row per contact. deal_hubspot_id, name, contact_type, ownership_status,
  is_deceased, do_not_contact, phone_numbers (JSONB ARRAY), email_list (JSONB ARRAY), address/city/state/zip.
- activity_events — calls + emails. source (enum: HUBSPOT|JUSTCALL|GOOGLE), type ('call'|'email'),
  direction ('inbound'|'outbound'; outbound email = sent by Mo), outcome, body, happened_at,
  metadata (jsonb; for email: subject/from/to, hasFullBody).
- call_transcripts — activity_event_id, classification ('live'|'voicemail'|'disconnected'|'error'),
  transcript, summary. (Only answered outbound JustCall calls get transcribed.)
- case_analyses — AI triage per deal: health, priority, status_label, next_action, analysis_type,
  created_at (latest row per deal is the current state).
- internal_tasks, deal_snoozes, email_sender_rules, app_settings (key/value; 'stage_map' value is a
  JSON map of stageId -> stage name), sync_log/sync_sources.

GOTCHAS:
- Stage is an OPAQUE ID. NEVER show Mo a raw stage id (e.g. "Stage 3478695646") — it's meaningless to
  him. ALWAYS resolve it to the stage NAME using the STAGE NAMES map provided in your context, and
  group/label by name. In SQL you can also join:
    (SELECT value::jsonb FROM app_settings WHERE key='stage_map') ->> d.stage AS stage_name
- # phones for a contact: jsonb_array_length(phone_numbers). # emails: jsonb_array_length(email_list).
- "Missing contact info" usually means a contact (or deal) with no phones AND no emails.
- "Missing documents / missing tax deed doc": deals.hubspot_files_linked = false, or
  hubspot_missing_count > 0, or inspect hubspot_doc_status (jsonb) for a specific doc type.
- "How many cases have emails": count deals with at least one GOOGLE email in activity_events,
  or contacts whose email_list is non-empty — clarify which if ambiguous.
- Always COUNT(*) for totals; LIMIT row-returning queries. Present clear numbers, and briefly say how
  you counted (which table/condition) so Mo can trust it.`

export default {
  name: 'data-explorer',
  description: 'Answer ANY data/metrics question about the portfolio by querying the database directly (read-only SQL): counts, breakdowns, missing-info, doc gaps, phone/email coverage, etc.',
  playbook:
    'Use run_sql to answer data/metrics questions instead of guessing. Call describe_schema when you ' +
    "don't know the exact columns or enum values. Write ONE SELECT per call. " + DATA_DICTIONARY,
  writes: false,
  defaultEnabled: true,
  tools: [
    {
      name: 'describe_schema',
      description: 'List the database tables with their columns, plus all enum types and their allowed values. Call this when unsure how to write a query.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'run_sql',
      description: 'Run ONE read-only SELECT/WITH query (Postgres) and get the rows back. Writes are impossible (read-only role). Add LIMIT for row lists; use COUNT(*) for totals.',
      input_schema: {
        type: 'object',
        properties: { sql: { type: 'string', description: 'a single SELECT or WITH statement' } },
        required: ['sql'],
      },
    },
  ],
  handlers: {
    describe_schema: async () => describeSchema(),
    run_sql: async (input) => {
      try {
        const { rows, rowCount, truncated } = await runReadOnlySql(String(input.sql ?? ''))
        return { rowCount, truncated, rows }
      } catch (e) {
        return `query error: ${e.message}`
      }
    },
  },
}
