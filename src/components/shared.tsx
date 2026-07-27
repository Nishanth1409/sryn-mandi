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
