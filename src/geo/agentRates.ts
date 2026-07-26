import type { VarietyBucketKey } from './mandis'
import { VARIETY_BUCKETS, matchesVarietyBucket } from './mandis'
import type { PriceRecord } from '../types'

/**
 * Local agent rate = average of user-submitted purchase amounts for that
 * GPS location (district) + variety. No seeded values. No government agent API.
 */

export const ARHAT_COMMISSION_PCT = 0.02

export type VarietyAverage = {
  variety_key: string
  count: number
  avg_rate: number
  min_rate: number
  max_rate: number
  latest_rate: number
  latest_date?: string
  source?: string
}

export type AgentRateRow = {
  varietyKey: VarietyBucketKey
  title: string
  kannada: string
  lots: number
  mandiMin: number
  mandiModal: number
  mandiMax: number
  agentRate: number | null
  agentCount: number
  agentMin: number | null
  agentMax: number | null
  premium: number | null
  premiumPct: number | null
  arhatOnModal: number
  latestDate: string | null
  agentSource: 'user_average' | 'none'
}

function avg(nums: number[]): number {
  return nums.reduce((a, b) => a + b, 0) / nums.length
}

function roundInr(n: number): number {
  return Math.round(n)
}

export function buildAgentRateRows(
  placeRows: PriceRecord[],
  averagesByVariety?: Partial<Record<string, VarietyAverage>>,
): AgentRateRow[] {
  return VARIETY_BUCKETS.map((bucket) => {
    const lots = placeRows.filter((r) => matchesVarietyBucket(r.variety, bucket.match))
    const userAvg = averagesByVariety?.[bucket.key]

    const modals = lots.map((r) => r.modal_price).filter((n) => n > 0)
    const mins = lots.map((r) => r.min_price).filter((n) => n > 0)
    const maxes = lots.map((r) => r.max_price).filter((n) => n > 0)
    const mandiModal = modals.length ? roundInr(avg(modals)) : 0
    const mandiMin = mins.length ? roundInr(Math.min(...mins)) : 0
    const mandiMax = maxes.length ? roundInr(Math.max(...maxes)) : 0

    const agentRate = userAvg?.avg_rate ? roundInr(userAvg.avg_rate) : null
    const agentCount = userAvg?.count ?? 0
    const premium =
      agentRate != null && mandiModal > 0 ? roundInr(agentRate - mandiModal) : null
    const premiumPct =
      premium != null && mandiModal > 0
        ? Math.round((premium / mandiModal) * 1000) / 10
        : null

    const dates = lots
      .map((r) => r.arrival_date)
      .filter(Boolean)
      .sort()

    return {
      varietyKey: bucket.key,
      title: bucket.title,
      kannada: bucket.kannada,
      lots: lots.length,
      mandiMin,
      mandiModal,
      mandiMax,
      agentRate,
      agentCount,
      agentMin: userAvg?.min_rate ?? null,
      agentMax: userAvg?.max_rate ?? null,
      premium,
      premiumPct,
      arhatOnModal: roundInr(mandiModal * ARHAT_COMMISSION_PCT),
      latestDate: userAvg?.latest_date || (dates.length ? dates[dates.length - 1] : null),
      agentSource: agentRate != null ? 'user_average' : 'none',
    }
  })
}

export function summarizeAgentPremium(rows: AgentRateRow[]): {
  avgMandi: number | null
  avgAgent: number | null
  avgPremium: number | null
  reportCount: number
} {
  const withAgent = rows.filter((r) => r.agentRate != null && r.agentRate > 0)
  const withBoth = withAgent.filter((r) => r.mandiModal > 0)
  return {
    avgMandi: withBoth.length
      ? roundInr(avg(withBoth.map((r) => r.mandiModal)))
      : null,
    avgAgent: withAgent.length
      ? roundInr(avg(withAgent.map((r) => r.agentRate!)))
      : null,
    avgPremium: withBoth.length
      ? roundInr(avg(withBoth.map((r) => r.premium ?? 0)))
      : null,
    reportCount: withAgent.reduce((s, r) => s + r.agentCount, 0),
  }
}
