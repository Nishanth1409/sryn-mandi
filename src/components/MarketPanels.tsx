import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { PrefsControls } from './PrefsControls'
import { usePrefs } from '../i18n/PrefsContext'
import type { HistoryPoint, PriceRecord, SummaryStats, TopMarket } from '../types'
import {
  arrivalSortKey,
  formatCompact,
  formatINR,
  isBoardDateToday,
  resolveBoardDate,
  TrendDelta,
} from './shared'
import { useMemo, useState } from 'react'
import {
  ARECA_MANDIS,
  VARIETY_BUCKETS,
  matchesVarietyBucket,
  type MandiPoint,
  type VarietyBucketKey,
} from '../geo/mandis'
import type { DevicePlace } from '../hooks/useDevicePlace'
import { filterPlaceRecords } from './LocalPlacePanel'
import { AvailableDateCalendar } from './AvailableDateCalendar'

export type FiltersState = {
  query: string
  state: string
  district: string
  variety: string
  focus: 'all' | 'shivamogga' | 'karnataka'
}

function toIsoDate(official: string): string | null {
  const match = /^(\d{2})-(\d{2})-(\d{4})$/.exec(official)
  if (!match) return null
  return `${match[3]}-${match[2]}-${match[1]}`
}

type ChartPoint = HistoryPoint & { label: string; full: string }

type HistoryScope =
  | { kind: 'mandi'; mandi: MandiPoint; label: string }
  | { kind: 'district'; district: string; label: string }

function normalizeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function filterDistrictRecords(records: PriceRecord[], district: string): PriceRecord[] {
  const needle = normalizeName(district)
  return records.filter((record) => {
    const value = normalizeName(record.district)
    if (value.includes(needle) || needle.includes(value)) return true
    return (
      district === 'Shivamogga' && (value.includes('shimoga') || Boolean(record.is_shivamogga))
    )
  })
}

function scopeRecords(records: PriceRecord[], scope: HistoryScope | null): PriceRecord[] {
  if (!scope) return []
  return scope.kind === 'mandi'
    ? filterPlaceRecords(records, scope.mandi)
    : filterDistrictRecords(records, scope.district)
}

/**
 * One point per day: the average of that day's modal prices, plus the real
 * lowest/highest prices officially posted on the same day.
 */
function buildHistory(records: PriceRecord[]): HistoryPoint[] {
  const buckets = new Map<string, { modal: number[]; lows: number[]; highs: number[] }>()
  for (const record of records) {
    if (!record.modal_price || !record.arrival_date) continue
    const iso = toIsoDate(record.arrival_date)
    if (!iso) continue
    const entry = buckets.get(iso) || { modal: [], lows: [], highs: [] }
    entry.modal.push(record.modal_price)
    if (record.min_price > 0) entry.lows.push(record.min_price)
    if (record.max_price > 0) entry.highs.push(record.max_price)
    buckets.set(iso, entry)
  }
  return [...buckets.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, values]) => ({
      date,
      avg:
        Math.round(
          (values.modal.reduce((sum, value) => sum + value, 0) / values.modal.length) * 100,
        ) / 100,
      min: Math.min(...(values.lows.length ? values.lows : values.modal)),
      max: Math.max(...(values.highs.length ? values.highs : values.modal)),
      count: values.modal.length,
    }))
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
  const { t, theme } = usePrefs()

  return (
    <header className="hero shell">
      <div className="topbar rise">
        <div className="brand-lockup">
          <img
            className="brand-logo"
            src={theme === 'light' ? '/logo-light.png?v=1' : '/logo-dark.png?v=1'}
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
  boardDate,
}: {
  summary: SummaryStats
  boardDate?: string | null
}) {
  const { t } = usePrefs()
  const liveDate = boardDate || summary.latest_date
  const todayBoard = isBoardDateToday(liveDate)
  const dateHint = liveDate
    ? todayBoard
      ? t('asOf', { date: liveDate })
      : t('ratesAsOf', { date: liveDate })
    : t('noOfficialRates')

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
  unitNote,
  lotsLabel,
}: {
  active?: boolean
  payload?: { value: number; name: string; color?: string; payload?: ChartPoint }[]
  label?: string
  unitNote?: string
  lotsLabel?: (n: number) => string
}) {
  if (!active || !payload?.length) return null
  const point = payload[0]?.payload
  return (
    <div className="chart-tip">
      <div className="chart-tip__date">{point?.full || label}</div>
      {payload.map((p) => (
        <div className="chart-tip__row" key={p.name}>
          <i style={{ background: p.color }} />
          <span>{p.name}</span>
          <strong>{formatINR(p.value)}</strong>
        </div>
      ))}
      <div className="chart-tip__foot">
        {point?.count && lotsLabel ? `${lotsLabel(point.count)} · ` : ''}
        {unitNote}
      </div>
    </div>
  )
}

export function TrendsPanel({
  allRecords,
  boardRecords,
  activePlace,
  boardDate,
}: {
  allRecords: PriceRecord[]
  boardRecords: PriceRecord[]
  activePlace: DevicePlace | null
  boardDate?: string | null
}) {
  const { t, locale } = usePrefs()
  const localeTag = locale === 'kn' ? 'kn-IN' : locale === 'hi' ? 'hi-IN' : 'en-IN'

  const [locationMode, setLocationMode] = useState<'follow' | 'manual'>('follow')
  const [historyDistrict, setHistoryDistrict] = useState('')
  const [historyMandiId, setHistoryMandiId] = useState('')

  const districts = useMemo(
    () => Array.from(new Set(ARECA_MANDIS.map((mandi) => mandi.district))).sort(),
    [],
  )
  const historyMarkets = useMemo(
    () =>
      ARECA_MANDIS.filter((mandi) => !historyDistrict || mandi.district === historyDistrict).sort(
        (a, b) => a.market.localeCompare(b.market),
      ),
    [historyDistrict],
  )

  const scope = useMemo<HistoryScope | null>(() => {
    if (locationMode === 'follow') {
      if (!activePlace) return null
      return {
        kind: 'mandi',
        mandi: activePlace.mandi,
        label: `${activePlace.mandi.market}, ${activePlace.mandi.district}`,
      }
    }
    const mandi = ARECA_MANDIS.find((item) => item.id === historyMandiId)
    if (mandi) {
      return { kind: 'mandi', mandi, label: `${mandi.market}, ${mandi.district}` }
    }
    if (historyDistrict) {
      return {
        kind: 'district',
        district: historyDistrict,
        label: `${t('historyAllMarkets')} · ${historyDistrict}`,
      }
    }
    return null
  }, [activePlace, historyDistrict, historyMandiId, locationMode, t])

  const placeRecords = useMemo(() => scopeRecords(allRecords, scope), [allRecords, scope])

  const historyByVariety = useMemo(() => {
    const map: Record<string, HistoryPoint[]> = {}
    for (const bucket of VARIETY_BUCKETS) {
      const rows = placeRecords.filter((record) =>
        matchesVarietyBucket(record.variety, bucket.match),
      )
      map[bucket.key] = buildHistory(rows)
    }
    return map
  }, [placeRecords])

  const history = useMemo(() => buildHistory(placeRecords), [placeRecords])

  const boardPlaceRecords = useMemo(() => scopeRecords(boardRecords, scope), [boardRecords, scope])

  const topMarkets = useMemo<TopMarket[]>(() => {
    return [...boardPlaceRecords]
      .filter((record) => record.modal_price > 0)
      .sort((a, b) => b.modal_price - a.modal_price)
      .slice(0, 8)
      .map((record) => ({
        market: record.market,
        district: record.district,
        state: record.state,
        variety: record.variety,
        modal_price: record.modal_price,
        change_pct: record.change_pct,
        is_shivamogga: record.is_shivamogga,
        arrival_date: record.arrival_date,
      }))
  }, [boardPlaceRecords])

  const defaultVariety = useMemo((): VarietyBucketKey | 'all' => {
    for (const bucket of VARIETY_BUCKETS) {
      if ((historyByVariety[bucket.key] || []).length > 0) return bucket.key
    }
    return 'rashi'
  }, [historyByVariety])

  const [varietyKey, setVarietyKey] = useState<VarietyBucketKey | 'all' | null>(null)
  const activeVariety = varietyKey ?? defaultVariety

  const selectedBucket =
    activeVariety === 'all' ? null : VARIETY_BUCKETS.find((b) => b.key === activeVariety) || null

  const series = useMemo(() => {
    if (activeVariety === 'all') return history
    return historyByVariety[activeVariety] || []
  }, [activeVariety, history, historyByVariety])

  const [rangeDays, setRangeDays] = useState<number>(30)

  const visibleSeries = useMemo(() => {
    if (!series.length || rangeDays === 0) return series
    const last = new Date(series[series.length - 1].date.slice(0, 10))
    if (Number.isNaN(last.getTime())) return series
    const from = new Date(last)
    from.setDate(from.getDate() - (rangeDays - 1))
    const fromIso = from.toISOString().slice(0, 10)
    return series.filter((point) => point.date.slice(0, 10) >= fromIso)
  }, [rangeDays, series])

  const chartData = useMemo<ChartPoint[]>(
    () =>
      visibleSeries.map((point) => {
        const day = new Date(point.date.slice(0, 10))
        const valid = !Number.isNaN(day.getTime())
        return {
          ...point,
          label: valid
            ? new Intl.DateTimeFormat(localeTag, { day: 'numeric', month: 'short' }).format(day)
            : point.date,
          full: valid
            ? new Intl.DateTimeFormat(localeTag, {
                day: 'numeric',
                month: 'short',
                year: 'numeric',
              }).format(day)
            : point.date,
        }
      }),
    [localeTag, visibleSeries],
  )

  const selectedDayLabel = useMemo(() => {
    const iso = boardDate ? toIsoDate(boardDate) : null
    if (!iso) return null
    return chartData.find((point) => point.date.slice(0, 10) === iso)?.label ?? null
  }, [boardDate, chartData])

  const latestPoint = chartData[chartData.length - 1] ?? null
  const previousPoint = chartData[chartData.length - 2] ?? null
  const dayChange =
    latestPoint && previousPoint ? Math.round(latestPoint.avg - previousPoint.avg) : null
  const dayChangePct =
    dayChange != null && previousPoint && previousPoint.avg
      ? (dayChange / previousPoint.avg) * 100
      : null

  const leaders = useMemo(() => {
    if (activeVariety === 'all' || !selectedBucket) return topMarkets
    const fromTop = topMarkets.filter((m) =>
      matchesVarietyBucket(m.variety, selectedBucket.match),
    )
    if (fromTop.length) return fromTop.slice(0, 8)

    const varietyRows = placeRecords.filter(
      (record) =>
        matchesVarietyBucket(record.variety, selectedBucket.match) && record.modal_price > 0,
    )
    if (!varietyRows.length) return []
    // Nothing for this grade on the chosen date — fall back to its own latest
    // official day, and every row still carries the date it came from.
    const latestDay = varietyRows.reduce(
      (best, row) =>
        arrivalSortKey(row.arrival_date) > arrivalSortKey(best) ? row.arrival_date : best,
      varietyRows[0].arrival_date,
    )
    return varietyRows
      .filter((row) => row.arrival_date === latestDay)
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
  }, [activeVariety, selectedBucket, topMarkets, placeRecords])

  const varietyLabel = selectedBucket
    ? `${selectedBucket.title} (${selectedBucket.kannada})`
    : t('chartAllGrades')

  return (
    <section className="shell glass" id="trends">
      <div className="section-head">
        <div>
          <h2>{t('pulseLeaders')}</h2>
          <p>
            {scope
              ? t('pulseLeadersPlaceBody', { place: scope.label })
              : t('pulseLeadersNeedPlace')}
          </p>
        </div>
      </div>

      <div className="picker-block">
        <label className="picker-label">{t('historyLocation')}</label>
        <div className="place-mode-row">
          <button
            type="button"
            className={`chip ${locationMode === 'follow' ? 'on' : ''}`}
            onClick={() => setLocationMode('follow')}
            disabled={!activePlace}
          >
            {t('historyFollowPlace')}
          </button>
          <button
            type="button"
            className={`chip ${locationMode === 'manual' ? 'on' : ''}`}
            onClick={() => {
              if (!historyDistrict && activePlace) {
                setHistoryDistrict(activePlace.mandi.district)
                setHistoryMandiId(activePlace.mandi.id)
              }
              setLocationMode('manual')
            }}
          >
            {t('historyPickLocation')}
          </button>
        </div>

        {locationMode === 'manual' ? (
          <div className="filters filters--compact">
            <div className="field">
              <label htmlFor="hd">{t('chooseDistrict')}</label>
              <select
                id="hd"
                value={historyDistrict}
                onChange={(event) => {
                  setHistoryDistrict(event.target.value)
                  setHistoryMandiId('')
                }}
              >
                <option value="">{t('chooseDistrict')}</option>
                {districts.map((district) => (
                  <option key={district}>{district}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="hm">{t('chooseMarket')}</label>
              <select
                id="hm"
                value={historyMandiId}
                disabled={!historyDistrict}
                onChange={(event) => setHistoryMandiId(event.target.value)}
              >
                <option value="">{t('historyAllMarkets')}</option>
                {historyMarkets.map((mandi) => (
                  <option key={mandi.id} value={mandi.id}>
                    {mandi.market}
                  </option>
                ))}
              </select>
            </div>
          </div>
        ) : null}
      </div>

      {!scope ? (
        <div className="empty">
          {locationMode === 'manual' ? t('historyNeedLocation') : t('pulseLeadersNeedPlace')}
        </div>
      ) : (
        <>
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
                const n = (historyByVariety[b.key] || []).length
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
                    {n > 0 ? <em>{t('daysCount', { n })}</em> : null}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="picker-block">
            <label className="picker-label">{t('chartRange')}</label>
            <div className="place-mode-row">
              {(
                [
                  [30, 'range1m'],
                  [90, 'range3m'],
                  [0, 'rangeAll'],
                ] as const
              ).map(([days, labelKey]) => (
                <button
                  key={labelKey}
                  type="button"
                  className={`chip ${rangeDays === days ? 'on' : ''}`}
                  onClick={() => setRangeDays(days)}
                >
                  {t(labelKey)}
                </button>
              ))}
            </div>
          </div>

          <div className="trend-grid">
            <div>
              <div className="trend-chart-caption">
                <strong>{varietyLabel}</strong>
                {latestPoint ? (
                  <span className="trend-chart-caption__latest">
                    <label>{t('chartLatestLabel')}</label>
                    <b>{formatINR(latestPoint.avg)}</b>
                    <span>{latestPoint.full}</span>
                    <TrendDelta change={dayChange} changePct={dayChangePct} />
                  </span>
                ) : (
                  <span>{t('noVarietyHistory')}</span>
                )}
              </div>
              <p className="trend-chart-help">{t('chartHelp')}</p>
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
                        minTickGap={24}
                      />
                      <YAxis
                        tickFormatter={(v) => formatCompact(v)}
                        tick={{ fontSize: 11, fill: 'var(--chart-tick)' }}
                        axisLine={false}
                        tickLine={false}
                        width={58}
                      />
                      <Tooltip
                        content={
                          <ChartTip
                            unitNote={t('chartUnitNote')}
                            lotsLabel={(n) => t(n === 1 ? 'chartLotOnDay' : 'chartLotsOnDay', { n })}
                          />
                        }
                      />
                      {selectedDayLabel ? (
                        <ReferenceLine
                          x={selectedDayLabel}
                          stroke="var(--nut)"
                          strokeDasharray="2 4"
                          label={{
                            value: t('chartSelectedDay'),
                            position: 'insideTopRight',
                            fill: 'var(--nut-soft)',
                            fontSize: 11,
                          }}
                        />
                      ) : null}
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
              {chartData.length ? (
                <>
                  <ul className="chart-legend">
                    <li>
                      <i className="chart-legend__line chart-legend__line--avg" />
                      {t('chartAvg')}
                    </li>
                    <li>
                      <i className="chart-legend__line chart-legend__line--max" />
                      {t('chartMax')}
                    </li>
                    <li>
                      <i className="chart-legend__line chart-legend__line--min" />
                      {t('chartMin')}
                    </li>
                  </ul>
                  <p className="chart-foot">
                    {t('chartUnitNote')} · {t('chartDaysShown', { n: chartData.length })}
                  </p>
                </>
              ) : null}
            </div>
            <div>
              <h3 className="trend-side-title">
                {selectedBucket
                  ? t('topForVariety', { variety: selectedBucket.title })
                  : t('topAllMarkets')}
              </h3>
              <ol className="top-list">
                {leaders.length === 0 ? (
                  <li className="empty-inline">{t('noRatesOnDate')}</li>
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
        </>
      )}
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
  availableDates,
  onSelectDate,
}: {
  records: PriceRecord[]
  filters: FiltersState
  onChange: (next: FiltersState) => void
  onRefresh: () => void
  loading?: boolean
  updatedAt: string
  boardDate?: string | null
  availableDates?: string[]
  onSelectDate?: (date: string) => void
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

      {availableDates?.length && onSelectDate ? (
        <AvailableDateCalendar
          compact
          label={t('mandiRateDate')}
          availableDates={availableDates}
          selectedDate={boardDate || tradingDate || null}
          onSelect={onSelectDate}
        />
      ) : null}

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
