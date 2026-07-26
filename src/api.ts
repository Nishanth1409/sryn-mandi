import type { PricesResponse } from './types'
import type { VarietyAverage } from './geo/agentRates'
import type { VarietyBucketKey } from './geo/mandis'
import { apiUrl } from './apiBase'

export async function fetchPrices(options?: {
  days?: number
  states?: string
  scope?: 'karnataka' | 'india'
  refresh?: boolean
  signal?: AbortSignal
}): Promise<PricesResponse> {
  const params = new URLSearchParams()
  params.set('days', String(options?.days ?? 14))
  params.set('scope', options?.scope ?? 'karnataka')
  if (options?.states) params.set('states', options.states)
  if (options?.refresh) params.set('refresh', 'true')

  const res = await fetch(apiUrl(`/api/prices?${params}`), { signal: options?.signal })
  if (!res.ok) {
    throw new Error(`Failed to load prices (${res.status})`)
  }
  return res.json()
}

export async function fetchMarketHistory(
  market: string,
  variety?: string,
  days = 30,
): Promise<{
  market: string
  variety?: string
  series: { date: string; avg: number; min: number; max: number; count: number }[]
}> {
  const params = new URLSearchParams({ market, days: String(days) })
  if (variety) params.set('variety', variety)
  const res = await fetch(apiUrl(`/api/history?${params}`))
  if (!res.ok) throw new Error('Failed to load market history')
  return res.json()
}

export type AgentQuotesResponse = {
  source: string
  note: string
  count: number
  averages_by_variety: Record<string, VarietyAverage>
  quotes: {
    id: string
    variety_key: string
    rate: number
    district: string
    quote_date: string
  }[]
}

export async function fetchAgentQuotes(options?: {
  district?: string
  variety_key?: string
  days?: number
}): Promise<AgentQuotesResponse> {
  const params = new URLSearchParams()
  if (options?.district) params.set('district', options.district)
  if (options?.variety_key) params.set('variety_key', options.variety_key)
  params.set('days', String(options?.days ?? 30))
  const res = await fetch(apiUrl(`/api/agent-quotes?${params}`))
  if (!res.ok) throw new Error('Failed to load agent quotes')
  return res.json()
}

export async function submitAgentQuote(body: {
  variety_key: VarietyBucketKey
  rate: number
  district: string
  market?: string
  note?: string
  lat?: number
  lng?: number
}): Promise<{ ok: boolean; quote: { id: string; rate: number; variety_key: string } }> {
  const res = await fetch(apiUrl('/api/agent-quotes'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as { detail?: string }).detail || 'Failed to save agent quote')
  }
  return res.json()
}
