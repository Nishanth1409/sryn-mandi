import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react'

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

/** Prefer today, else the newest arrival day present in the set. */
export function pickLiveBoardDate(records: { arrival_date: string }[]): string | null {
  if (!records.length) return null
  const today = formatBoardDate()
  if (records.some((r) => r.arrival_date === today || isBoardDateToday(r.arrival_date))) {
    return today
  }
  let best: string | null = null
  let bestKey = -1
  for (const r of records) {
    if (!r.arrival_date) continue
    const key = arrivalSortKey(r.arrival_date)
    if (key > bestKey) {
      bestKey = key
      best = r.arrival_date
    }
  }
  return best
}

export function filterToBoardDate<T extends { arrival_date: string }>(
  records: T[],
  boardDate: string | null | undefined,
): T[] {
  if (!boardDate) return records
  const filtered = records.filter(
    (r) => r.arrival_date === boardDate || (isBoardDateToday(boardDate) && isBoardDateToday(r.arrival_date)),
  )
  return filtered.length ? filtered : records
}

/**
 * For a place/variety group: prefer live board day, else newest older day.
 * Empty only when that grade has never been reported in the nearby set.
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

  const onPreferred = tryDate(preferredBoardDate)
  if (onPreferred) {
    const date = preferredBoardDate!
    return { rows: onPreferred, rateDate: date, isStale: !isBoardDateToday(date) }
  }

  const today = formatBoardDate()
  const onToday = tryDate(today)
  if (onToday) return { rows: onToday, rateDate: today, isStale: false }

  const newest = pickLiveBoardDate(rows)
  if (!newest) return { rows, rateDate: null, isStale: false }
  const fallback = tryDate(newest) || rows
  return {
    rows: fallback,
    rateDate: newest,
    isStale: !isBoardDateToday(newest),
  }
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
