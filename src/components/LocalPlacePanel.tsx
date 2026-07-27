import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { fetchAgentQuotes, submitAgentQuote } from '../api'
import {
  AGENT_MAX_OVER_MARKET,
  buildAgentRateRows,
  groupPlaceStats,
  summarizeAgentRange,
  type PlaceVarietyStat,
  type VarietyAverage,
} from '../geo/agentRates'
import {
  ARECA_MANDIS,
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

function placeLabel(mandi: MandiPoint): string {
  return `${mandi.market} · ${mandi.district}`
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
  records,
  place,
}: {
  records: PriceRecord[]
  place: DevicePlace
}) {
  const { t } = usePrefs()
  const [averages, setAverages] = useState<Record<string, VarietyAverage>>({})
  const [placeStats, setPlaceStats] = useState<PlaceVarietyStat[]>([])
  const [sourceNote, setSourceNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [formOk, setFormOk] = useState<string | null>(null)
  const [formDistrict, setFormDistrict] = useState(place.mandi.district)
  const [formMandiId, setFormMandiId] = useState(place.mandi.id)
  const [variety, setVariety] = useState<VarietyBucketKey>('rashi')
  const [minRate, setMinRate] = useState('')
  const [maxRate, setMaxRate] = useState('')

  const districts = useMemo(
    () => Array.from(new Set(ARECA_MANDIS.map((m) => m.district))).sort(),
    [],
  )
  const marketsForDistrict = useMemo(
    () =>
      ARECA_MANDIS.filter((m) => m.district === formDistrict).sort((a, b) =>
        a.market.localeCompare(b.market),
      ),
    [formDistrict],
  )
  const formMandi = useMemo(
    () => ARECA_MANDIS.find((m) => m.id === formMandiId) || place.mandi,
    [formMandiId, place.mandi],
  )

  useEffect(() => {
    setFormDistrict(place.mandi.district)
    setFormMandiId(place.mandi.id)
  }, [place.mandi.district, place.mandi.id])

  const formPlaceRows = useMemo(
    () => filterPlaceRecords(records, formMandi).marketRows,
    [records, formMandi],
  )

  const label = placeLabel(formMandi)

  const reloadQuotes = useCallback(async () => {
    try {
      const data = await fetchAgentQuotes({
        district: formMandi.district,
        market: formMandi.market,
        days: 30,
      })
      setAverages(data.averages_by_variety || {})
      setPlaceStats(data.stats_by_place || [])
      setSourceNote(data.note)
    } catch {
      setAverages({})
      setPlaceStats([])
    }
  }, [formMandi.district, formMandi.market])

  useEffect(() => {
    void reloadQuotes()
  }, [reloadQuotes])

  const rows = useMemo(
    () => buildAgentRateRows(formPlaceRows, averages),
    [formPlaceRows, averages],
  )
  const summary = useMemo(() => summarizeAgentRange(rows), [rows])
  const hasData = rows.some((r) => r.agentMin != null && r.agentMax != null)
  const placeGroups = useMemo(() => groupPlaceStats(placeStats), [placeStats])

  const selectedMandiModal = useMemo(() => {
    const row = rows.find((r) => r.varietyKey === variety)
    return row?.mandiModal && row.mandiModal > 0 ? row.mandiModal : null
  }, [rows, variety])

  const allowedMax =
    selectedMandiModal != null ? selectedMandiModal + AGENT_MAX_OVER_MARKET : null

  const parseAmount = (raw: string) => Number(raw.replace(/,/g, ''))

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setFormError(null)
    setFormOk(null)
    const minN = parseAmount(minRate)
    const maxN = parseAmount(maxRate)
    if (!Number.isFinite(minN) || minN < 1000 || !Number.isFinite(maxN) || maxN < 1000) {
      setFormError(t('enterCorrectAmount'))
      return
    }
    if (minN > maxN) {
      setFormError(t('minMustBeLeMax'))
      return
    }
    if (selectedMandiModal == null) {
      setFormError(t('agentNeedMarket'))
      return
    }
    if (minN < selectedMandiModal) {
      setFormError(t('agentBelowMarket', { rate: formatINR(selectedMandiModal) }))
      return
    }
    if (maxN > selectedMandiModal + AGENT_MAX_OVER_MARKET) {
      setFormError(
        t('agentAboveMarketCap', {
          max: formatINR(selectedMandiModal + AGENT_MAX_OVER_MARKET),
        }),
      )
      return
    }
    setSaving(true)
    try {
      await submitAgentQuote({
        variety_key: variety,
        rate_min: minN,
        rate_max: maxN,
        district: formMandi.district,
        market: formMandi.market,
        note: 'User-submitted local purchase range',
        lat: formMandi.lat,
        lng: formMandi.lng,
        market_modal: selectedMandiModal,
      })
      setFormOk(
        t('formOk', {
          variety,
          place: label,
        }),
      )
      setMinRate('')
      setMaxRate('')
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
          <p>{t('agentBody', { place: label })}</p>
        </div>
      </div>

      <div className="agent-sources">
        <strong>{t('agentHowTitle')}</strong>
        <ul>
          <li>{t('agentHow1')}</li>
          <li>{t('agentHow2')}</li>
          <li>{t('agentHow3')}</li>
          <li>{t('agentHow4')}</li>
        </ul>
        {sourceNote ? (
          <p className="agent-note" style={{ padding: 0 }}>
            {sourceNote}
          </p>
        ) : null}
      </div>

      <form className="agent-form agent-form--full" onSubmit={onSubmit}>
        <div className="field">
          <label htmlFor="af-district">{t('locationCol')}</label>
          <select
            id="af-district"
            value={formDistrict}
            onChange={(e) => {
              const next = e.target.value
              setFormDistrict(next)
              const first = ARECA_MANDIS.find((m) => m.district === next)
              setFormMandiId(first?.id || '')
            }}
            required
          >
            {districts.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="af-market">{t('chooseMarket')}</label>
          <select
            id="af-market"
            value={formMandiId}
            onChange={(e) => setFormMandiId(e.target.value)}
            required
          >
            {marketsForDistrict.map((m) => (
              <option key={m.id} value={m.id}>
                {m.market}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="af-variety">{t('variety')}</label>
          <select
            id="af-variety"
            value={variety}
            onChange={(e) => setVariety(e.target.value as VarietyBucketKey)}
            required
          >
            {VARIETY_BUCKETS.map((b) => (
              <option key={b.key} value={b.key}>
                {b.title} ({b.kannada})
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="af-min">{t('purchaseMinAmount')}</label>
          <input
            id="af-min"
            inputMode="numeric"
            value={minRate}
            onChange={(e) => setMinRate(e.target.value)}
            placeholder={t('enterMinAmount')}
            required
          />
        </div>
        <div className="field">
          <label htmlFor="af-max">{t('purchaseMaxAmount')}</label>
          <input
            id="af-max"
            inputMode="numeric"
            value={maxRate}
            onChange={(e) => setMaxRate(e.target.value)}
            placeholder={t('enterMaxAmount')}
            required
          />
          {selectedMandiModal != null && allowedMax != null ? (
            <small className="field-hint">
              {t('agentAllowedRange', {
                min: formatINR(selectedMandiModal),
                max: formatINR(allowedMax),
              })}
            </small>
          ) : (
            <small className="field-hint">{t('agentNeedMarket')}</small>
          )}
        </div>
        <div className="field field--action">
          <label>&nbsp;</label>
          <button className="btn btn-gold" type="submit" disabled={saving}>
            {saving ? t('updating') : t('updateAmount')}
          </button>
        </div>
      </form>
      {formError ? <p className="form-msg err">{formError}</p> : null}
      {formOk ? <p className="form-msg ok">{formOk}</p> : null}

      {summary.agentMin != null && summary.agentMax != null ? (
        <div className="agent-summary">
          <div>
            <label>{t('placeMandiAvg')}</label>
            <strong>
              {summary.mandiModal != null ? formatINR(summary.mandiModal) : '—'}
            </strong>
          </div>
          <div>
            <label>{t('localAgentMin')}</label>
            <strong className="agent-hi">{formatINR(summary.agentMin)}</strong>
          </div>
          <div>
            <label>{t('localAgentMax')}</label>
            <strong className="agent-hi">{formatINR(summary.agentMax)}</strong>
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
          <div className="empty">{t('noAgentAmounts', { place: label })}</div>
        ) : (
          <table className="rates agent-table">
            <thead>
              <tr>
                <th>{t('variety')}</th>
                <th>{t('modal')}</th>
                <th>{t('localAgentMin')}</th>
                <th>{t('localAgentMax')}</th>
                <th>{t('reports')}</th>
                <th>{t('vsMandi')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.varietyKey}
                  className={r.agentSource === 'user_minmax' ? 'featured' : undefined}
                >
                  <td>
                    <div className="market">
                      <strong>
                        {r.title} <span className="tag">{r.kannada}</span>
                      </strong>
                      <small>
                        {label}
                        {r.latestDate ? ` · ${t('updated', { date: r.latestDate })}` : ''}
                      </small>
                    </div>
                  </td>
                  <td className="num">{r.mandiModal ? formatINR(r.mandiModal) : '—'}</td>
                  <td className="num agent-hi">
                    {r.agentMin != null ? formatINR(r.agentMin) : '—'}
                  </td>
                  <td className="num agent-hi">
                    {r.agentMax != null ? formatINR(r.agentMax) : '—'}
                  </td>
                  <td>{r.agentCount || '—'}</td>
                  <td className="num">
                    {r.premiumMin != null && r.premiumMax != null ? (
                      <span className={`delta ${r.premiumMin >= 0 ? 'up' : 'down'}`}>
                        {r.premiumMin >= 0 ? '+' : ''}
                        {formatINR(r.premiumMin)}
                        {' – '}
                        {r.premiumMax >= 0 ? '+' : ''}
                        {formatINR(r.premiumMax)}
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

      {placeGroups.length > 0 ? (
        <div className="agent-place-groups">
          <h3>{t('amountsAtPlace')}</h3>
          {placeGroups.map((group) => (
            <article className="agent-place-card" key={`${group.district}|${group.market}`}>
              <header>
                <strong>{group.placeLabel}</strong>
                <small>{t('locationCol')}</small>
              </header>
              <ul>
                {group.rows.map((row) => {
                  const bucket = VARIETY_BUCKETS.find((b) => b.key === row.variety_key)
                  return (
                    <li key={`${row.place_label}|${row.variety_key}`}>
                      <div>
                        <strong>
                          {bucket?.title || row.variety_key}
                          {bucket ? ` (${bucket.kannada})` : ''}
                        </strong>
                        <span>
                          {t('range')}: {formatINR(row.min_rate)} – {formatINR(row.max_rate)} ·{' '}
                          {t(row.count === 1 ? 'submissions' : 'submissionsPlural', {
                            n: row.count,
                          })}
                        </span>
                      </div>
                      <div className="agent-amount-chips">
                        {(row.rates || []).map((amount, idx) => (
                          <span key={`${row.variety_key}-${amount}-${idx}`}>
                            {formatINR(amount)}
                          </span>
                        ))}
                      </div>
                    </li>
                  )
                })}
              </ul>
            </article>
          ))}
        </div>
      ) : null}

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
  const [placeMode, setPlaceMode] = useState<'gps' | 'manual'>('gps')
  const [manualDistrict, setManualDistrict] = useState('')
  const [manualMandiId, setManualMandiId] = useState('')

  const districts = useMemo(
    () => Array.from(new Set(ARECA_MANDIS.map((m) => m.district))).sort(),
    [],
  )

  const marketsForDistrict = useMemo(
    () =>
      ARECA_MANDIS.filter((m) => !manualDistrict || m.district === manualDistrict).sort((a, b) =>
        a.market.localeCompare(b.market),
      ),
    [manualDistrict],
  )

  const manualMandi = useMemo(
    () => ARECA_MANDIS.find((m) => m.id === manualMandiId) || null,
    [manualMandiId],
  )

  const activePlace: DevicePlace | null = useMemo(() => {
    if (placeMode === 'manual') {
      if (!manualMandi) return null
      return {
        lat: manualMandi.lat,
        lng: manualMandi.lng,
        accuracyM: 0,
        mandi: manualMandi,
        distanceKm: 0,
        label: placeLabel(manualMandi),
      }
    }
    return place
  }, [placeMode, manualMandi, place])

  const activeReady =
    placeMode === 'manual' ? Boolean(manualMandi) : status === 'ready' && Boolean(place)

  const resolved = useMemo(() => {
    if (!activePlace) return null
    return filterPlaceRecords(records, activePlace.mandi)
  }, [records, activePlace])

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

  useEffect(() => {
    if (placeMode === 'gps' && place && !manualDistrict) {
      setManualDistrict(place.mandi.district)
      setManualMandiId(place.mandi.id)
    }
  }, [placeMode, place, manualDistrict])

  return (
    <section className="shell" id="local">
      <div className="glass local-hero">
        <div className="section-head">
          <div>
            <h2>{t('yourPlaceRates')}</h2>
            <p>{t('yourPlaceBody')}</p>
          </div>
          <button
            className="btn btn-ghost"
            type="button"
            onClick={() => {
              setPlaceMode('gps')
              onRetryLocate()
            }}
          >
            {status === 'locating' ? t('locating') : t('useMyLocation')}
          </button>
        </div>

        <div className="place-mode-row">
          <button
            type="button"
            className={`chip ${placeMode === 'gps' ? 'on' : ''}`}
            onClick={() => setPlaceMode('gps')}
          >
            {t('placeModeGps')}
          </button>
          <button
            type="button"
            className={`chip ${placeMode === 'manual' ? 'on' : ''}`}
            onClick={() => setPlaceMode('manual')}
          >
            {t('placeModeManual')}
          </button>
        </div>

        {placeMode === 'manual' ? (
          <div className="place-manual-form">
            <p className="agent-note" style={{ padding: 0 }}>
              {t('manualPlaceHint')}
            </p>
            <div className="agent-form">
              <div className="field">
                <label htmlFor="pd">{t('chooseDistrict')}</label>
                <select
                  id="pd"
                  value={manualDistrict}
                  onChange={(e) => {
                    setManualDistrict(e.target.value)
                    setManualMandiId('')
                  }}
                >
                  <option value="">{t('chooseDistrict')}</option>
                  {districts.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="pm">{t('chooseMarket')}</label>
                <select
                  id="pm"
                  value={manualMandiId}
                  onChange={(e) => setManualMandiId(e.target.value)}
                  disabled={!manualDistrict}
                >
                  <option value="">{t('chooseMarket')}</option>
                  {marketsForDistrict.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.market}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        ) : null}

        {placeMode === 'gps' && (status === 'locating' || status === 'idle') ? (
          <div className="loading">{t('readingLocation')}</div>
        ) : null}

        {placeMode === 'gps' &&
        (status === 'denied' || status === 'error' || status === 'unsupported') ? (
          <div className="error">
            <p>{message}</p>
            <button className="btn btn-gold" type="button" onClick={onRetryLocate}>
              {t('allowLocationRetry')}
            </button>
            <button
              className="btn btn-ghost"
              type="button"
              style={{ marginLeft: '0.5rem' }}
              onClick={() => setPlaceMode('manual')}
            >
              {t('placeModeManual')}
            </button>
          </div>
        ) : null}

        {activeReady && activePlace ? (
          <>
            <div className="local-meta">
              <div>
                <label>
                  {placeMode === 'manual' ? t('selectedPlace') : t('detectedPlace')}
                </label>
                <strong>{activePlace.mandi.district}</strong>
                <span>
                  {placeMode === 'gps'
                    ? t('nearestApmc', {
                        market: activePlace.mandi.market,
                        km: activePlace.distanceKm,
                        m: activePlace.accuracyM,
                      })
                    : activePlace.mandi.market}
                </span>
              </div>
              <div className="local-avg">
                <label>{t('placeAverageModal')}</label>
                <strong>{placeAvg != null ? formatINR(placeAvg) : '—'}</strong>
                <span>
                  {resolved?.scope === 'market'
                    ? t('acrossLotsAt', {
                        n: resolved.marketRows.length,
                        market: activePlace.mandi.market,
                      })
                    : t('districtLots', {
                        n: resolved?.districtRows.length ?? 0,
                        district: activePlace.mandi.district,
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

      {activeReady && activePlace && resolved ? (
        <>
          <AgentRatesBoard records={records} place={activePlace} />
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
