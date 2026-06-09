import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { setHighlightQuery, refreshHighlight } from './search-highlight'

// ─── Helpers ──────────────────────────────────────────────────────────────────

let mockHighlightsSet: ReturnType<typeof vi.fn>
let mockHighlightsDelete: ReturnType<typeof vi.fn>

beforeEach(() => {
  mockHighlightsSet = vi.fn()
  mockHighlightsDelete = vi.fn()

  vi.stubGlobal('CSS', {
    highlights: { set: mockHighlightsSet, delete: mockHighlightsDelete },
  })
  // Capture Range args passed to new Highlight(...ranges)
  // Must use vi.fn() without an arrow-function implementation — arrow functions cannot be constructors
  vi.stubGlobal('Highlight', vi.fn())

  vi.useFakeTimers()

  // Reset module state: empty query, flush RAF so state is clean for next test
  setHighlightQuery('')
  vi.advanceTimersByTime(20)

  // Clear mock histories so reset calls don't pollute test assertions
  mockHighlightsSet.mockClear()
  mockHighlightsDelete.mockClear()
  vi.mocked(Highlight).mockClear()

  document.body.innerHTML = ''
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

// Advance past one requestAnimationFrame tick (~16ms)
function flush() {
  vi.advanceTimersByTime(20)
}

// Return the Range objects passed to the last Highlight constructor call
function capturedRanges(): Range[] {
  const calls = vi.mocked(Highlight).mock.calls
  if (calls.length === 0) return []
  return calls[calls.length - 1] as unknown as Range[]
}

// Extract matched text from a Range (works because jsdom text nodes have textContent)
function rangeText(range: Range): string {
  const container = range.startContainer as Text
  return (container.textContent ?? '').slice(range.startOffset, range.endOffset)
}

// ─── No-op cases ──────────────────────────────────────────────────────────────

describe('when CSS Highlight API is not available', () => {
  it('does not throw when CSS.highlights is absent', () => {
    vi.stubGlobal('CSS', {})
    document.body.innerHTML = '<div id="deal-panel"><p>ALACHUA</p></div>'
    expect(() => { setHighlightQuery('ALACHUA'); flush() }).not.toThrow()
    expect(mockHighlightsSet).not.toHaveBeenCalled()
  })
})

describe('empty / too-short queries', () => {
  it('deletes highlights and does not set new ones when query is empty', () => {
    document.body.innerHTML = '<div id="deal-panel"><p>ALACHUA</p></div>'
    setHighlightQuery('')
    flush()
    expect(mockHighlightsDelete).toHaveBeenCalledWith('search-hl')
    expect(mockHighlightsSet).not.toHaveBeenCalled()
  })

  it('treats a single-character query as empty (clears, no highlights)', () => {
    document.body.innerHTML = '<div id="deal-panel"><p>ALACHUA</p></div>'
    setHighlightQuery('A')
    flush()
    expect(mockHighlightsDelete).toHaveBeenCalledWith('search-hl')
    expect(mockHighlightsSet).not.toHaveBeenCalled()
  })

  it('does not set highlights when panel has no matching text', () => {
    document.body.innerHTML = '<div id="deal-panel"><p>CHATHAM County</p></div>'
    setHighlightQuery('ALACHUA')
    flush()
    expect(mockHighlightsSet).not.toHaveBeenCalled()
  })

  it('does nothing (no error) when #deal-panel element is absent', () => {
    document.body.innerHTML = '<div id="other-panel"><p>ALACHUA</p></div>'
    expect(() => { setHighlightQuery('ALACHUA'); flush() }).not.toThrow()
    expect(mockHighlightsSet).not.toHaveBeenCalled()
  })
})

// ─── Basic match ──────────────────────────────────────────────────────────────

describe('single-term matching', () => {
  it('highlights a matching term in the panel', () => {
    document.body.innerHTML = '<div id="deal-panel"><p>ALACHUA County deal</p></div>'
    setHighlightQuery('ALACHUA')
    flush()
    expect(mockHighlightsSet).toHaveBeenCalledWith('search-hl', expect.anything())
    expect(capturedRanges()).toHaveLength(1)
    expect(rangeText(capturedRanges()[0])).toBe('ALACHUA')
  })

  it('matches case-insensitively (uppercase query, lowercase text)', () => {
    document.body.innerHTML = '<div id="deal-panel"><p>alachua county</p></div>'
    setHighlightQuery('ALACHUA')
    flush()
    expect(capturedRanges()).toHaveLength(1)
    expect(rangeText(capturedRanges()[0]).toLowerCase()).toBe('alachua')
  })

  it('matches case-insensitively (lowercase query, uppercase text)', () => {
    document.body.innerHTML = '<div id="deal-panel"><h2>ALACHUA - 123 Main St</h2></div>'
    setHighlightQuery('alachua')
    flush()
    expect(capturedRanges()).toHaveLength(1)
  })

  it('finds every occurrence of the term in the panel', () => {
    document.body.innerHTML = `
      <div id="deal-panel">
        <p>ALACHUA County</p>
        <p>Property in ALACHUA area — ALACHUA file</p>
      </div>
    `
    setHighlightQuery('ALACHUA')
    flush()
    expect(capturedRanges()).toHaveLength(3)
    capturedRanges().forEach(r => expect(rangeText(r).toUpperCase()).toBe('ALACHUA'))
  })

  it('scans text nodes nested deep in the panel', () => {
    document.body.innerHTML = `
      <div id="deal-panel">
        <section><div><span>ALACHUA County deal</span></div></section>
      </div>
    `
    setHighlightQuery('ALACHUA')
    flush()
    expect(capturedRanges()).toHaveLength(1)
  })
})

// ─── Multi-word queries ───────────────────────────────────────────────────────

describe('multi-word queries', () => {
  it('highlights each word independently', () => {
    document.body.innerHTML = `
      <div id="deal-panel">
        <p>Linda Smith</p>
        <p>Brown County</p>
      </div>
    `
    setHighlightQuery('Linda Brown')
    flush()
    const matched = capturedRanges().map(r => rangeText(r).toLowerCase())
    expect(matched).toContain('linda')
    expect(matched).toContain('brown')
    expect(capturedRanges()).toHaveLength(2)
  })

  it('skips single-character tokens in a multi-word query', () => {
    document.body.innerHTML = '<div id="deal-panel"><p>Linda A Brown</p></div>'
    setHighlightQuery('Linda A Brown')
    flush()
    // 'A' is 1 char → skipped; only 'Linda' and 'Brown' match
    const matched = capturedRanges().map(r => rangeText(r).toLowerCase())
    expect(matched).toContain('linda')
    expect(matched).toContain('brown')
    expect(matched).not.toContain('a')
    expect(capturedRanges()).toHaveLength(2)
  })

  it('handles overlapping words gracefully (no crash)', () => {
    document.body.innerHTML = '<div id="deal-panel"><p>ALACHUA ALACHUA</p></div>'
    setHighlightQuery('ALACHUA ALACHUA')
    flush()
    // 'alachua' appears twice, query has one unique term → 2 ranges
    expect(capturedRanges()).toHaveLength(2)
  })

  it('highlights nothing when none of the words match', () => {
    document.body.innerHTML = '<div id="deal-panel"><p>CHATHAM County deal</p></div>'
    setHighlightQuery('Linda Brown')
    flush()
    expect(mockHighlightsSet).not.toHaveBeenCalled()
  })
})

// ─── refreshHighlight ─────────────────────────────────────────────────────────

describe('refreshHighlight', () => {
  it('re-applies the current query after DOM changes', () => {
    // Set query first (panel not in DOM yet → no highlights)
    setHighlightQuery('ALACHUA')
    flush()
    expect(mockHighlightsSet).not.toHaveBeenCalled()

    // Panel added to DOM
    document.body.innerHTML = '<div id="deal-panel"><p>ALACHUA County</p></div>'

    // refreshHighlight re-scans with the same query
    refreshHighlight()
    flush()
    expect(capturedRanges()).toHaveLength(1)
  })

  it('does nothing if query was cleared before refresh', () => {
    document.body.innerHTML = '<div id="deal-panel"><p>ALACHUA County</p></div>'
    // Query was left empty (beforeEach reset it)
    refreshHighlight()
    flush()
    expect(mockHighlightsSet).not.toHaveBeenCalled()
  })
})

// ─── Consecutive calls / debounce ─────────────────────────────────────────────

describe('rapid consecutive calls', () => {
  it('only applies the last query when called multiple times before RAF fires', () => {
    document.body.innerHTML = '<div id="deal-panel"><p>ALACHUA County</p></div>'
    setHighlightQuery('ALA')
    setHighlightQuery('ALACH')
    setHighlightQuery('ALACHUA')
    flush()
    // Only one Highlight call — the last query wins
    expect(vi.mocked(Highlight).mock.calls).toHaveLength(1)
    expect(capturedRanges()).toHaveLength(1)
    expect(rangeText(capturedRanges()[0]).toUpperCase()).toBe('ALACHUA')
  })
})
