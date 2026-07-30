import type { AgmarknetCaptcha, AgmarknetUnlockResponse, PricesResponse } from './types'
import { apiUrl } from './apiBase'

export async function fetchPrices(options?: {
  days?: number
  states?: string
  scope?: 'karnataka' | 'india'
  refresh?: boolean
  signal?: AbortSignal
}): Promise<PricesResponse> {
  const params = new URLSearchParams()
  params.set('days', String(options?.days ?? 60))
  params.set('scope', options?.scope ?? 'karnataka')
  if (options?.states) params.set('states', options.states)
  if (options?.refresh) params.set('refresh', 'true')

  const res = await fetch(apiUrl(`/api/prices?${params}`), { signal: options?.signal })
  if (!res.ok) {
    throw new Error(`Failed to load prices (${res.status})`)
  }
  return res.json()
}

export async function fetchAgmarknetCaptcha(signal?: AbortSignal): Promise<AgmarknetCaptcha> {
  const res = await fetch(apiUrl('/api/agmarknet/captcha'), { signal })
  if (!res.ok) {
    const detail = await res.text()
    throw new Error(detail || `Failed to load captcha (${res.status})`)
  }
  return res.json()
}

export async function unlockAgmarknetHistory(payload: {
  captcha_key: string
  captcha: string
  days?: number
  scope?: 'karnataka' | 'india'
}): Promise<AgmarknetUnlockResponse> {
  const res = await fetch(apiUrl('/api/agmarknet/unlock'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      captcha_key: payload.captcha_key,
      captcha: payload.captcha,
      days: payload.days ?? 400,
      scope: payload.scope ?? 'karnataka',
    }),
  })
  if (!res.ok) {
    let detail = `Unlock failed (${res.status})`
    try {
      const body = await res.json()
      if (typeof body?.detail === 'string') detail = body.detail
    } catch {
      /* keep default */
    }
    throw new Error(detail)
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
