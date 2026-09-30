import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react'
import type { PriceRecord } from '../types'

export function formatINR(value: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(value)
}

export function formatCompact(value: number): string {
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(value)
}

/** Format a Date as DD-MM-YYYY (AGMARKNET board style). */
export function formatBoardDate(d: Date = new Date()): string {
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  return `${dd}-${mm}-${d.getFullYear()}`
}

/** True when arrival_date is calendar today (DD-MM-YYYY or ISO). */
export function isBoardDateToday(arrivalDate: string | null | undefined): boolean {
  if (!arrivalDate) return false
  const today = formatBoardDate()
  if (arrivalDate === today) return true
  // ISO YYYY-MM-DD
  const iso = arrivalDate.slice(0, 10)
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    const [y, m, d] = iso.split('-')
    return `${d}-${m}-${y}` === today
  }
  return false
}

export function resolveBoardDate(
  latestDate: string | null | undefined,
  updatedAt?: string,
): string {
  if (latestDate) return latestDate
  if (updatedAt) {
    const d = new Date(updatedAt)
    if (!Number.isNaN(d.getTime())) return formatBoardDate(d)
  }
  return formatBoardDate()
}

/** Sort key for DD-MM-YYYY / ISO arrival dates (higher = newer). */
export function arrivalSortKey(arrivalDate: string): number {
  const iso = arrivalDate.slice(0, 10)
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    return Number(iso.replace(/-/g, ''))
  }
  const m = arrivalDate.match(/^(\d{2})[-/](\d{2})[-/](\d{4})$/)
  if (m) return Number(`${m[3]}${m[2]}${m[1]}`)
  return 0
}

/** Newest official day that is not after the viewer's today. */
export function pickLiveBoardDate(records: { arrival_date: string }[]): string | null {
  if (!records.length) return null
  const todayKey = arrivalSortKey(formatBoardDate())
  let best: string | null = null
  let bestKey = -1
  let newest: string | null = null
  let newestKey = -1
  for (const record of records) {
    if (!record.arrival_date) continue
    const key = arrivalSortKey(record.arrival_date)
    if (key <= 0) continue
    if (key > newestKey) {
      newestKey = key
      newest = record.arrival_date
    }
    if (todayKey && key > todayKey) continue
    if (key > bestKey) {
      bestKey = key
      best = record.arrival_date
    }
  }
  return best ?? newest
}

export function filterToBoardDate<T extends { arrival_date: string }>(
  records: T[],
  boardDate: string | null | undefined,
): T[] {
  if (!boardDate) return records
  const filtered = records.filter(
    (r) =>
      r.arrival_date === boardDate ||
      (isBoardDateToday(boardDate) && isBoardDateToday(r.arrival_date)),
  )
  if (filtered.length) return filtered
  // Never mix older lots into a "today" board
  if (isBoardDateToday(boardDate)) return filtered
  const fallbackDay = pickLiveBoardDate(records)
  if (!fallbackDay) return records
  return records.filter(
    (r) =>
      r.arrival_date === fallbackDay ||
      (isBoardDateToday(fallbackDay) && isBoardDateToday(r.arrival_date)),
  )
}

/**
 * For a place/variety group:
 * 1) Always force today's rates when that grade has today's arrivals
 * 2) Else show newest older day and mark as not today
 */
export function selectRateRowsForGrade<T extends { arrival_date: string }>(
  rows: T[],
  preferredBoardDate?: string | null,
): { rows: T[]; rateDate: string | null; isStale: boolean } {
  if (!rows.length) return { rows: [], rateDate: null, isStale: false }

  const tryDate = (dateStr: string | null | undefined) => {
    if (!dateStr) return null
    const matched = rows.filter(
      (r) =>
        r.arrival_date === dateStr ||
        (isBoardDateToday(dateStr) && isBoardDateToday(r.arrival_date)),
    )
    return matched.length ? matched : null
  }

  // Force today first whenever today's posts exist for this grade
  const today = formatBoardDate()
  const onToday = tryDate(today)
  if (onToday) return { rows: onToday, rateDate: today, isStale: false }

  // Prefer the live board day only when it is not today (today already failed)
  if (preferredBoardDate && !isBoardDateToday(preferredBoardDate)) {
    const onPreferred = tryDate(preferredBoardDate)
    if (onPreferred) {
      return { rows: onPreferred, rateDate: preferredBoardDate, isStale: true }
    }
  }

  const newest = pickLiveBoardDate(rows)
  if (!newest) return { rows, rateDate: null, isStale: false }
  if (isBoardDateToday(newest)) {
    const forced = tryDate(newest) || rows
    return { rows: forced, rateDate: today, isStale: false }
  }
  const fallback = tryDate(newest) || rows
  return {
    rows: fallback,
    rateDate: newest,
    isStale: true,
  }
}

/**
 * Place board date from grade lots only (Sarakku/Bede/…), not unrelated “other” lots.
 * Forces today when any grade lot is today; else newest grade arrival day.
 */
export function pickPlaceGradeBoardDate<T extends { arrival_date: string }>(
  gradeRows: T[],
  allNearbyRows?: T[],
): string | null {
  const pool = gradeRows.length ? gradeRows : allNearbyRows || []
  if (!pool.length) return null
  const today = formatBoardDate()
  if (pool.some((r) => isBoardDateToday(r.arrival_date))) return today
  return pickLiveBoardDate(pool)
}

/** Unique arrival dates newest-first for exact UI labels. */
export function uniqueArrivalDates(rows: { arrival_date: string }[]): string[] {
  const seen = new Set<string>()
  const dates: string[] = []
  for (const r of rows) {
    if (!r.arrival_date || seen.has(r.arrival_date)) continue
    seen.add(r.arrival_date)
    dates.push(r.arrival_date)
  }
  return dates.sort((a, b) => arrivalSortKey(b) - arrivalSortKey(a))
}

function normalizeDistrictName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/** Match official lots for one district (handles Shimoga/Shivamogga spelling). */
export function filterDistrictRecords(records: PriceRecord[], district: string): PriceRecord[] {
  const needle = normalizeDistrictName(district)
  return records.filter((record) => {
    const value = normalizeDistrictName(record.district)
    if (value.includes(needle) || needle.includes(value)) return true
    return (
      district === 'Shivamogga' && (value.includes('shimoga') || Boolean(record.is_shivamogga))
    )
  })
}

export function districtModalAverage(
  records: PriceRecord[],
  district: string,
): number | null {
  const modals = filterDistrictRecords(records, district)
    .map((record) => record.modal_price)
    .filter((price) => price > 0)
  if (!modals.length) return null
  return Math.round((modals.reduce((sum, price) => sum + price, 0) / modals.length) * 100) / 100
}

export function TrendDelta({
  change,
  changePct,
}: {
  change: number | null
  changePct: number | null
}) {
  if (change == null || changePct == null) {
    return (
      <span className="delta flat">
        <Minus size={14} /> —
      </span>
    )
  }
  if (Math.abs(change) < 0.5) {
    return (
      <span className="delta flat">
        <Minus size={14} /> 0%
      </span>
    )
  }
  const up = change > 0
  return (
    <span className={`delta ${up ? 'up' : 'down'}`}>
      {up ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
      {up ? '+' : ''}
      {changePct.toFixed(1)}%
    </span>
  )
}
