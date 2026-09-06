import { describe, expect, it } from 'vitest'
import { getTradeGrossPnl, getTradeNetPnl, hasTradePnl, isTradeOpen } from './tradePnl'

describe('tradePnl', () => {
  it('treats trades without exit price and exit time as open', () => {
    expect(isTradeOpen({ entry_price: 100 })).toBe(true)
    expect(hasTradePnl({ entry_price: 100 })).toBe(false)
    expect(getTradeGrossPnl({ entry_price: 100 })).toBe(0)
    expect(getTradeNetPnl({ entry_price: 100 })).toBe(0)
  })

  it('returns realized P&L for open trades with partial exits', () => {
    const trade = {
      entry_price: 100,
      pnl: 50,
      commission: 2,
      fees: 1
    }
    expect(isTradeOpen(trade)).toBe(true)
    expect(hasTradePnl(trade)).toBe(true)
    expect(getTradeNetPnl(trade)).toBe(50)
    expect(getTradeGrossPnl(trade)).toBe(53)
  })

  it('calculates gross and net P&L for closed trades', () => {
    const trade = {
      exit_price: '105.50',
      pnl: '100.25',
      commission: '4.50',
      fees: '1.25'
    }

    expect(isTradeOpen(trade)).toBe(false)
    expect(getTradeNetPnl(trade)).toBe(100.25)
    expect(getTradeGrossPnl(trade)).toBe(106)
  })

  it('handles empty or invalid numeric fields as zero', () => {
    const trade = {
      exit_time: '2026-04-29T15:30:00Z',
      pnl: 'not-a-number',
      commission: '',
      fees: null
    }

    expect(getTradeNetPnl(trade)).toBe(0)
    expect(getTradeGrossPnl(trade)).toBe(0)
  })

  it('correctly handles an open trade with partial exit matching the LIFE case', () => {
    const lifeTrade = {
      symbol: 'LIFE',
      side: 'long',
      entry_price: 35.99,
      exit_price: null,
      exit_time: null,
      quantity: 25,
      pnl: 70.986667,
      pnl_percent: 3.944799,
      commission: 0.013333,
      fees: 0
    }

    expect(isTradeOpen(lifeTrade)).toBe(true)
    expect(hasTradePnl(lifeTrade)).toBe(true)
    expect(getTradeNetPnl(lifeTrade)).toBeCloseTo(70.986667, 5)
    expect(getTradeGrossPnl(lifeTrade)).toBeCloseTo(71.0, 2)
  })
})
