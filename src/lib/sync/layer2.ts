import { type Prisma } from '@prisma/client'
import { getAssociationIds, getObject, batchReadContacts } from '@/lib/hubspot/client'
import { mapContact, mapActivity } from '@/lib/hubspot/mapper'
import { prisma } from '@/lib/db/client'

function asJson(v: unknown): Prisma.InputJsonValue | undefined {
  if (v === undefined) return undefined
  return v as Prisma.InputJsonValue
}

// Properties to fetch per activity type
const NOTE_PROPS = ['hs_note_body', 'hs_timestamp', 'hubspot_owner_id', 'hs_object_id']
const TASK_PROPS = ['hs_task_subject', 'hs_task_body', 'hs_task_status', 'hs_timestamp', 'hubspot_owner_id', 'hs_object_id']
const CALL_PROPS = ['hs_call_body', 'hs_call_title', 'hs_call_direction', 'hs_call_disposition', 'hs_timestamp', 'hubspot_owner_id', 'hs_object_id']
const EMAIL_PROPS = ['hs_email_subject', 'hs_email_text', 'hs_email_direction', 'hs_email_from_email', 'hs_email_to_email', 'hs_timestamp', 'hs_object_id']

export type Layer2SyncResult = {
  apiCallsMade: number
  activitiesStored: number
  contactsStored: number
}

// Fetches full Layer 2 detail for one deal and replaces all activities + contacts in DB.
// Delete-and-reinsert in a single transaction to keep data consistent.
// Only triggered manually (Mo clicks "Load Full Detail") — never auto-run.
export async function runLayer2Sync(hubspotDealId: string): Promise<Layer2SyncResult> {
  let apiCallsMade = 0

  // Step 1: Get association IDs for all 5 types (5 API calls)
  const [noteIds, taskIds, callIds, emailIds, contactIds] = await Promise.all([
    getAssociationIds(hubspotDealId, 'notes'),
    getAssociationIds(hubspotDealId, 'tasks'),
    getAssociationIds(hubspotDealId, 'calls'),
    getAssociationIds(hubspotDealId, 'emails'),
    getAssociationIds(hubspotDealId, 'contacts'),
  ])
  apiCallsMade += 5

  // Step 2: Fetch object content (1 call per activity + 1 batch call for contacts)
  const [notes, tasks, calls, emails] = await Promise.all([
    Promise.all(noteIds.map(id => getObject('notes', id, NOTE_PROPS))),
    Promise.all(taskIds.map(id => getObject('tasks', id, TASK_PROPS))),
    Promise.all(callIds.map(id => getObject('calls', id, CALL_PROPS))),
    Promise.all(emailIds.map(id => getObject('emails', id, EMAIL_PROPS))),
  ])
  apiCallsMade += noteIds.length + taskIds.length + callIds.length + emailIds.length

  let contacts: { id: string; properties: Record<string, string | null> }[] = []
  if (contactIds.length > 0) {
    const batchRes = await batchReadContacts(contactIds)
    contacts = batchRes.results
    apiCallsMade += 1
  }

  // Step 3: Map all fetched data
  const mappedActivities = [
    ...notes.map(r => mapActivity(r, 'note')),
    ...tasks.map(r => mapActivity(r, 'task')),
    ...calls.map(r => mapActivity(r, 'call')),
    ...emails.map(r => mapActivity(r, 'email')),
  ]
  const mappedContacts = contacts.map(r => mapContact(r))

  // Step 4: Delete + reinsert in a single transaction
  await prisma.$transaction(async (tx) => {
    await tx.dealActivity.deleteMany({ where: { dealHubspotId: hubspotDealId } })
    await tx.dealContact.deleteMany({ where: { dealHubspotId: hubspotDealId } })

    if (mappedActivities.length > 0) {
      await tx.dealActivity.createMany({
        data: mappedActivities.map(a => ({
          dealHubspotId: hubspotDealId,
          type: a.type,
          body: a.body,
          authorOwnerId: a.authorOwnerId,
          direction: a.direction,
          timestamp: a.timestamp,
          metadata: asJson(a.metadata ?? undefined),
          rawPayload: asJson(a.rawPayload ?? undefined),
        })),
      })
    }

    if (mappedContacts.length > 0) {
      await tx.dealContact.createMany({
        data: mappedContacts.map(c => ({
          dealHubspotId: hubspotDealId,
          contactHubspotId: c.contactHubspotId,
          name: c.name,
          contactType: c.contactType,
          ownershipStatus: c.ownershipStatus,
          isDeceased: c.isDeceased,
          doNotContact: c.doNotContact,
          phoneNumbers: c.phoneNumbers,
          emailList: c.emailList,
          rawPayload: asJson(c.rawPayload ?? undefined),
        })),
      })
    }
  })

  return {
    apiCallsMade,
    activitiesStored: mappedActivities.length,
    contactsStored: mappedContacts.length,
  }
}

// Returns estimated API call count for Layer 2 WITHOUT hitting the API.
// Used by the UI to show Mo the cost before she confirms.
export async function estimateLayer2Calls(hubspotDealId: string): Promise<number> {
  const deal = await prisma.deal.findUnique({
    where: { hubspotId: hubspotDealId },
    select: { contactCount: true },
  })
  // 5 association calls + estimated activity calls based on contact count
  // Conservative estimate: 5 assoc + deal.contactCount (batch read) + ~5 activity calls
  const contactBatchCall = (deal?.contactCount ?? 0) > 0 ? 1 : 0
  return 5 + contactBatchCall + 5 // 5 assoc + 1 batch + estimated activity fetches
}
