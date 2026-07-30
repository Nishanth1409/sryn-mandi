export interface PriceRecord {
  id: string
  state: string
  district: string
  market: string
  commodity: string
  variety: string
  grade: string
  arrival_date: string
  min_price: number
  max_price: number
  modal_price: number
  arrival_qty: number | null
  unit: string
  change: number | null
  change_pct: number | null
  is_shivamogga: boolean
  source: string
}

export interface SummaryStats {
  avg_modal: number
  highest: number
  lowest: number
  markets: number
  varieties: number
  states: number
  records: number
  latest_date: string | null
  shivamogga_avg: number | null
}

export interface HistoryPoint {
  date: string
  avg: number
  min: number
  max: number
  count: number
}

export interface TopMarket {
  market: string
  district: string
  state: string
  variety: string
  modal_price: number
  change_pct: number | null
  is_shivamogga: boolean
  arrival_date: string
}

export interface FeedHealth {
  state: 'live' | 'archived' | 'unavailable'
  consecutive_failures: number
  last_error: string | null
  last_success_at: string | null
  sources: Record<string, string>
  captcha_required?: boolean
  agmarknet_ticket?: {
    active: boolean
    reason?: string
    remaining_calls?: number
    expires_at_iso?: string
  }
  archive: {
    rows: number
    dates: number
    earliest_date: string | null
    latest_date: string | null
  }
}

export interface AgmarknetCaptcha {
  captcha_key: string
  captcha_image: string
  image_type: string
  image_data_url: string
  expires_at: string
  generated_at?: string
}

export interface AgmarknetUnlockResponse {
  ok: boolean
  added_rows: number
  fetched_rows: number
  total_count: number
  pages_fetched: number
  from_date: string
  to_date: string
  states: string[]
  available_dates: string[]
  date_count: number
  prices: PricesResponse
}

export interface PricesResponse {
  updated_at: string
  source: string
  cache_age_seconds: number
  summary: SummaryStats
  records: PriceRecord[]
  board_date?: string | null
  available_dates: string[]
  history: HistoryPoint[]
  history_by_variety?: Record<string, HistoryPoint[]>
  top_markets: TopMarket[]
  feed_health?: FeedHealth
}
