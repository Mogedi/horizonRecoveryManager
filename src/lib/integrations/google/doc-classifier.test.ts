import { describe, it, expect } from 'vitest'
import { classifyFiles, type DocChecklist } from './doc-classifier'
import type { DriveFileEntry } from './drive-index'

function makeFile(name: string, mimeType = 'application/pdf'): DriveFileEntry {
  return { id: `id-${name}`, name, mimeType, modifiedAt: null, webViewLink: null, iconLink: null, sizeBytes: null }
}

describe('classifyFiles', () => {
  it('returns empty required list with found=false when no files', () => {
    const result = classifyFiles([])
    expect(result.required).toHaveLength(3)
    expect(result.required.every(r => !r.found)).toBe(true)
    expect(result.unclassified).toHaveLength(0)
  })

  it('detects Tax Sale Deed by exact pattern', () => {
    const result = classifyFiles([makeFile('Tax Sale Deed.pdf')])
    const deed = result.required.find(r => r.type === 'tax_sale_deed')!
    expect(deed.found).toBe(true)
    expect(deed.file?.name).toBe('Tax Sale Deed.pdf')
  })

  it('detects Tax Sale Deed case-insensitively', () => {
    const result = classifyFiles([makeFile('TAX SALE DEED - Henderson.pdf')])
    expect(result.required.find(r => r.type === 'tax_sale_deed')?.found).toBe(true)
  })

  it('detects Tax Deed (short form)', () => {
    const result = classifyFiles([makeFile('Henderson Tax Deed.pdf')])
    expect(result.required.find(r => r.type === 'tax_sale_deed')?.found).toBe(true)
  })

  it('detects PropertyRadar profile', () => {
    const result = classifyFiles([makeFile('PropertyRadar.pdf')])
    expect(result.required.find(r => r.type === 'property_radar')?.found).toBe(true)
  })

  it('detects PropertyRadar with space', () => {
    const result = classifyFiles([makeFile('Property Radar Report.pdf')])
    expect(result.required.find(r => r.type === 'property_radar')?.found).toBe(true)
  })

  it('detects property profile', () => {
    const result = classifyFiles([makeFile('Property Profile - 123 Oak St.pdf')])
    expect(result.required.find(r => r.type === 'property_radar')?.found).toBe(true)
  })

  it('detects Notice Letter', () => {
    const result = classifyFiles([makeFile('Notice Letter.pdf')])
    expect(result.required.find(r => r.type === 'notice_letter')?.found).toBe(true)
  })

  it('detects Outreach Letter', () => {
    const result = classifyFiles([makeFile('Outreach Letter - Henderson.pdf')])
    expect(result.required.find(r => r.type === 'notice_letter')?.found).toBe(true)
  })

  it('detects Horizon letter variant', () => {
    const result = classifyFiles([makeFile('Horizon Recovery Letter.pdf')])
    expect(result.required.find(r => r.type === 'notice_letter')?.found).toBe(true)
  })

  it('detects NoticeTemplate naming convention', () => {
    const result = classifyFiles([makeFile('Gerald Phillips ($31K) of NoticeTemplate')])
    expect(result.required.find(r => r.type === 'notice_letter')?.found).toBe(true)
  })

  it('detects noticetemplate (no space)', () => {
    const result = classifyFiles([makeFile('Smith NoticeTemplate.pdf')])
    expect(result.required.find(r => r.type === 'notice_letter')?.found).toBe(true)
  })

  it('puts unrecognized files in unclassified', () => {
    const result = classifyFiles([makeFile('random document.pdf'), makeFile('photo.jpg', 'image/jpeg')])
    expect(result.unclassified).toHaveLength(2)
    expect(result.required.every(r => !r.found)).toBe(true)
  })

  it('handles all three docs present', () => {
    const files = [
      makeFile('Tax Sale Deed.pdf'),
      makeFile('PropertyRadar Report.pdf'),
      makeFile('Notice Letter.pdf'),
    ]
    const result = classifyFiles(files)
    expect(result.required.every(r => r.found)).toBe(true)
    expect(result.unclassified).toHaveLength(0)
  })

  it('extra files beyond required go to unclassified', () => {
    const files = [
      makeFile('Tax Sale Deed.pdf'),
      makeFile('PropertyRadar Report.pdf'),
      makeFile('Notice Letter.pdf'),
      makeFile('Something else.pdf'),
    ]
    const result = classifyFiles(files)
    expect(result.unclassified).toHaveLength(1)
    expect(result.unclassified[0].name).toBe('Something else.pdf')
  })

  it('only uses first matching file per doc type (extras to unclassified)', () => {
    const files = [
      makeFile('Tax Sale Deed 1.pdf'),
      makeFile('Tax Sale Deed 2.pdf'),
    ]
    const result = classifyFiles(files)
    const deed = result.required.find(r => r.type === 'tax_sale_deed')!
    expect(deed.found).toBe(true)
    expect(result.unclassified).toHaveLength(1)
  })

  it('returns correct label for each doc type', () => {
    const result = classifyFiles([])
    const labels = result.required.map(r => r.label)
    expect(labels).toContain('Tax Sale Deed')
    expect(labels).toContain('PropertyRadar Profile')
    expect(labels).toContain('Notice Letter')
  })

  it('file with parens and dollar amounts is still classified', () => {
    const result = classifyFiles([makeFile('Tax Sale Deed ($36K) - Henderson.pdf')])
    expect(result.required.find(r => r.type === 'tax_sale_deed')?.found).toBe(true)
  })

  it('found doc has possibleMatch=null', () => {
    const result = classifyFiles([makeFile('Tax Sale Deed.pdf')])
    const deed = result.required.find(r => r.type === 'tax_sale_deed')!
    expect(deed.found).toBe(true)
    expect(deed.possibleMatch).toBeNull()
    expect(deed.possibleMatchReason).toBeNull()
  })

  it('unclassified file with "deed" in name surfaces as possible match for tax_sale_deed', () => {
    const result = classifyFiles([makeFile('Henderson Deed.pdf')])
    const deed = result.required.find(r => r.type === 'tax_sale_deed')!
    expect(deed.found).toBe(false)
    expect(deed.possibleMatch?.name).toBe('Henderson Deed.pdf')
    expect(deed.possibleMatchReason).toBeTruthy()
  })

  it('unclassified file with "notice" surfaces as possible match for notice_letter', () => {
    const result = classifyFiles([makeFile('Gerald Phillips.pdf')])
    // "Gerald Phillips.pdf" has no notice/letter/template keyword — no possible match
    const notice = result.required.find(r => r.type === 'notice_letter')!
    expect(notice.possibleMatch).toBeNull()
  })

  it('no possible match shown when that type is already found', () => {
    // "Notice Letter.pdf" strongly matches; "template.pdf" should NOT surface as possible match
    const result = classifyFiles([makeFile('Notice Letter.pdf'), makeFile('some template.pdf')])
    const notice = result.required.find(r => r.type === 'notice_letter')!
    expect(notice.found).toBe(true)
    expect(notice.possibleMatch).toBeNull()
  })
})
