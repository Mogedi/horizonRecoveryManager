// Contact quality analysis — per-deal contact coverage and reachability.
//
// Quality tier reflects contact situation, not call intensity (see deal_enriched for call intensity):
//   reached        — at least one live answer on any number (best signal)
//   working        — calls made, no live answer yet, not all numbers exhausted
//   phone_exhausted— contacts+phones exist, all tried, zero live answers → needs skip-trace
//   weak           — 2–4 contacts (enough to work but could use more)
//   thin           — only 1 contact
//   no_phones      — contacts exist but no phones stored → needs skip-trace for numbers
//   none           — 0 contacts entirely
//
// Owner matching: last name from deal name third segment matched against contact names.
// This is a heuristic — not authoritative until deed OCR verification (future milestone).

import { prisma } from './client'
import { TERMINAL_STAGE_IDS } from './settings'

export type ContactQualityTier =
  | 'reached'
  | 'working'
  | 'phone_exhausted'
  | 'weak'
  | 'thin'
  | 'no_phones'
  | 'none'

// What Mo should do next for this deal (contact-quality dimension only)
export type ContactAction =
  | 'skip_trace'   // 0-1 contacts, or phone_exhausted
  | 'add_contacts' // 2-4 contacts — could use more
  | 'keep_calling' // has phones, calling in progress, no live answer yet
  | 'monitor'      // reached someone, deal is progressing
  | 'terminal'     // deal is in a closed stage

export type ContactQualityRow = {
  dealHubspotId: string
  dealName: string | null
  ownerName: string | null
  ownerContactName: string | null  // the contact whose name matched the owner (if any)
  stage: string | null
  amount: number | null
  // L1 = from deals.contact_count (HubSpot field, always present after Layer 1)
  // L2 = from deal_contacts (populated after Layer 2 sync)
  contactCountL1: number
  contactCountL2: number
  contactsWithPhones: number
  totalPhones: number
  phonesTried: number         // phones with at least one outbound call attempt
  phonesEverLive: number      // phones where a live answer was recorded
  anyReached: boolean         // any live answer on this deal
  ownerInContacts: boolean    // owner name found in a contact name
  ownerReached: boolean       // live answer AND owner name in contacts
  lastCallAt: Date | null
  qualityTier: ContactQualityTier
  action: ContactAction
}

type RawRow = {
  deal_hubspot_id: string
  deal_name: string | null
  owner_name: string | null
  owner_contact_name: string | null
  stage: string | null
  amount: string | null  // Prisma Decimal comes as string from $queryRaw
  contact_count_l1: string
  contact_count_l2: string
  contacts_with_phones: string
  total_phones: string
  phones_tried: string
  phones_ever_live: string
  any_reached: boolean
  owner_in_contacts: boolean
  owner_reached: boolean
  last_call_at: Date | null
}

function computeTier(row: RawRow): ContactQualityTier {
  const l2 = Number(row.contact_count_l2)
  const withPhones = Number(row.contacts_with_phones)
  const tried = Number(row.phones_tried)
  const live = Number(row.phones_ever_live)

  if (row.any_reached) return 'reached'
  if (l2 === 0) return 'none'
  if (withPhones === 0) return 'no_phones'
  // phone_exhausted: all known phones have been tried and none ever got a live answer
  if (tried >= Number(row.total_phones) && tried > 0 && live === 0) return 'phone_exhausted'
  if (tried > 0 && live === 0) return 'working'
  if (l2 === 1) return 'thin'
  if (l2 <= 4) return 'weak'
  return 'weak'  // 5+ contacts, phones exist, no calls yet — still 'weak' until reached
}

function computeAction(
  tier: ContactQualityTier,
  stage: string | null,
): ContactAction {
  if (stage && TERMINAL_STAGE_IDS.has(stage)) return 'terminal'
  if (tier === 'reached') return 'monitor'
  if (tier === 'none' || tier === 'thin' || tier === 'phone_exhausted' || tier === 'no_phones') {
    return 'skip_trace'
  }
  if (tier === 'working') return 'keep_calling'
  return 'add_contacts' // weak
}

export async function getContactQualityList(): Promise<ContactQualityRow[]> {
  const rows = await prisma.$queryRaw<RawRow[]>`
    WITH phone_outcomes AS (
      -- Per (deal, phone): best call outcome across all transcripts
      SELECT
        ae.deal_hubspot_id,
        ae.to_number,
        MAX(ae.happened_at) AS last_call_at,
        MAX(CASE WHEN ct.classification = 'live' THEN 1 ELSE 0 END)::int AS ever_live
      FROM activity_events ae
      LEFT JOIN call_transcripts ct
        ON ct.activity_event_id = ae.id AND ct.classification != 'error'
      WHERE ae.source = 'JUSTCALL'
        AND ae.direction = 'outbound'
        AND ae.to_number IS NOT NULL
      GROUP BY ae.deal_hubspot_id, ae.to_number
    ),
    deal_call_agg AS (
      -- Per deal: aggregate across all phones
      SELECT
        deal_hubspot_id,
        MAX(last_call_at)                                           AS last_call_at,
        COUNT(DISTINCT to_number)::int                             AS phones_tried,
        COUNT(DISTINCT CASE WHEN ever_live = 1 THEN to_number END)::int AS phones_ever_live
      FROM phone_outcomes
      GROUP BY deal_hubspot_id
    ),
    contact_phones_expanded AS (
      -- Expand deal_contacts.phone_numbers JSON array to rows, deduped per deal
      SELECT DISTINCT dc.deal_hubspot_id, dc.id AS contact_id, p.phone_num
      FROM deal_contacts dc
      CROSS JOIN LATERAL jsonb_array_elements_text(
        CASE
          WHEN dc.phone_numbers IS NOT NULL
            AND dc.phone_numbers::text NOT IN ('null', '[]', '')
          THEN dc.phone_numbers::jsonb
          ELSE '[]'::jsonb
        END
      ) AS p(phone_num)
    ),
    contact_agg AS (
      -- Per deal: contact counts and phone coverage
      SELECT
        d.hubspot_id                                                              AS deal_hubspot_id,
        COUNT(DISTINCT dc.id)::int                                                AS contact_count_l2,
        COUNT(DISTINCT CASE WHEN cpe.phone_num IS NOT NULL THEN dc.id END)::int   AS contacts_with_phones,
        COUNT(DISTINCT cpe.phone_num)::int                                        AS total_phones
      FROM deals d
      LEFT JOIN deal_contacts dc ON dc.deal_hubspot_id = d.hubspot_id
      LEFT JOIN contact_phones_expanded cpe
        ON cpe.deal_hubspot_id = d.hubspot_id AND cpe.contact_id = dc.id
      GROUP BY d.hubspot_id
    ),
    owner_match AS (
      -- owner_in_contacts: owner name (from deal_enriched, already stripped of $Amount suffix)
      -- appears anywhere in a contact name — heuristic, not authoritative.
      -- owner_reached: owner name in contacts AND that contact has a live-answered phone.
      -- Uses deal_enriched.owner_name so the $Amount suffix stripping is not duplicated here.
      SELECT
        de.hubspot_id AS deal_hubspot_id,
        COALESCE(MAX(
          CASE
            WHEN de.owner_name IS NOT NULL
              AND lower(dc.name) LIKE '%' || lower(de.owner_name) || '%'
            THEN 1 ELSE 0
          END
        ), 0)::boolean AS owner_in_contacts,
        -- the actual contact name that matched the owner (for display)
        MAX(CASE
          WHEN de.owner_name IS NOT NULL
            AND lower(dc.name) LIKE '%' || lower(de.owner_name) || '%'
          THEN dc.name
        END) AS owner_contact_name,
        -- owner_reached: owner name in contacts AND that contact has a live-answered phone
        COALESCE(MAX(
          CASE
            WHEN de.owner_name IS NOT NULL
              AND lower(dc.name) LIKE '%' || lower(de.owner_name) || '%'
              AND EXISTS (
                SELECT 1 FROM contact_phones_expanded cpe2
                JOIN phone_outcomes po2
                  ON po2.deal_hubspot_id = cpe2.deal_hubspot_id AND po2.to_number = cpe2.phone_num
                WHERE cpe2.deal_hubspot_id = de.hubspot_id
                  AND cpe2.contact_id = dc.id
                  AND po2.ever_live = 1
              )
            THEN 1 ELSE 0
          END
        ), 0)::boolean AS owner_reached
      FROM deal_enriched de
      LEFT JOIN deal_contacts dc ON dc.deal_hubspot_id = de.hubspot_id
      GROUP BY de.hubspot_id
    )
    SELECT
      d.hubspot_id                                    AS deal_hubspot_id,
      d.name                                          AS deal_name,
      de.owner_name,
      d.stage,
      d.amount,
      COALESCE(d.contact_count, 0)                   AS contact_count_l1,
      COALESCE(ca.contact_count_l2, 0)               AS contact_count_l2,
      COALESCE(ca.contacts_with_phones, 0)            AS contacts_with_phones,
      COALESCE(ca.total_phones, 0)                    AS total_phones,
      COALESCE(dca.phones_tried, 0)                   AS phones_tried,
      COALESCE(dca.phones_ever_live, 0)               AS phones_ever_live,
      (COALESCE(dca.phones_ever_live, 0) > 0)         AS any_reached,
      COALESCE(om.owner_in_contacts, false)            AS owner_in_contacts,
      om.owner_contact_name,
      COALESCE(om.owner_reached, false)                AS owner_reached,
      dca.last_call_at
    FROM deals d
    LEFT JOIN deal_enriched de      ON de.hubspot_id = d.hubspot_id
    LEFT JOIN contact_agg ca        ON ca.deal_hubspot_id = d.hubspot_id
    LEFT JOIN deal_call_agg dca     ON dca.deal_hubspot_id = d.hubspot_id
    LEFT JOIN owner_match om        ON om.deal_hubspot_id = d.hubspot_id
    ORDER BY d.name
  `

  return rows.map(r => {
    const tier = computeTier(r)
    const action = computeAction(tier, r.stage)
    return {
      dealHubspotId: r.deal_hubspot_id,
      dealName: r.deal_name ?? null,
      ownerName: r.owner_name ?? null,
      ownerContactName: r.owner_contact_name ?? null,
      stage: r.stage ?? null,
      amount: r.amount != null ? Number(r.amount) : null,
      contactCountL1: Number(r.contact_count_l1),
      contactCountL2: Number(r.contact_count_l2),
      contactsWithPhones: Number(r.contacts_with_phones),
      totalPhones: Number(r.total_phones),
      phonesTried: Number(r.phones_tried),
      phonesEverLive: Number(r.phones_ever_live),
      anyReached: Boolean(r.any_reached),
      ownerInContacts: Boolean(r.owner_in_contacts),
      ownerReached: Boolean(r.owner_reached),
      lastCallAt: r.last_call_at ?? null,
      qualityTier: tier,
      action,
    }
  })
}
