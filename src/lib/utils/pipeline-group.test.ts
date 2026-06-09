import { describe, it, expect } from 'vitest'
import { getPipelineGroup, defaultTabForPipelineGroup } from './pipeline-group'

describe('getPipelineGroup', () => {
  it('returns setup for New Case', () => {
    expect(getPipelineGroup('3477730034')).toBe('setup')
  })
  it('returns setup for Ready for Outreach', () => {
    expect(getPipelineGroup('3477730035')).toBe('setup')
  })
  it('returns outreach for Attempted Contact', () => {
    expect(getPipelineGroup('3477730036')).toBe('outreach')
  })
  it('returns outreach for Contact Made', () => {
    expect(getPipelineGroup('3477730037')).toBe('outreach')
  })
  it('returns outreach for Letter Outreach - Final Attempt', () => {
    expect(getPipelineGroup('3551234806')).toBe('outreach')
  })
  it('returns case_mgmt for Agreement Sent', () => {
    expect(getPipelineGroup('3477730040')).toBe('case_mgmt')
  })
  it('returns case_mgmt for Signed / In Progress', () => {
    expect(getPipelineGroup('3478695644')).toBe('case_mgmt')
  })
  it('returns terminal for Closed-Paid', () => {
    expect(getPipelineGroup('3478695645')).toBe('terminal')
  })
  it('returns terminal for unknown stage id', () => {
    expect(getPipelineGroup('9999999999')).toBe('terminal')
  })
  it('returns terminal for null', () => {
    expect(getPipelineGroup(null)).toBe('terminal')
  })
})

describe('defaultTabForPipelineGroup', () => {
  it('setup → contacts', () => {
    expect(defaultTabForPipelineGroup('setup')).toBe('contacts')
  })
  it('outreach → calls', () => {
    expect(defaultTabForPipelineGroup('outreach')).toBe('calls')
  })
  it('case_mgmt → story', () => {
    expect(defaultTabForPipelineGroup('case_mgmt')).toBe('story')
  })
  it('terminal → story', () => {
    expect(defaultTabForPipelineGroup('terminal')).toBe('story')
  })
})
