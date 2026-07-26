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
