import type { VarietyBucketKey } from './mandis'
import { VARIETY_BUCKETS, matchesVarietyBucket } from './mandis'
import type { PriceRecord } from '../types'

/**
 * Local agent rate = min/max of user-submitted purchase amounts for the same
 * place (district + market) + variety. No averages. No seeded values.
 */

export const ARHAT_COMMISSION_PCT = 0.02
/** Agent amount must be between mandi modal and mandi modal + this cap. */
export const AGENT_MAX_OVER_MARKET = 3000

export type VarietyAverage = {
  variety_key: string
  count: number
  min_rate: number
  max_rate: number
  rates?: number[]
  latest_rate?: number
  latest_date?: string
  source?: string
  /** @deprecated kept only if older API payloads still send it */
  avg_rate?: number
}

export type PlaceVarietyStat = {
  district: string
  market: string
  place_label: string
  variety_key: string
  count: number
  min_rate: number
  max_rate: number
  rates: number[]
  latest_rate?: number
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
  agentCount: number
  agentMin: number | null
  agentMax: number | null
  agentRates: number[]
  premiumMin: number | null
  premiumMax: number | null
  arhatOnModal: number
  latestDate: string | null
  agentSource: 'user_minmax' | 'none'
}

function avg(nums: number[]): number {
  return nums.reduce((a, b) => a + b, 0) / nums.length
}

function roundInr(n: number): number {
  return Math.round(n)
}

export function buildAgentRateRows(
  placeRows: PriceRecord[],
  statsByVariety?: Partial<Record<string, VarietyAverage>>,
): AgentRateRow[] {
  return VARIETY_BUCKETS.map((bucket) => {
    const lots = placeRows.filter((r) => matchesVarietyBucket(r.variety, bucket.match))
    const userStats = statsByVariety?.[bucket.key]

    const modals = lots.map((r) => r.modal_price).filter((n) => n > 0)
    const mins = lots.map((r) => r.min_price).filter((n) => n > 0)
    const maxes = lots.map((r) => r.max_price).filter((n) => n > 0)
    const mandiModal = modals.length ? roundInr(avg(modals)) : 0
    const mandiMin = mins.length ? roundInr(Math.min(...mins)) : 0
    const mandiMax = maxes.length ? roundInr(Math.max(...maxes)) : 0

    const agentMin = userStats?.min_rate != null ? roundInr(userStats.min_rate) : null
    const agentMax = userStats?.max_rate != null ? roundInr(userStats.max_rate) : null
    const agentCount = userStats?.count ?? 0
    const agentRates = (userStats?.rates || []).map(roundInr)
    const hasAgent = agentMin != null && agentMax != null && agentCount > 0

    const premiumMin =
      hasAgent && mandiModal > 0 ? roundInr(agentMin! - mandiModal) : null
    const premiumMax =
      hasAgent && mandiModal > 0 ? roundInr(agentMax! - mandiModal) : null

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
      agentCount,
      agentMin,
      agentMax,
      agentRates,
      premiumMin,
      premiumMax,
      arhatOnModal: roundInr(mandiModal * ARHAT_COMMISSION_PCT),
      latestDate: userStats?.latest_date || (dates.length ? dates[dates.length - 1] : null),
      agentSource: hasAgent ? 'user_minmax' : 'none',
    }
  })
}

export function summarizeAgentRange(rows: AgentRateRow[]): {
  mandiModal: number | null
  agentMin: number | null
  agentMax: number | null
  reportCount: number
} {
  const withAgent = rows.filter((r) => r.agentMin != null && r.agentMax != null)
  const withMandi = withAgent.filter((r) => r.mandiModal > 0)
  const allMins = withAgent.map((r) => r.agentMin!)
  const allMaxes = withAgent.map((r) => r.agentMax!)
  return {
    mandiModal: withMandi.length
      ? roundInr(avg(withMandi.map((r) => r.mandiModal)))
      : null,
    agentMin: allMins.length ? Math.min(...allMins) : null,
    agentMax: allMaxes.length ? Math.max(...allMaxes) : null,
    reportCount: withAgent.reduce((s, r) => s + r.agentCount, 0),
  }
}

/** @deprecated use summarizeAgentRange */
export function summarizeAgentPremium(rows: AgentRateRow[]) {
  const range = summarizeAgentRange(rows)
  return {
    avgMandi: range.mandiModal,
    avgAgent: range.agentMin,
    avgPremium:
      range.agentMin != null && range.mandiModal != null
        ? range.agentMin - range.mandiModal
        : null,
    reportCount: range.reportCount,
  }
}

export function groupPlaceStats(
  stats: PlaceVarietyStat[],
): { placeLabel: string; district: string; market: string; rows: PlaceVarietyStat[] }[] {
  const map = new Map<string, PlaceVarietyStat[]>()
  for (const row of stats) {
    const key = `${row.district}|${row.market}`
    const list = map.get(key) || []
    list.push(row)
    map.set(key, list)
  }
  return Array.from(map.entries()).map(([, rows]) => ({
    placeLabel: rows[0]?.place_label || `${rows[0]?.market} · ${rows[0]?.district}`,
    district: rows[0]?.district || '',
    market: rows[0]?.market || '',
    rows,
  }))
}
