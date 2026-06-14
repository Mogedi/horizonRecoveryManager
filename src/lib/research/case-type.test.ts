import { describe, it, expect } from 'vitest'
import { caseTypeWantsProperty, inferCaseType, isCaseType, RESEARCH_PROFILES } from './case-type'

describe('caseTypeWantsProperty — gates property research by case type', () => {
  it('tax sale + mortgage foreclosure want property', () => {
    expect(caseTypeWantsProperty('tax_sale')).toBe(true)
    expect(caseTypeWantsProperty('mortgage_foreclosure')).toBe(true)
  })
  it('state funds + estate sale do NOT want property (contacts only)', () => {
    expect(caseTypeWantsProperty('state_funds')).toBe(false)
    expect(caseTypeWantsProperty('estate_sale')).toBe(false)
  })
  it('unknown / null / garbage → permissive (do not block research before tagging)', () => {
    expect(caseTypeWantsProperty('unknown')).toBe(true)
    expect(caseTypeWantsProperty(null)).toBe(true)
    expect(caseTypeWantsProperty('nonsense')).toBe(true)
  })
  it('every case type declares a profile (extensibility guard)', () => {
    expect(Object.keys(RESEARCH_PROFILES).sort()).toEqual(['estate_sale', 'mortgage_foreclosure', 'state_funds', 'tax_sale', 'unknown'])
    // people research applies to every type
    expect(Object.values(RESEARCH_PROFILES).every(p => p.people)).toBe(true)
  })
})

describe('inferCaseType — migration default only', () => {
  it('stage F → mortgage foreclosure', () => {
    expect(inferCaseType({ stageName: 'F' })).toBe('mortgage_foreclosure')
  })
  it('parcel or tax-sale-date → tax sale', () => {
    expect(inferCaseType({ parcelId: '14F0071' })).toBe('tax_sale')
    expect(inferCaseType({ taxSaleDate: '2023-05-01' })).toBe('tax_sale')
  })
  it('no signal → unknown (state_funds/estate_sale have no inferable signal)', () => {
    expect(inferCaseType({})).toBe('unknown')
  })
})

describe('isCaseType', () => {
  it('validates the enum', () => {
    expect(isCaseType('tax_sale')).toBe(true)
    expect(isCaseType('foo')).toBe(false)
  })
})
