import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { PrefsControls } from './PrefsControls'
import { usePrefs } from '../i18n/PrefsContext'
import type { HistoryPoint, PriceRecord, SummaryStats, TopMarket } from '../types'
import {
  formatCompact,
  formatINR,
  isBoardDateToday,
  resolveBoardDate,
  TrendDelta,
} from './shared'
import { useMemo, useState } from 'react'
import {
  VARIETY_BUCKETS,
  matchesVarietyBucket,
  type VarietyBucketKey,
} from '../geo/mandis'

export type FiltersState = {
  query: string
  state: string
  district: string
  variety: string
  focus: 'all' | 'shivamogga' | 'karnataka'
}

export function HeroOverlay({
  onExplore,
  onRefresh,
  loading,
  updatedLabel,
  livePrefix = true,
}: {
  onExplore: () => void
  onRefresh: () => void
  loading?: boolean
  updatedLabel: string
  livePrefix?: boolean
}) {
  const { t } = usePrefs()

  return (
    <header className="hero shell">
      <div className="topbar rise">
        <div className="brand-lockup">
          <img
            className="brand-logo"
            src="/SRYN.png?v=2"
            alt="Sryn Areca nut's"
            width={420}
            height={272}
          />
        </div>
        <div className="topbar-end">
          <PrefsControls />
          <div className="live">
            <i />
            {livePrefix ? (
              <>
                {t('live')} · {updatedLabel}
              </>
            ) : (
              updatedLabel
            )}
          </div>
        </div>
      </div>

      <div className="hero-stage">
        <div className="hero-copy">
          <p className="hero-kicker rise">{t('heroKicker')}</p>
          <h1 className="rise">
            {t('heroTitle1')}
            <br />
            {t('heroTitle2')}
          </h1>
          <p className="rise-2">{t('heroBody')}</p>
          <div className="cta-row rise-3">
            <button className="btn btn-gold" type="button" onClick={onExplore}>
              {t('myPlaceRates')}
            </button>
            <button className="btn btn-ghost" type="button" onClick={onRefresh} disabled={loading}>
              {loading ? t('syncing') : t('syncMarkets')}
            </button>
          </div>
        </div>
      </div>
    </header>
  )
}

export function StatsStrip({
  summary,
  updatedAt,
}: {
  summary: SummaryStats
  updatedAt?: string
}) {
  const { t } = usePrefs()
  const liveDate = useMemo(
    () => resolveBoardDate(summary.latest_date, updatedAt),
    [summary.latest_date, updatedAt],
  )
  const todayBoard = isBoardDateToday(liveDate)
  const dateHint = todayBoard
    ? t('asOf', { date: liveDate })
    : t('ratesAsOfStale', { date: liveDate })

  const items = [
    {
      label: t('avgModal'),
      value: formatINR(summary.avg_modal),
      hint: dateHint,
    },
    {
      label: t('shivamogga'),
      value: summary.shivamogga_avg ? formatINR(summary.shivamogga_avg) : '—',
      hint: t('districtAverage'),
    },
    {
      label: t('peak'),
      value: formatINR(summary.highest),
      hint: t('marketsCount', { n: summary.markets }),
    },
    {
      label: t('floor'),
      value: formatINR(summary.lowest),
      hint: t('varietiesCount', { n: summary.varieties }),
    },
  ]

  return (
    <div className="shell stats">
      {items.map((item) => (
        <article className="glass stat" key={item.label}>
          <label>{item.label}</label>
          <strong>{item.value}</strong>
          <span>{item.hint}</span>
        </article>
      ))}
    </div>
  )
}

function ChartTip({
  active,
  payload,
  label,
}: {
  active?: boolean
  payload?: { value: number; name: string }[]
  label?: string
}) {
  if (!active || !payload?.length) return null
  return (
    <div
      style={{
        background: 'var(--chart-tip-bg)',
        border: '1px solid var(--line)',
        color: 'var(--ink)',
        padding: '0.6rem 0.8rem',
        borderRadius: 12,
        fontSize: 13,
      }}
    >
      <div style={{ opacity: 0.7, marginBottom: 4 }}>{label}</div>
      {payload.map((p) => (
        <div key={p.name}>
          {p.name}: <strong>{formatINR(p.value)}</strong>
        </div>
      ))}
    </div>
  )
}

export function TrendsPanel({
  history,
  historyByVariety,
  topMarkets,
  records,
}: {
  history: HistoryPoint[]
  historyByVariety?: Record<string, HistoryPoint[]>
  topMarkets: TopMarket[]
  records?: PriceRecord[]
}) {
  const { t } = usePrefs()
  const byVariety = historyByVariety || {}

  const defaultVariety = useMemo((): VarietyBucketKey | 'all' => {
    for (const b of VARIETY_BUCKETS) {
      if ((byVariety[b.key] || []).length > 0) return b.key
    }
    return 'rashi'
  }, [byVariety])

  const [varietyKey, setVarietyKey] = useState<VarietyBucketKey | 'all' | null>(null)
  const activeVariety = varietyKey ?? defaultVariety

  const selectedBucket =
    activeVariety === 'all' ? null : VARIETY_BUCKETS.find((b) => b.key === activeVariety) || null

  const series = useMemo(() => {
    if (activeVariety === 'all') return history
    return byVariety[activeVariety] || []
  }, [activeVariety, history, byVariety])

  const chartData = series.map((h) => {
    const iso = h.date.slice(0, 10)
    const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/)
    const label = m ? `${m[3]}-${m[2]}` : h.date.slice(5)
    return { ...h, label }
  })

  const leaders = useMemo(() => {
    if (activeVariety === 'all' || !selectedBucket) return topMarkets
    const fromTop = topMarkets.filter((m) =>
      matchesVarietyBucket(m.variety, selectedBucket.match),
    )
    if (fromTop.length) return fromTop.slice(0, 8)
    if (!records?.length) return []
    return [...records]
      .filter((r) => matchesVarietyBucket(r.variety, selectedBucket.match) && r.modal_price > 0)
      .sort((a, b) => b.modal_price - a.modal_price)
      .slice(0, 8)
      .map((r) => ({
        market: r.market,
        district: r.district,
        state: r.state,
        variety: r.variety,
        modal_price: r.modal_price,
        change_pct: r.change_pct,
        is_shivamogga: r.is_shivamogga,
        arrival_date: r.arrival_date,
      }))
  }, [activeVariety, selectedBucket, topMarkets, records])

  const varietyLabel = selectedBucket
    ? `${selectedBucket.title} (${selectedBucket.kannada})`
    : t('chartAllGrades')

  return (
    <section className="shell glass" id="trends">
      <div className="section-head">
        <div>
          <h2>{t('pulseLeaders')}</h2>
          <p>{t('pulseLeadersBody')}</p>
        </div>
      </div>

      <div className="picker-block trend-variety-picker">
        <label className="picker-label">{t('pickChartVariety')}</label>
        <div className="chip-scroll" role="listbox" aria-label={t('pickChartVariety')}>
          <button
            type="button"
            className={`chip ${activeVariety === 'all' ? 'on' : ''}`}
            onClick={() => setVarietyKey('all')}
          >
            {t('chartAllGrades')}
          </button>
          {VARIETY_BUCKETS.map((b) => {
            const n = (byVariety[b.key] || []).length
            return (
              <button
                key={b.key}
                type="button"
                className={`chip ${activeVariety === b.key ? 'on' : ''}`}
                onClick={() => setVarietyKey(b.key)}
                disabled={n === 0}
              >
                {b.title}
                <em>{b.kannada}</em>
                {n > 0 ? <em>{n}d</em> : null}
              </button>
            )
          })}
        </div>
      </div>

      <div className="trend-grid">
        <div>
          <div className="trend-chart-caption">
            <strong>{varietyLabel}</strong>
            <span>
              {chartData.length
                ? `${formatINR(chartData[chartData.length - 1]?.avg ?? 0)} · ${chartData[chartData.length - 1]?.label || ''}`
                : t('noVarietyHistory')}
            </span>
          </div>
          <div className="chart-box">
            {chartData.length === 0 ? (
              <div className="empty">
                {activeVariety === 'all' ? t('waitingHistory') : t('noVarietyHistory')}
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gAvg" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#3da873" stopOpacity={0.45} />
                      <stop offset="100%" stopColor="#3da873" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 11, fill: 'var(--chart-tick)' }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tickFormatter={(v) => formatCompact(v)}
                    tick={{ fontSize: 11, fill: 'var(--chart-tick)' }}
                    axisLine={false}
                    tickLine={false}
                    width={52}
                  />
                  <Tooltip content={<ChartTip />} />
                  <Area
                    type="monotone"
                    dataKey="avg"
                    name={t('chartAvg')}
                    stroke="#3da873"
                    strokeWidth={2.4}
                    fill="url(#gAvg)"
                    animationDuration={700}
                  />
                  <Area
                    type="monotone"
                    dataKey="max"
                    name={t('chartMax')}
                    stroke="#e8c56a"
                    strokeWidth={1.4}
                    strokeDasharray="4 4"
                    fill="transparent"
                    animationDuration={900}
                  />
                  <Area
                    type="monotone"
                    dataKey="min"
                    name={t('chartMin')}
                    stroke="#8aa4b8"
                    strokeWidth={1.2}
                    strokeDasharray="3 3"
                    fill="transparent"
                    animationDuration={900}
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
        <div>
          <h3 className="trend-side-title">
            {selectedBucket
              ? t('topForVariety', { variety: selectedBucket.title })
              : t('topAllMarkets')}
          </h3>
          <ol className="top-list">
            {leaders.length === 0 ? (
              <li className="empty-inline">{t('noVarietyHistory')}</li>
            ) : (
              leaders.map((m, i) => (
                <li key={`${m.market}-${m.variety}-${i}`}>
                  <span className="rank">{i + 1}</span>
                  <div className="market">
                    <strong>
                      {m.market}
                      {m.is_shivamogga ? <span className="tag">{t('shivamogga')}</span> : null}
                    </strong>
                    <small>
                      {m.district} · {m.variety}
                      {m.arrival_date ? ` · ${m.arrival_date}` : ''}
                    </small>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div className="num">{formatINR(m.modal_price)}</div>
                    <TrendDelta change={m.change_pct} changePct={m.change_pct} />
                  </div>
                </li>
              ))
            )}
          </ol>
        </div>
      </div>
    </section>
  )
}

export function RatesPanel({
  records,
  filters,
  onChange,
  onRefresh,
  loading,
  updatedAt,
  boardDate,
}: {
  records: PriceRecord[]
  filters: FiltersState
  onChange: (next: FiltersState) => void
  onRefresh: () => void
  loading?: boolean
  updatedAt: string
  boardDate?: string | null
}) {
  const { t, locale } = usePrefs()

  const tradingDate = useMemo(() => {
    if (boardDate) return boardDate
    const fromRows = records.map((r) => r.arrival_date).filter(Boolean)
    if (!fromRows.length) return resolveBoardDate(null, updatedAt)
    const counts = new Map<string, number>()
    for (const d of fromRows) counts.set(d, (counts.get(d) || 0) + 1)
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0]
  }, [boardDate, records, updatedAt])

  const todayBoard = isBoardDateToday(tradingDate)

  const scoped = useMemo(() => {
    return records.filter((r) => {
      if (filters.focus === 'shivamogga' && !r.is_shivamogga) return false
      if (filters.focus === 'karnataka' && r.state !== 'Karnataka') return false
      return true
    })
  }, [records, filters.focus])

  const states = useMemo(() => {
    const counts = new Map<string, number>()
    for (const r of scoped) {
      if (!r.state) continue
      counts.set(r.state, (counts.get(r.state) || 0) + 1)
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([name, count]) => ({ name, count }))
  }, [scoped])

  const districts = useMemo(() => {
    const pool = scoped.filter((r) => !filters.state || r.state === filters.state)
    const counts = new Map<string, number>()
    for (const r of pool) {
      if (!r.district) continue
      counts.set(r.district, (counts.get(r.district) || 0) + 1)
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([name, count]) => ({ name, count }))
  }, [scoped, filters.state])

  const varieties = useMemo(
    () => Array.from(new Set(scoped.map((r) => r.variety).filter(Boolean))).sort(),
    [scoped],
  )

  const filtered = useMemo(() => {
    return scoped
      .filter((r) => {
        if (filters.state && r.state !== filters.state) return false
        if (filters.district && r.district !== filters.district) return false
        if (filters.variety && r.variety !== filters.variety) return false
        if (filters.query) {
          const q = filters.query.toLowerCase()
          const hay = `${r.market} ${r.district} ${r.state} ${r.variety}`.toLowerCase()
          if (!hay.includes(q)) return false
        }
        return true
      })
      .sort((a, b) => b.modal_price - a.modal_price)
  }, [scoped, filters])

  const dateLocale = locale === 'kn' ? 'kn-IN' : locale === 'hi' ? 'hi-IN' : 'en-IN'

  const setFocus = (focus: FiltersState['focus']) => {
    if (focus === 'shivamogga') {
      onChange({ ...filters, focus, state: 'Karnataka', district: 'Shivamogga', query: '' })
      return
    }
    if (focus === 'karnataka') {
      onChange({ ...filters, focus, state: 'Karnataka', district: '', query: '' })
      return
    }
    onChange({ ...filters, focus, state: '', district: '', query: '' })
  }

  return (
    <section className="shell glass" id="rates">
      <div className="section-head">
        <div>
          <h2>{t('liveMandiBoard')}</h2>
          <p>{t('liveMandiBody')}</p>
        </div>
        <button className="btn btn-gold" type="button" onClick={onRefresh} disabled={loading}>
          {loading ? t('updating') : t('refresh')}
        </button>
      </div>

      <div
        className={`board-date-banner ${todayBoard ? 'is-today' : 'is-stale'}`}
        role="status"
      >
        <strong>
          {todayBoard
            ? t('boardDateLive', { date: tradingDate })
            : t('boardDateLatest', { date: tradingDate })}
        </strong>
        {!todayBoard ? <span>{t('ratesAsOfStale', { date: tradingDate })}</span> : null}
      </div>

      <div className="status">
        <span>{t('compactLots', { n: filtered.length })}</span>
        <span>
          {filters.district || filters.state || t('focusArecaBelt')}
        </span>
        <span>
          {t('syncedAt', {
            time: new Date(updatedAt).toLocaleString(dateLocale),
          })}
        </span>
      </div>

      <div className="chips">
        {(
          [
            ['all', 'focusArecaBelt'],
            ['karnataka', 'focusKarnataka'],
            ['shivamogga', 'focusShivamogga'],
          ] as const
        ).map(([key, labelKey]) => (
          <button
            key={key}
            type="button"
            className={`chip ${filters.focus === key ? 'on' : ''}`}
            onClick={() => setFocus(key)}
          >
            {t(labelKey)}
          </button>
        ))}
      </div>

      {filters.focus === 'all' ? (
        <div className="picker-block">
          <label className="picker-label">{t('pickState')}</label>
          <div className="chip-scroll" role="listbox" aria-label={t('pickState')}>
            <button
              type="button"
              className={`chip ${!filters.state ? 'on' : ''}`}
              onClick={() => onChange({ ...filters, state: '', district: '' })}
            >
              {t('all')}
            </button>
            {states.map((s) => (
              <button
                key={s.name}
                type="button"
                className={`chip ${filters.state === s.name ? 'on' : ''}`}
                onClick={() =>
                  onChange({
                    ...filters,
                    state: s.name,
                    district: '',
                    focus: s.name === 'Karnataka' ? 'karnataka' : 'all',
                  })
                }
              >
                {s.name}
                <em>{s.count}</em>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="picker-block">
        <label className="picker-label">{t('pickDistrict')}</label>
        <div className="chip-scroll chip-scroll--district" role="listbox" aria-label={t('pickDistrict')}>
          <button
            type="button"
            className={`chip ${!filters.district ? 'on' : ''}`}
            onClick={() => onChange({ ...filters, district: '' })}
          >
            {t('allDistricts')}
          </button>
          {districts.map((d) => (
            <button
              key={d.name}
              type="button"
              className={`chip ${filters.district === d.name ? 'on' : ''}`}
              onClick={() =>
                onChange({
                  ...filters,
                  district: d.name,
                  focus:
                    d.name.toLowerCase().includes('shivamogga') ||
                    d.name.toLowerCase().includes('shimoga')
                      ? 'shivamogga'
                      : filters.focus === 'shivamogga'
                        ? 'karnataka'
                        : filters.focus,
                })
              }
            >
              {d.name}
              <em>{d.count}</em>
            </button>
          ))}
        </div>
      </div>

      <div className="filters filters--compact">
        <div className="field">
          <label htmlFor="q">{t('search')}</label>
          <input
            id="q"
            placeholder={t('searchPlaceholder')}
            value={filters.query}
            onChange={(e) => onChange({ ...filters, query: e.target.value })}
          />
        </div>
        <div className="field">
          <label htmlFor="variety">{t('variety')}</label>
          <select
            id="variety"
            value={filters.variety}
            onChange={(e) => onChange({ ...filters, variety: e.target.value })}
          >
            <option value="">{t('all')}</option>
            {varieties.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>&nbsp;</label>
          <button
            className="btn btn-ghost"
            type="button"
            onClick={() =>
              onChange({ query: '', state: '', district: '', variety: '', focus: 'all' })
            }
          >
            {t('clear')}
          </button>
        </div>
      </div>

      <div className="mandi-compact">
        {filtered.length === 0 ? (
          <div className="empty">{t('noMatches')}</div>
        ) : (
          filtered.map((r) => (
            <article key={r.id} className={`mandi-row ${r.is_shivamogga ? 'featured' : ''}`}>
              <div className="mandi-row__main">
                <div className="market">
                  <strong>{r.market}</strong>
                  <small>
                    {r.district}, {r.state}
                  </small>
                </div>
                <div className="mandi-row__modal">
                  <label>{t('modal')}</label>
                  <strong className="num">{formatINR(r.modal_price)}</strong>
                </div>
              </div>
              <div className="mandi-row__meta">
                <span className="mandi-pill">{r.variety}</span>
                {r.grade ? <span className="mandi-pill soft">{r.grade}</span> : null}
                <span className="mandi-range">
                  {formatINR(r.min_price)} – {formatINR(r.max_price)}
                </span>
                <TrendDelta change={r.change} changePct={r.change_pct} />
                <span className="mandi-date" title={t('rateDate')}>
                  {t('rateDate')}: {r.arrival_date}
                </span>
              </div>
            </article>
          ))
        )}
      </div>
    </section>
  )
}
