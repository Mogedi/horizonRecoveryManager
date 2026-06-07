import { getAssociationIds, batchReadObjects, batchReadContacts } from '@/lib/hubspot/client'
import { mapContact, mapActivity } from '@/lib/hubspot/mapper'
import { prisma } from '@/lib/db/client'
import { asJson } from '@/lib/utils/json'
import {
  assertDailyLimitOk,
  startSyncLog,
  completeSyncLog,
  failSyncLog,
} from '@/lib/db/sync-log'

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
  await assertDailyLimitOk()
  const logEntry = await startSyncLog('layer2_deal')
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

  // Step 2: Batch read all activity objects (1 call per non-empty type, not 1 per object)
  const [noteRes, taskRes, callRes, emailRes] = await Promise.all([
    noteIds.length > 0 ? batchReadObjects('notes', noteIds, NOTE_PROPS) : Promise.resolve({ results: [] }),
    taskIds.length > 0 ? batchReadObjects('tasks', taskIds, TASK_PROPS) : Promise.resolve({ results: [] }),
    callIds.length > 0 ? batchReadObjects('calls', callIds, CALL_PROPS) : Promise.resolve({ results: [] }),
    emailIds.length > 0 ? batchReadObjects('emails', emailIds, EMAIL_PROPS) : Promise.resolve({ results: [] }),
  ])
  const notes = noteRes.results
  const tasks = taskRes.results
  const calls = callRes.results
  const emails = emailRes.results
  // Count only non-empty types — each non-empty type is 1 batch API call
  apiCallsMade += [noteIds, taskIds, callIds, emailIds].filter(ids => ids.length > 0).length

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

  try {
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

    await completeSyncLog(logEntry.id, apiCallsMade, 1)
    return {
      apiCallsMade,
      activitiesStored: mappedActivities.length,
      contactsStored: mappedContacts.length,
    }
  } catch (err) {
    await failSyncLog(logEntry.id, err instanceof Error ? err.message : String(err))
    throw err
  }
}

// No estimateLayer2Calls — any estimate requires the association calls anyway.
// UI shows static range: "5–50+ API calls depending on deal activity"
// After first Layer 2 sync, UI shows actual count from sync_log.
