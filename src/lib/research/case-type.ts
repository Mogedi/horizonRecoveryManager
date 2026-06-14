// Case type → research profile. The business runs different case types, and only SOME care about
// property records: tax sales and mortgage foreclosures hinge on the property/parcel/liens/surplus,
// while state-funds and estate-sale cases are about reaching people — running GIS/qPublic/GSCCCA for
// those wastes Browser Use / Firecrawl / time. Case type is managed in the Horizon dashboard (our DB),
// NOT HubSpot. This module is the single source of that policy — pure + tested.

export type CaseType = 'tax_sale' | 'mortgage_foreclosure' | 'state_funds' | 'estate_sale' | 'unknown'

export const CASE_TYPES: CaseType[] = ['tax_sale', 'mortgage_foreclosure', 'state_funds', 'estate_sale', 'unknown']

export const CASE_TYPE_LABELS: Record<CaseType, string> = {
  tax_sale: 'Tax sale',
  mortgage_foreclosure: 'Mortgage foreclosure',
  state_funds: 'State funds',
  estate_sale: 'Estate sale',
  unknown: 'Unknown',
}

export const isCaseType = (v: unknown): v is CaseType => CASE_TYPES.includes(v as CaseType)

// The research profile: which research dimensions a case type cares about. Extensible — a new case
// type just declares its profile here; nothing else hardcodes "property".
export interface ResearchProfile {
  property: boolean // pull parcel / liens / tax-sale / surplus (property_records goal)
  people: boolean   // pull heirs / contacts (find_heirs etc.) — every type wants this
}
export const RESEARCH_PROFILES: Record<CaseType, ResearchProfile> = {
  tax_sale: { property: true, people: true },
  mortgage_foreclosure: { property: true, people: true },
  state_funds: { property: false, people: true },
  estate_sale: { property: false, people: true },
  unknown: { property: true, people: true }, // unknown → permissive (don't block research before it's tagged)
}

// Does property research apply to this case? Gate the "Run property search now" button + auto runs on it.
export function caseTypeWantsProperty(t?: CaseType | string | null): boolean {
  return RESEARCH_PROFILES[isCaseType(t) ? t : 'unknown'].property
}

// Migration default ONLY (seeding existing untagged deals). Dashboard remains the source of truth — Mo
// overrides any of these. Stage "F" = Mortgage Foreclosures (GA) per docs; otherwise a parcel / tax-sale
// date implies a tax sale; else unknown. (No signal exists for state_funds / estate_sale — those are
// the new types Mo tags by hand.)
export function inferCaseType(d: { stageName?: string | null; parcelId?: string | null; taxSaleDate?: unknown }): CaseType {
  if ((d.stageName ?? '').trim().toUpperCase() === 'F') return 'mortgage_foreclosure'
  if (d.parcelId || d.taxSaleDate) return 'tax_sale'
  return 'unknown'
}
