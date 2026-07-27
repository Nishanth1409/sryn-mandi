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

export interface PricesResponse {
  updated_at: string
  source: string
  cache_age_seconds: number
  summary: SummaryStats
  records: PriceRecord[]
  board_date?: string | null
  history: HistoryPoint[]
  top_markets: TopMarket[]
}
