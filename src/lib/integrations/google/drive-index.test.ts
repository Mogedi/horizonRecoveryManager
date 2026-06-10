import { describe, it, expect } from 'vitest'
import { normalizeFolderName, findBestFolderMatch } from './drive-index'

// ─── normalizeFolderName ──────────────────────────────────────────────────────

describe('normalizeFolderName', () => {
  it('strips trailing dollar amount with K suffix', () => {
    expect(normalizeFolderName('CHATHAM - 2214 Hanson St - Smith ($54K)')).toBe('chatham - 2214 hanson st - smith')
  })

  it('strips trailing dollar amount with M suffix', () => {
    expect(normalizeFolderName('FULTON - 100 Oak Ave - Jones ($1.2M)')).toBe('fulton - 100 oak ave - jones')
  })

  it('converts en-dash to hyphen', () => {
    expect(normalizeFolderName('CHATHAM – 2214 Hanson St')).toBe('chatham - 2214 hanson st')
  })

  it('converts em-dash to hyphen', () => {
    expect(normalizeFolderName('CHATHAM — 2214 Hanson St')).toBe('chatham - 2214 hanson st')
  })

  it('collapses multiple spaces', () => {
    expect(normalizeFolderName('CHATHAM  -  2214  Hanson  St')).toBe('chatham - 2214 hanson st')
  })

  it('lowercases', () => {
    expect(normalizeFolderName('CHATHAM')).toBe('chatham')
  })

  it('does not strip dollar amount that is not at the end', () => {
    expect(normalizeFolderName('($54K) CHATHAM - 2214')).toBe('($54k) chatham - 2214')
  })
})

// ─── findBestFolderMatch ──────────────────────────────────────────────────────

const makeFolder = (name: string, id = name) => ({ id, name, webViewLink: `https://drive.google.com/folders/${id}` })

describe('findBestFolderMatch', () => {
  it('returns null for empty deal name', () => {
    expect(findBestFolderMatch('', [makeFolder('CHATHAM - 2214 Hanson St')])).toBeNull()
  })

  it('returns null for empty folders list', () => {
    expect(findBestFolderMatch('CHATHAM - 2214 Hanson St', [])).toBeNull()
  })

  it('returns null when no folder matches', () => {
    const folders = [makeFolder('FULTON - 522 Oak Rd - Davis')]
    expect(findBestFolderMatch('CHATHAM - 2214 Hanson St - Smith', folders)).toBeNull()
  })

  // ── Tier 1: exact ────────────────────────────────────────────────────────────

  it('matches exact name — tier exact', () => {
    const folder = makeFolder('CHATHAM - 2214 Hanson St - Smith')
    const result = findBestFolderMatch('CHATHAM - 2214 Hanson St - Smith', [folder])
    expect(result?.method).toBe('exact')
    expect(result?.folder.id).toBe(folder.id)
  })

  // ── Tier 2: normalized ───────────────────────────────────────────────────────

  it('matches when deal has trailing dollar suffix — tier normalized', () => {
    const folder = makeFolder('CHATHAM - 2214 Hanson St - Smith')
    const result = findBestFolderMatch('CHATHAM - 2214 Hanson St - Smith ($54K)', [folder])
    expect(result?.method).toBe('normalized')
    expect(result?.folder.id).toBe(folder.id)
  })

  it('matches when folder has en-dashes — tier normalized', () => {
    const folder = makeFolder('CHATHAM – 2214 Hanson St – Smith')
    const result = findBestFolderMatch('CHATHAM - 2214 Hanson St - Smith', [folder])
    expect(result?.method).toBe('normalized')
  })

  it('matches case-insensitively — tier normalized', () => {
    const folder = makeFolder('Chatham - 2214 Hanson St - Smith')
    const result = findBestFolderMatch('CHATHAM - 2214 HANSON ST - SMITH', [folder])
    expect(result?.method).toBe('normalized')
  })

  it('matches when folder has both en-dash and dollar suffix — tier normalized', () => {
    const folder = makeFolder('CHATHAM – 2214 Hanson St – Smith')
    const result = findBestFolderMatch('CHATHAM - 2214 Hanson St - Smith ($54K)', [folder])
    expect(result?.method).toBe('normalized')
  })

  // ── Tier 3: prefix ───────────────────────────────────────────────────────────

  it('matches when deal name has extra trailing segment — tier prefix', () => {
    const folder = makeFolder('CHATHAM - 2214 Hanson St - Smith')
    const result = findBestFolderMatch('CHATHAM - 2214 Hanson St - Smith - Addendum', [folder])
    expect(result?.method).toBe('prefix')
    expect(result?.folder.id).toBe(folder.id)
  })

  it('matches when folder name has extra trailing segment — tier prefix', () => {
    const folder = makeFolder('CHATHAM - 2214 Hanson St - Smith - Archive')
    const result = findBestFolderMatch('CHATHAM - 2214 Hanson St - Smith', [folder])
    expect(result?.method).toBe('prefix')
  })

  // ── Tier 4: token overlap ────────────────────────────────────────────────────

  it('matches when tokens overlap at 0.75+ threshold — tier token', () => {
    // deal: chatham 2214 hanson smith 54k → after stripping: chatham 2214 hanson smith
    // folder: chatham 2214 hanson st smith → 4 shared of 4+5=9 tokens → 8/9 ≈ 0.89
    const folder = makeFolder('CHATHAM 2214 Hanson St Smith')
    const result = findBestFolderMatch('CHATHAM 2214 Hanson Smith ($54K)', [folder])
    expect(result?.method).toBe('token')
  })

  it('does not match when token overlap is below threshold', () => {
    // Only 1 shared meaningful token out of many → well below 0.75
    const folder = makeFolder('FULTON - 522 Oak Rd - Davis')
    const result = findBestFolderMatch('CHATHAM - 2214 Hanson St - Smith', [folder])
    expect(result).toBeNull()
  })

  // ── False positive prevention ────────────────────────────────────────────────

  it('does not match a single common word against a long folder name', () => {
    const folder = makeFolder('CHATHAM - 2214 Hanson St - Smith')
    expect(findBestFolderMatch('CHATHAM', [folder])).toBeNull()
  })

  it('prefers exact over normalized when both could match', () => {
    const exact = makeFolder('CHATHAM - 2214 Hanson St', 'exact-id')
    const norm = makeFolder('CHATHAM - 2214 Hanson St - Smith ($54K)', 'norm-id')
    const result = findBestFolderMatch('CHATHAM - 2214 Hanson St', [norm, exact])
    expect(result?.method).toBe('exact')
    expect(result?.folder.id).toBe('exact-id')
  })

  it('returns the first match when multiple folders would match at the same tier', () => {
    const a = makeFolder('CHATHAM - 2214 Hanson St - Smith', 'a')
    const b = makeFolder('CHATHAM - 2214 Hanson St - Smith', 'b')
    const result = findBestFolderMatch('CHATHAM - 2214 Hanson St - Smith', [a, b])
    expect(result?.folder.id).toBe('a')
  })
})
