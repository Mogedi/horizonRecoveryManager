import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockTransaction = vi.hoisted(() => vi.fn())

vi.mock('@/lib/db/client', () => ({
  prisma: { $transaction: mockTransaction },
}))

import { withTransaction, withBatchTransaction } from './transaction'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('withTransaction', () => {
  it('calls prisma.$transaction with timeout: 30000 and maxWait: 5000', async () => {
    const fn = vi.fn().mockResolvedValue('result')
    mockTransaction.mockImplementation((f: typeof fn) => f({}))

    await withTransaction(fn)

    expect(mockTransaction).toHaveBeenCalledWith(fn, {
      timeout: 30000,
      maxWait: 5000,
    })
  })

  it('passes custom timeout when provided', async () => {
    const fn = vi.fn().mockResolvedValue('ok')
    mockTransaction.mockImplementation((f: typeof fn) => f({}))

    await withTransaction(fn, { timeout: 10000 })

    expect(mockTransaction).toHaveBeenCalledWith(fn, {
      timeout: 10000,
      maxWait: 5000,
    })
  })

  it('returns the value from the callback', async () => {
    const fn = vi.fn().mockResolvedValue('my-value')
    mockTransaction.mockImplementation((f: typeof fn) => f({}))

    const result = await withTransaction(fn)
    expect(result).toBe('my-value')
  })

  it('propagates errors from the callback', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('db error'))
    mockTransaction.mockImplementation((f: typeof fn) => f({}))

    await expect(withTransaction(fn)).rejects.toThrow('db error')
  })
})

describe('withBatchTransaction', () => {
  it('calls prisma.$transaction with timeout: 30000', async () => {
    const ops = [Promise.resolve(1), Promise.resolve(2)]
    mockTransaction.mockResolvedValue([1, 2])

    await withBatchTransaction(ops)

    expect(mockTransaction).toHaveBeenCalledWith(ops, { timeout: 30000 })
  })

  it('passes custom timeout when provided', async () => {
    const ops = [Promise.resolve(1)]
    mockTransaction.mockResolvedValue([1])

    await withBatchTransaction(ops, { timeout: 60000 })

    expect(mockTransaction).toHaveBeenCalledWith(ops, { timeout: 60000 })
  })

  it('returns the array of results', async () => {
    const ops = [Promise.resolve('a'), Promise.resolve('b')]
    mockTransaction.mockResolvedValue(['a', 'b'])

    const result = await withBatchTransaction(ops)
    expect(result).toEqual(['a', 'b'])
  })
})
