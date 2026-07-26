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
import { formatCompact, formatINR, TrendDelta } from './shared'

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
}: {
  onExplore: () => void
  onRefresh: () => void
  loading?: boolean
  updatedLabel: string
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
            {t('live')} · {updatedLabel}
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
        <div className="hero-scene-space" aria-hidden="true" />
      </div>
    </header>
  )
}

export function StatsStrip({ summary }: { summary: SummaryStats }) {
  const { t } = usePrefs()
  const items = [
    {
      label: t('avgModal'),
      value: formatINR(summary.avg_modal),
      hint: summary.latest_date ? t('asOf', { date: summary.latest_date }) : t('perQuintal'),
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
  topMarkets,
}: {
  history: HistoryPoint[]
  topMarkets: TopMarket[]
}) {
  const { t } = usePrefs()
  const chartData = history.map((h) => ({ ...h, label: h.date.slice(5) }))

  return (
    <section className="shell glass" id="trends">
      <div className="section-head">
        <div>
          <h2>{t('pulseLeaders')}</h2>
          <p>{t('pulseLeadersBody')}</p>
        </div>
      </div>
      <div className="trend-grid">
        <div>
          <div className="chart-box">
            {chartData.length === 0 ? (
              <div className="empty">{t('waitingHistory')}</div>
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
                    animationDuration={1000}
                  />
                  <Area
                    type="monotone"
                    dataKey="max"
                    name={t('chartMax')}
                    stroke="#e8c56a"
                    strokeWidth={1.4}
                    strokeDasharray="4 4"
                    fill="transparent"
                    animationDuration={1200}
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
        <div>
          <ol className="top-list">
            {topMarkets.map((m, i) => (
              <li key={`${m.market}-${m.variety}-${i}`}>
                <span className="rank">{i + 1}</span>
                <div className="market">
                  <strong>
                    {m.market}
                    {m.is_shivamogga ? <span className="tag">{t('shivamogga')}</span> : null}
                  </strong>
                  <small>
                    {m.district} · {m.variety}
                  </small>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div className="num">{formatINR(m.modal_price)}</div>
                  <TrendDelta change={m.change_pct} changePct={m.change_pct} />
                </div>
              </li>
            ))}
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
}: {
  records: PriceRecord[]
  filters: FiltersState
  onChange: (next: FiltersState) => void
  onRefresh: () => void
  loading?: boolean
  updatedAt: string
}) {
  const { t, locale } = usePrefs()
  const states = Array.from(new Set(records.map((r) => r.state))).sort()
  const districts = Array.from(
    new Set(
      records
        .filter((r) => !filters.state || r.state === filters.state)
        .map((r) => r.district)
        .filter(Boolean),
    ),
  ).sort()
  const varieties = Array.from(new Set(records.map((r) => r.variety))).sort()

  const filtered = records.filter((r) => {
    if (filters.focus === 'shivamogga' && !r.is_shivamogga) return false
    if (filters.focus === 'karnataka' && r.state !== 'Karnataka') return false
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

  const dateLocale = locale === 'kn' ? 'kn-IN' : locale === 'hi' ? 'hi-IN' : 'en-IN'

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

      <div className="status">
        <span>{t('rows', { filtered: filtered.length, total: records.length })}</span>
        <span>{new Date(updatedAt).toLocaleString(dateLocale)}</span>
        <span>AGMARKNET · data.gov.in</span>
      </div>

      <div className="chips">
        {(
          [
            ['karnataka', 'focusKarnataka'],
            ['shivamogga', 'focusShivamogga'],
            ['all', 'focusAllIndia'],
          ] as const
        ).map(([key, labelKey]) => (
          <button
            key={key}
            type="button"
            className={`chip ${filters.focus === key ? 'on' : ''}`}
            onClick={() => onChange({ ...filters, focus: key })}
          >
            {t(labelKey)}
          </button>
        ))}
      </div>

      <div className="filters">
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
          <label htmlFor="state">{t('state')}</label>
          <select
            id="state"
            value={filters.state}
            onChange={(e) => onChange({ ...filters, state: e.target.value, district: '' })}
          >
            <option value="">{t('all')}</option>
            {states.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="district">{t('district')}</label>
          <select
            id="district"
            value={filters.district}
            onChange={(e) => onChange({ ...filters, district: e.target.value })}
          >
            <option value="">{t('all')}</option>
            {districts.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
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
              onChange({ query: '', state: '', district: '', variety: '', focus: 'karnataka' })
            }
          >
            {t('clear')}
          </button>
        </div>
      </div>

      <div className="rates-scroll">
        <p className="rates-scroll__hint">{t('scrollMore')}</p>
        <div className="table-wrap table-wrap--rates" tabIndex={0} role="region" aria-label={t('liveMandiBoard')}>
          {filtered.length === 0 ? (
            <div className="empty">{t('noMatches')}</div>
          ) : (
            <table className="rates rates--scroll">
              <thead>
                <tr>
                  <th className="sticky-col">{t('market')}</th>
                  <th>{t('variety')}</th>
                  <th>{t('min')}</th>
                  <th>{t('modal')}</th>
                  <th>{t('max')}</th>
                  <th>{t('trend')}</th>
                  <th>{t('date')}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.id} className={r.is_shivamogga ? 'featured' : undefined}>
                    <td className="sticky-col">
                      <div className="market">
                        <strong>
                          {r.market}
                          {r.is_shivamogga ? <span className="tag">{t('shivamogga')}</span> : null}
                        </strong>
                        <small>
                          {r.district}, {r.state}
                        </small>
                      </div>
                    </td>
                    <td>
                      <div className="market">
                        <strong>{r.variety}</strong>
                        <small>{r.grade || '—'}</small>
                      </div>
                    </td>
                    <td className="num">{formatINR(r.min_price)}</td>
                    <td className="num">{formatINR(r.modal_price)}</td>
                    <td className="num">{formatINR(r.max_price)}</td>
                    <td>
                      <TrendDelta change={r.change} changePct={r.change_pct} />
                    </td>
                    <td>{r.arrival_date}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </section>
  )
}
