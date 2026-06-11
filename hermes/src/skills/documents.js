// Skill: documents (read_file) — read the actual content of a case's Google Drive documents
// (agreements, tax deeds, property profiles, heir docs). Scoped to Drive + Discord attachments;
// never the VPS filesystem. PDFs (incl. scanned county docs) are transcribed by Claude.
import { getDealDocuments, readDriveDocument } from '../hm-api.js'

export default {
  name: 'documents',
  description: "Read a case's actual documents from Google Drive — agreements, tax deeds, property profiles, heir docs. List a deal's files, then read one's full text.",
  playbook:
    'To answer questions about what a case document SAYS (fee split, parcel id, signatures, dates), first ' +
    'list_case_documents for the deal (needs the hubspot_id from case-lookup), pick the right file by name, ' +
    'then read_document with its id. PDFs are transcribed (may be a scan). If Mo attaches a PDF in Discord, ' +
    'you can read it directly without this skill. Quote the document precisely; do not infer beyond it.',
  writes: false,
  defaultEnabled: true,
  tools: [
    {
      name: 'list_case_documents',
      description: "List the Drive documents on file for a deal (id, name, type). Needs the deal's hubspot_id.",
      input_schema: {
        type: 'object',
        properties: { deal_id: { type: 'string', description: 'the deal hubspot_id' } },
        required: ['deal_id'],
      },
    },
    {
      name: 'read_document',
      description: 'Read the full text of one Drive document by its file id (from list_case_documents).',
      input_schema: {
        type: 'object',
        properties: { file_id: { type: 'string', description: 'the Drive file id' } },
        required: ['file_id'],
      },
    },
  ],
  handlers: {
    list_case_documents: async (input) => {
      if (!input.deal_id) return 'a deal hubspot_id is required'
      const r = await getDealDocuments(input.deal_id)
      return r.documents?.length
        ? { folderLink: r.folderLink, documents: r.documents.map((d) => ({ id: d.id, name: d.name, type: d.mimeType })) }
        : 'no documents indexed for this deal yet'
    },
    read_document: async (input) => {
      if (!input.file_id) return 'a file_id is required (from list_case_documents)'
      try {
        const r = await readDriveDocument(input.file_id)
        return { name: r.name, truncated: r.truncated, text: r.text }
      } catch (e) {
        return `could not read that document: ${e.message}`
      }
    },
  },
}
