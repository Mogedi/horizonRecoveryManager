import { describe, it, expect } from 'vitest'
import { businessDaysElapsed } from './business-days'

// All dates chosen so day-of-week is unambiguous.
// May 2026: May 1 = Friday, May 4 = Monday

describe('businessDaysElapsed', () => {
  it('same day = 0', () => {
    const d = new Date('2026-05-04T12:00:00Z') // Monday noon UTC
    expect(businessDaysElapsed(d, d)).toBe(0)
  })

  it('until before from = 0', () => {
    const from = new Date('2026-05-08T12:00:00Z') // Friday
    const to   = new Date('2026-05-04T12:00:00Z') // Monday
    expect(businessDaysElapsed(from, to)).toBe(0)
  })

  it('Monday to Tuesday = 1', () => {
    const mon = new Date('2026-05-04T12:00:00Z')
    const tue = new Date('2026-05-05T12:00:00Z')
    expect(businessDaysElapsed(mon, tue)).toBe(1)
  })

  it('Monday to Friday = 4', () => {
    const mon = new Date('2026-05-04T12:00:00Z')
    const fri = new Date('2026-05-08T12:00:00Z')
    expect(businessDaysElapsed(mon, fri)).toBe(4)
  })

  it('Friday to Monday = 1 (skips weekend)', () => {
    const fri = new Date('2026-05-01T12:00:00Z')
    const mon = new Date('2026-05-04T12:00:00Z')
    expect(businessDaysElapsed(fri, mon)).toBe(1)
  })

  it('Friday to Tuesday = 2 (skips Sat + Sun)', () => {
    const fri = new Date('2026-05-01T12:00:00Z')
    const tue = new Date('2026-05-05T12:00:00Z')
    expect(businessDaysElapsed(fri, tue)).toBe(2)
  })

  it('Monday to next Monday = 5', () => {
    const mon1 = new Date('2026-05-04T12:00:00Z')
    const mon2 = new Date('2026-05-11T12:00:00Z')
    expect(businessDaysElapsed(mon1, mon2)).toBe(5)
  })

  // Critical: timezone edge case.
  // 11pm EDT (UTC-4) on Friday May 1 = 03:00 UTC on Saturday May 2.
  // The deal entered the stage at Friday 11pm Eastern — Eastern calendar date is May 1 (Friday).
  // Monday May 4 should be 1 business day elapsed (not 0, which would happen if we used UTC date).
  it('uses Eastern timezone — 11pm ET Friday is still Friday, Monday = 1 day elapsed', () => {
    const lateEtFriday = new Date('2026-05-02T03:00:00Z') // 11pm EDT May 1 = 3am UTC May 2
    const monday = new Date('2026-05-04T12:00:00Z')
    expect(businessDaysElapsed(lateEtFriday, monday)).toBe(1)
  })

  // Another timezone edge: 1am UTC Saturday = 9pm ET Friday
  it('1am UTC Saturday is still Friday in ET — Monday is 1 business day', () => {
    const etFriday = new Date('2026-05-02T01:00:00Z') // 9pm ET Friday May 1
    const monday   = new Date('2026-05-04T12:00:00Z')
    expect(businessDaysElapsed(etFriday, monday)).toBe(1)
  })

  // Threshold validation: 7-day threshold should fire on or after 7 elapsed
  it('7 business days: Mon to next Wed = 7', () => {
    const mon = new Date('2026-05-04T12:00:00Z') // Monday May 4
    const wed = new Date('2026-05-13T12:00:00Z') // Wednesday May 13
    expect(businessDaysElapsed(mon, wed)).toBe(7)
  })
})
