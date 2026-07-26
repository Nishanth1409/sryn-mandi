import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { fetchAgentQuotes, submitAgentQuote } from '../api'
import {
  buildAgentRateRows,
  summarizeAgentPremium,
  type VarietyAverage,
} from '../geo/agentRates'
import {
  VARIETY_BUCKETS,
  matchesVarietyBucket,
  type MandiPoint,
  type VarietyBucketKey,
} from '../geo/mandis'
import { usePrefs } from '../i18n/PrefsContext'
import type { DevicePlace, GeoStatus } from '../hooks/useDevicePlace'
import type { PriceRecord } from '../types'
import { formatINR, TrendDelta } from './shared'

function avg(nums: number[]): number | null {
  if (!nums.length) return null
  return Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 100) / 100
}

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '')
}

export function filterPlaceRecords(records: PriceRecord[], mandi: MandiPoint): {
  marketRows: PriceRecord[]
  districtRows: PriceRecord[]
  scope: 'market' | 'district'
} {
  const aliases = [mandi.market, ...mandi.aliases].map(norm)
  const districtNeedle = norm(mandi.district)

  const isSameDistrict = (r: PriceRecord) => {
    const d = norm(r.district)
    if (d.includes(districtNeedle) || districtNeedle.includes(d)) return true
    if (mandi.district === 'Shivamogga') {
      return d.includes('shimoga') || d.includes('shivamogga') || r.is_shivamogga
    }
    return false
  }

  const districtRows = records.filter(isSameDistrict)

  const marketRows = districtRows.filter((r) => {
    const m = norm(r.market)
    return aliases.some(
      (a) =>
        m.includes(a) ||
        a.includes(m) ||
        (a.length >= 5 && m.includes(a.slice(0, 5))) ||
        (m.length >= 5 && a.includes(m.slice(0, 5))),
    )
  })

  if (marketRows.length >= 2) {
    return { marketRows, districtRows, scope: 'market' }
  }
  return {
    marketRows: districtRows.length ? districtRows : marketRows,
    districtRows,
    scope: districtRows.length ? 'district' : 'market',
  }
}

function bucketRows(rows: PriceRecord[], key: VarietyBucketKey): PriceRecord[] {
  const bucket = VARIETY_BUCKETS.find((b) => b.key === key)!
  return rows
    .filter((r) => matchesVarietyBucket(r.variety, bucket.match))
    .sort((a, b) => b.modal_price - a.modal_price)
}

function VarietyTable({
  title,
  kannada,
  rows,
}: {
  title: string
  kannada: string
  rows: PriceRecord[]
}) {
  const { t } = usePrefs()
  const modalAvg = avg(rows.map((r) => r.modal_price).filter((n) => n > 0))

  return (
    <article className="variety-card glass">
      <header className="variety-card__head">
        <div>
          <h3>
            {title} <span>{kannada}</span>
          </h3>
          <p>
            {rows.length
              ? t(rows.length > 1 ? 'avgModalLotsPlural' : 'avgModalLots', {
                  price: formatINR(modalAvg ?? 0),
                  n: rows.length,
                })
              : t('noArrivalsNearby')}
          </p>
        </div>
      </header>

      {rows.length === 0 ? (
        <div className="empty">{t('waitingApmc')}</div>
      ) : (
        <>
          <div className="variety-lots">
            {rows.map((r) => (
              <article className="lot-card" key={r.id}>
                <div className="lot-card__top">
                  <div className="market">
                    <strong>{r.market}</strong>
                    <small>
                      {r.district}
                      {r.grade ? ` · ${r.grade}` : ''}
                    </small>
                  </div>
                  <TrendDelta change={r.change} changePct={r.change_pct} />
                </div>
                <div className="lot-card__prices">
                  <div>
                    <label>{t('min')}</label>
                    <strong className="num">{formatINR(r.min_price)}</strong>
                  </div>
                  <div>
                    <label>{t('modal')}</label>
                    <strong className="num lot-modal">{formatINR(r.modal_price)}</strong>
                  </div>
                  <div>
                    <label>{t('max')}</label>
                    <strong className="num">{formatINR(r.max_price)}</strong>
                  </div>
                </div>
                <div className="lot-card__date">{r.arrival_date}</div>
              </article>
            ))}
          </div>

          <div className="table-wrap variety-table variety-table--desktop">
            <table className="rates">
              <thead>
                <tr>
                  <th>{t('market')}</th>
                  <th>{t('grade')}</th>
                  <th>{t('min')}</th>
                  <th>{t('modal')}</th>
                  <th>{t('max')}</th>
                  <th>{t('trend')}</th>
                  <th>{t('date')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <div className="market">
                        <strong>{r.market}</strong>
                        <small>{r.district}</small>
                      </div>
                    </td>
                    <td>{r.grade || '—'}</td>
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
          </div>
        </>
      )}
    </article>
  )
}

function AgentRatesBoard({
  placeRows,
  place,
}: {
  placeRows: PriceRecord[]
  place: DevicePlace
}) {
  const { t } = usePrefs()
  const [averages, setAverages] = useState<Record<string, VarietyAverage>>({})
  const [sourceNote, setSourceNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [formOk, setFormOk] = useState<string | null>(null)
  const [variety, setVariety] = useState<VarietyBucketKey>('rashi')
  const [rate, setRate] = useState('')

  const reloadQuotes = useCallback(async () => {
    try {
      const data = await fetchAgentQuotes({ district: place.mandi.district, days: 30 })
      setAverages(data.averages_by_variety || {})
      setSourceNote(data.note)
    } catch {
      setAverages({})
    }
  }, [place.mandi.district])

  useEffect(() => {
    void reloadQuotes()
  }, [reloadQuotes])

  const rows = useMemo(() => buildAgentRateRows(placeRows, averages), [placeRows, averages])
  const summary = useMemo(() => summarizeAgentPremium(rows), [rows])
  const hasData = rows.some((r) => r.agentRate != null && r.agentRate > 0)

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setFormError(null)
    setFormOk(null)
    const n = Number(rate.replace(/,/g, ''))
    if (!Number.isFinite(n) || n < 1000) {
      setFormError(t('enterCorrectAmount'))
      return
    }
    setSaving(true)
    try {
      await submitAgentQuote({
        variety_key: variety,
        rate: n,
        district: place.mandi.district,
        market: place.mandi.market,
        note: 'User-submitted local purchase rate',
        lat: place.lat,
        lng: place.lng,
      })
      setFormOk(
        t('formOk', {
          variety,
          district: place.mandi.district,
        }),
      )
      setRate('')
      await reloadQuotes()
    } catch (err) {
      setFormError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="glass agent-board" id="agent-rates">
      <div className="section-head">
        <div>
          <h2>{t('agentTitle')}</h2>
          <p>{t('agentBody', { district: place.mandi.district })}</p>
        </div>
      </div>

      <div className="agent-sources">
        <strong>{t('agentHowTitle')}</strong>
        <ul>
          <li>{t('agentHow1')}</li>
          <li>{t('agentHow2')}</li>
          <li>{t('agentHow3')}</li>
        </ul>
        {sourceNote ? (
          <p className="agent-note" style={{ padding: 0 }}>
            {sourceNote}
          </p>
        ) : null}
      </div>

      <form className="agent-form" onSubmit={onSubmit}>
        <div className="field">
          <label htmlFor="av">{t('variety')}</label>
          <select
            id="av"
            value={variety}
            onChange={(e) => setVariety(e.target.value as VarietyBucketKey)}
          >
            {VARIETY_BUCKETS.map((b) => (
              <option key={b.key} value={b.key}>
                {b.title} ({b.kannada})
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="ar">{t('updatePurchase')}</label>
          <input
            id="ar"
            inputMode="numeric"
            value={rate}
            onChange={(e) => setRate(e.target.value)}
            placeholder={t('enterAmount')}
            required
          />
        </div>
        <div className="field">
          <label>&nbsp;</label>
          <button className="btn btn-gold" type="submit" disabled={saving}>
            {saving ? t('updating') : t('updateAmount')}
          </button>
        </div>
      </form>
      {formError ? <p className="form-msg err">{formError}</p> : null}
      {formOk ? <p className="form-msg ok">{formOk}</p> : null}

      {summary.avgAgent != null ? (
        <div className="agent-summary">
          <div>
            <label>{t('placeMandiAvg')}</label>
            <strong>{summary.avgMandi != null ? formatINR(summary.avgMandi) : '—'}</strong>
          </div>
          <div>
            <label>{t('localAgentAvg', { district: place.mandi.district })}</label>
            <strong className="agent-hi">{formatINR(summary.avgAgent)}</strong>
          </div>
          <div>
            <label>{t('vsMandi')}</label>
            <strong
              className={
                summary.avgPremium != null && summary.avgPremium >= 0 ? 'agent-hi' : undefined
              }
            >
              {summary.avgPremium == null
                ? '—'
                : `${summary.avgPremium >= 0 ? '+' : ''}${formatINR(summary.avgPremium)}`}
            </strong>
            <span style={{ fontSize: '0.75rem', color: 'var(--ink-dim)' }}>
              {t(summary.reportCount === 1 ? 'submissions' : 'submissionsPlural', {
                n: summary.reportCount,
              })}
            </span>
          </div>
        </div>
      ) : null}

      <div className="table-wrap">
        {!hasData ? (
          <div className="empty">
            {t('noAgentAmounts', { district: place.mandi.district })}
          </div>
        ) : (
          <table className="rates agent-table">
            <thead>
              <tr>
                <th>{t('variety')}</th>
                <th>{t('modal')}</th>
                <th>{t('localAgentAvgCol')}</th>
                <th>{t('range')}</th>
                <th>{t('reports')}</th>
                <th>{t('vsMandi')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.varietyKey}
                  className={r.agentSource === 'user_average' ? 'featured' : undefined}
                >
                  <td>
                    <div className="market">
                      <strong>
                        {r.title} <span className="tag">{r.kannada}</span>
                      </strong>
                      <small>
                        {place.mandi.district}
                        {r.latestDate ? ` · ${t('updated', { date: r.latestDate })}` : ''}
                      </small>
                    </div>
                  </td>
                  <td className="num">{r.mandiModal ? formatINR(r.mandiModal) : '—'}</td>
                  <td className="num agent-hi">
                    {r.agentRate != null ? formatINR(r.agentRate) : '—'}
                  </td>
                  <td className="num">
                    {r.agentMin != null && r.agentMax != null
                      ? `${formatINR(r.agentMin)} – ${formatINR(r.agentMax)}`
                      : '—'}
                  </td>
                  <td>{r.agentCount || '—'}</td>
                  <td className="num">
                    {r.premium != null ? (
                      <span className={`delta ${r.premium >= 0 ? 'up' : 'down'}`}>
                        {r.premium >= 0 ? '+' : ''}
                        {formatINR(r.premium)}
                        {r.premiumPct != null ? (
                          <small style={{ display: 'block', fontWeight: 500 }}>
                            {r.premium >= 0 ? '+' : ''}
                            {r.premiumPct}%
                          </small>
                        ) : null}
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <p className="agent-note">{t('agentNote')}</p>
    </div>
  )
}

export function LocalPlacePanel({
  records,
  place,
  status,
  message,
  onRetryLocate,
}: {
  records: PriceRecord[]
  place: DevicePlace | null
  status: GeoStatus
  message: string | null
  onRetryLocate: () => void
}) {
  const { t } = usePrefs()
  const resolved = useMemo(() => {
    if (!place) return null
    return filterPlaceRecords(records, place.mandi)
  }, [records, place])

  const placeAvg = useMemo(() => {
    if (!resolved) return null
    return avg(resolved.marketRows.map((r) => r.modal_price).filter((n) => n > 0))
  }, [resolved])

  const varietyGroups = useMemo(() => {
    if (!resolved) return []
    return VARIETY_BUCKETS.map((b) => ({
      ...b,
      rows: bucketRows(resolved.marketRows, b.key),
    }))
  }, [resolved])

  const varietyAvgs = useMemo(() => {
    return Object.fromEntries(
      varietyGroups.map((g) => [
        g.key,
        avg(g.rows.map((r) => r.modal_price).filter((n) => n > 0)),
      ]),
    ) as Record<VarietyBucketKey, number | null>
  }, [varietyGroups])

  return (
    <section className="shell" id="local">
      <div className="glass local-hero">
        <div className="section-head">
          <div>
            <h2>{t('yourPlaceRates')}</h2>
            <p>{t('yourPlaceBody')}</p>
          </div>
          <button className="btn btn-ghost" type="button" onClick={onRetryLocate}>
            {status === 'locating' ? t('locating') : t('useMyLocation')}
          </button>
        </div>

        {status === 'locating' || status === 'idle' ? (
          <div className="loading">{t('readingLocation')}</div>
        ) : null}

        {(status === 'denied' || status === 'error' || status === 'unsupported') && (
          <div className="error">
            <p>{message}</p>
            <button className="btn btn-gold" type="button" onClick={onRetryLocate}>
              {t('allowLocationRetry')}
            </button>
          </div>
        )}

        {status === 'ready' && place ? (
          <>
            <div className="local-meta">
              <div>
                <label>{t('detectedPlace')}</label>
                <strong>{place.mandi.district}</strong>
                <span>
                  {t('nearestApmc', {
                    market: place.mandi.market,
                    km: place.distanceKm,
                    m: place.accuracyM,
                  })}
                </span>
              </div>
              <div className="local-avg">
                <label>{t('placeAverageModal')}</label>
                <strong>{placeAvg != null ? formatINR(placeAvg) : '—'}</strong>
                <span>
                  {resolved?.scope === 'market'
                    ? t('acrossLotsAt', {
                        n: resolved.marketRows.length,
                        market: place.mandi.market,
                      })
                    : t('districtLots', {
                        n: resolved?.districtRows.length ?? 0,
                        district: place.mandi.district,
                      })}
                </span>
              </div>
            </div>

            <div className="local-variety-stats">
              {VARIETY_BUCKETS.map((b) => (
                <div key={b.key} className="local-variety-stat">
                  <label>
                    {b.title} <em>{b.kannada}</em>
                  </label>
                  <strong>
                    {varietyAvgs[b.key] != null ? formatINR(varietyAvgs[b.key]!) : '—'}
                  </strong>
                </div>
              ))}
            </div>
          </>
        ) : null}
      </div>

      {status === 'ready' && place && resolved ? (
        <>
          <AgentRatesBoard placeRows={resolved.marketRows} place={place} />
          <div className="variety-grid">
            {varietyGroups.map((g) => (
              <VarietyTable key={g.key} title={g.title} kannada={g.kannada} rows={g.rows} />
            ))}
          </div>
        </>
      ) : null}
    </section>
  )
}
