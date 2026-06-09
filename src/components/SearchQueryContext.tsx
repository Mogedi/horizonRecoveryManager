'use client'

import { createContext, useContext } from 'react'
import { highlightByQuery } from '@/lib/utils/highlight'
import type { ReactNode } from 'react'

const SearchQueryContext = createContext<string>('')

export function SearchQueryProvider({
  query,
  children,
}: {
  query: string
  children: ReactNode
}) {
  return (
    <SearchQueryContext.Provider value={query}>
      {children}
    </SearchQueryContext.Provider>
  )
}

// Returns a function that highlights any text matching the current search query.
// Call at the top of any component inside a SearchQueryProvider:
//   const hl = useHighlight()
//   ...
//   <span>{hl(someText)}</span>
export function useHighlight() {
  const query = useContext(SearchQueryContext)
  return (text: string | null | undefined): ReactNode =>
    query && text ? highlightByQuery(text, query) : (text ?? '')
}
