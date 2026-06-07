/**
 * The ONLY file that knows raw HubSpot property names.
 * If a HubSpot property name changes, only this file changes.
 * All downstream code uses internal types only.
 * Every property access uses ?? null — never assume a key exists.
 */

export type MappedDeal = {
  hubspotId: string
  name: string | null
  stage: string | null
  pipeline: string | null
  ownerId: string | null
  amount: number | null
  estimatedSurplus: number | null
  closeDate: Date | null
  lastActivityDate: Date | null
  stageEnteredAt: Date | null
  lastModified: Date | null
  contactCount: number
  propertyAddress: string | null
  county: string | null
  parcelId: string | null
  taxSaleDate: Date | null
  hubspotUrl: string | null
  rawPayload: unknown
}

export type MappedContact = {
  contactHubspotId: string | null
  name: string | null
  contactType: string | null
  ownershipStatus: string | null
  isDeceased: boolean
  doNotContact: boolean
  phoneNumbers: string[]
  emailList: string[]
  rawPayload: unknown
}

export type MappedActivity = {
  type: string
  body: string | null
  authorOwnerId: string | null
  direction: string | null
  timestamp: Date | null
  metadata: Record<string, unknown> | null
  rawPayload: unknown
}

// ─── Utilities ────────────────────────────────────────────────────────────────

export function stripHtml(html: string): string {
  if (!html) return ''
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function isValidPhone(value: string): boolean {
  const digits = value.replace(/\D/g, '')
  return digits.length >= 10
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null
  const d = new Date(value)
  return isNaN(d.getTime()) ? null : d
}

function parseFloat_(value: string | null | undefined): number | null {
  if (!value) return null
  const n = parseFloat(value)
  return isNaN(n) ? null : n
}

const PHONE_FIELDS = [
  'phone',
  'mobilephone',
  'phone_1',
  'phone_2',
  'phone_3',
  'phone_4',
  'phone_5',
  'phone_6',
  'phone_7',
  'phone_numbers__excess_elite',
  'phone_numbers__beenverified_fastpeople_etc',
] as const

// ─── Mappers ──────────────────────────────────────────────────────────────────

// Stage IDs are stored as-is. stageMap is resolved at display time in the UI/API layer.
export function mapDeal(
  raw: { id: string; properties: Record<string, string | null | undefined>; url?: string | null }
): MappedDeal {
  const p = raw?.properties ?? {}
  return {
    hubspotId: raw.id,
    name: p?.dealname ?? null,
    stage: p?.dealstage ?? null,
    pipeline: p?.pipeline ?? null,
    ownerId: p?.hubspot_owner_id ?? null,
    amount: parseFloat_(p?.amount),
    estimatedSurplus: parseFloat_(p?.estimated_surplus),
    closeDate: parseDate(p?.closedate),
    lastActivityDate: parseDate(p?.notes_last_updated),
    stageEnteredAt: parseDate(p?.hs_v2_date_entered_current_stage),
    lastModified: parseDate(p?.hs_lastmodifieddate),
    contactCount: p?.num_associated_contacts ? parseInt(p.num_associated_contacts, 10) : 0,
    propertyAddress: p?.properties_address ?? null,
    county: p?.county ?? null,
    parcelId: p?.parcel_id__deal ?? null,
    taxSaleDate: parseDate(p?.tax_sale_date),
    hubspotUrl: raw?.url ?? null,
    rawPayload: raw,
  }
}

export function mapContact(
  raw: { id?: string; properties: Record<string, string | null | undefined> }
): MappedContact {
  const p = raw?.properties ?? {}

  const firstName = p?.firstname ?? ''
  const lastName = p?.lastname ?? ''
  const name = [firstName, lastName].filter(Boolean).join(' ').trim() || null

  const phones: string[] = []
  const seen = new Set<string>()
  for (const field of PHONE_FIELDS) {
    const v = p?.[field]
    if (v && isValidPhone(v) && !seen.has(v.trim())) {
      seen.add(v.trim())
      phones.push(v.trim())
    }
  }

  const email = p?.email ?? null
  const emailList = email ? [email] : []

  return {
    contactHubspotId: p?.hs_object_id ?? null,
    name,
    contactType: p?.contact_type1 ?? null,
    ownershipStatus: p?.ownership_contact_status1 ?? null,
    isDeceased: p?.is_deceased === 'true',
    doNotContact: p?.do_not_contact === 'true',
    phoneNumbers: phones,
    emailList,
    rawPayload: raw,
  }
}

export function mapActivity(
  raw: { id?: string; properties: Record<string, string | null | undefined> },
  type: 'note' | 'email' | 'task' | 'call'
): MappedActivity {
  const p = raw?.properties ?? {}

  let body: string | null = null
  let direction: string | null = null
  let metadata: Record<string, unknown> | null = null

  if (type === 'note') {
    const htmlBody = p?.hs_note_body ?? null
    body = htmlBody ? stripHtml(htmlBody) : null
  } else if (type === 'task') {
    // hs_task_subject is the task title; hs_task_body is an optional description
    const subject = p?.hs_task_subject ?? null
    const taskBody = p?.hs_task_body ?? null
    body = subject ?? taskBody
    metadata = p?.hs_task_status ? { status: p.hs_task_status } : null
  } else if (type === 'email') {
    body = p?.hs_email_text ?? p?.hs_email_subject ?? null
    direction = p?.hs_email_direction ?? null
    metadata = {
      from: p?.hs_email_from_email ?? null,
      to: p?.hs_email_to_email ?? null,
      subject: p?.hs_email_subject ?? null,
    }
  } else if (type === 'call') {
    body = p?.hs_call_body ?? p?.hs_call_title ?? null
    direction = p?.hs_call_direction ?? null
  }

  return {
    type,
    body,
    authorOwnerId: p?.hubspot_owner_id ?? null,
    direction,
    timestamp: parseDate(p?.hs_timestamp),
    metadata,
    rawPayload: raw,
  }
}
