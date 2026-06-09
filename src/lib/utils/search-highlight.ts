let currentQuery = ''
let rafId: number | null = null

export function setHighlightQuery(query: string): void {
  currentQuery = query.length >= 2 ? query : ''
  schedule()
}

export function refreshHighlight(): void {
  schedule()
}

function schedule(): void {
  if (typeof window === 'undefined') return
  if (rafId !== null) cancelAnimationFrame(rafId)
  rafId = requestAnimationFrame(() => {
    rafId = null
    apply()
  })
}

function apply(): void {
  if (!('highlights' in CSS)) return

  CSS.highlights.delete('search-hl')
  if (!currentQuery) return

  const container = document.getElementById('deal-panel')
  if (!container) return

  // Split into individual terms so "Linda Brown" highlights both words; dedup so "foo foo" scans once
  const terms = [...new Set(currentQuery.toLowerCase().split(/\s+/).filter(t => t.length >= 2))]
  if (terms.length === 0) return

  const ranges: Range[] = []
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)

  let node: Text | null
  while ((node = walker.nextNode() as Text | null)) {
    const text = node.textContent ?? ''
    const lower = text.toLowerCase()
    for (const term of terms) {
      let idx = lower.indexOf(term)
      while (idx !== -1) {
        const range = new Range()
        range.setStart(node, idx)
        range.setEnd(node, idx + term.length)
        ranges.push(range)
        idx = lower.indexOf(term, idx + 1)
      }
    }
  }

  if (ranges.length > 0) {
    CSS.highlights.set('search-hl', new Highlight(...ranges))
  }
}
