import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { fetchAgentQuotes, submitAgentQuote } from '../api'
import {
  AGENT_MAX_OVER_MARKET,
  buildAgentRateRows,
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
import {
  formatINR,
  TrendDelta,
  selectRateRowsForGrade,
  isBoardDateToday,
  pickPlaceGradeBoardDate,
  uniqueArrivalDates,
} from './shared'

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
  rateDate,
  isStale,
  agent,
}: {
  title: string
  kannada: string
  rows: PriceRecord[]
  rateDate: string | null
  isStale: boolean
  agent?: {
    min: number | null
    max: number | null
    count: number
    latestDate: string | null
  } | null
}) {
  const { t } = usePrefs()
  const modalAvg = avg(rows.map((r) => r.modal_price).filter((n) => n > 0))
  const hasAgent = agent != null && agent.min != null && agent.max != null

  const headNote = !rows.length
    ? t('noArrivalsNearby')
    : t(rows.length > 1 ? 'avgModalLotsPlural' : 'avgModalLots', {
        price: formatINR(modalAvg ?? 0),
        n: rows.length,
      })

  return (
    <article className={`variety-card glass ${isStale && rows.length ? 'is-stale' : ''}`}>
      <header className="variety-card__head">
        <div>
          <h3>
            {title} <span>{kannada}</span>
          </h3>
          <p>{headNote}</p>
          {isStale && rateDate && rows.length ? (
            <p className="variety-card__stale">{t('ratesAsOfStale', { date: rateDate })}</p>
          ) : rateDate && rows.length && !isStale ? (
            <p className="variety-card__stale is-live">{t('asOf', { date: rateDate })}</p>
          ) : null}
        </div>
      </header>

      <div className={`grade-agent ${hasAgent ? 'has-data' : 'no-data'}`}>
        <label>{t('localAgentRate')}</label>
        {hasAgent ? (
          <>
            <strong>
              {t('localAgentRange', {
                min: formatINR(agent!.min!),
                max: formatINR(agent!.max!),
              })}
            </strong>
            <span>
              {t(agent!.count === 1 ? 'submissions' : 'submissionsPlural', { n: agent!.count })}
              {agent!.latestDate ? ` · ${t('agentUploadedOn', { date: agent!.latestDate })}` : ''}
            </span>
          </>
        ) : (
          <p>{t('agentNotUpdated')}</p>
        )}
      </div>

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
                <div className={`lot-card__date ${isStale || !isBoardDateToday(r.arrival_date) ? 'is-stale' : ''}`}>
                  {t('rateDate')}: {r.arrival_date}
                  {!isBoardDateToday(r.arrival_date) ? ` · ${t('notTodaysRate')}` : ''}
                </div>
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
  onQuotesUpdated,
}: {
  records: PriceRecord[]
  place: DevicePlace
  onQuotesUpdated?: () => void
}) {
  const { t } = usePrefs()
  const [averages, setAverages] = useState<Record<string, VarietyAverage>>({})
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
      setSourceNote(data.note)
    } catch {
      setAverages({})
    }
  }, [formMandi.district, formMandi.market])

  useEffect(() => {
    void reloadQuotes()
  }, [reloadQuotes])

  const rows = useMemo(
    () => buildAgentRateRows(formPlaceRows, averages),
    [formPlaceRows, averages],
  )
  const hasData = rows.some((r) => r.agentMin != null && r.agentMax != null)

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
      onQuotesUpdated?.()
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

      <details className="agent-how">
        <summary>{t('agentHowTitle')}</summary>
        <ul>
          <li>{t('agentHow1')}</li>
          <li>{t('agentHow2')}</li>
          <li>{t('agentHow3')}</li>
          <li>{t('agentHow4')}</li>
        </ul>
        {sourceNote ? <p className="agent-note">{sourceNote}</p> : null}
      </details>

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
    </div>
  )
}

export function LocalPlacePanel({
  records,
  place,
  status,
  message,
  onRetryLocate,
  boardDate,
}: {
  records: PriceRecord[]
  place: DevicePlace | null
  status: GeoStatus
  message: string | null
  onRetryLocate: () => void
  boardDate?: string | null
}) {
  const { t } = usePrefs()
  const [placeMode, setPlaceMode] = useState<'gps' | 'manual'>('gps')
  const [manualDistrict, setManualDistrict] = useState('')
  const [manualMandiId, setManualMandiId] = useState('')
  const [placeAverages, setPlaceAverages] = useState<Record<string, VarietyAverage>>({})
  const [agentTick, setAgentTick] = useState(0)

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

  const preferredBoardDate = useMemo(() => {
    if (!resolved) return boardDate || null
    const gradeRows = VARIETY_BUCKETS.flatMap((b) => bucketRows(resolved.marketRows, b.key))
    // Exact place date from grade lots only — ignore unrelated low “other” lots on a newer day
    return (
      pickPlaceGradeBoardDate(gradeRows, resolved.marketRows) ||
      boardDate ||
      null
    )
  }, [resolved, boardDate])

  const varietyGroups = useMemo(() => {
    if (!resolved) return []
    return VARIETY_BUCKETS.map((b) => {
      const allForGrade = bucketRows(resolved.marketRows, b.key)
      // Prefer the place grade board date so Sarakku/Bede/… stay on the same exact day when possible
      const selected = selectRateRowsForGrade(allForGrade, preferredBoardDate)
      return {
        ...b,
        rows: selected.rows,
        rateDate: selected.rateDate,
        isStale: selected.isStale,
      }
    })
  }, [resolved, preferredBoardDate])

  const displayedGradeLots = useMemo(
    () => varietyGroups.flatMap((g) => g.rows),
    [varietyGroups],
  )

  const placeSummary = useMemo(() => {
    const dates = uniqueArrivalDates(displayedGradeLots)
    const rateDate = dates.length === 1 ? dates[0] : null
    const mixed = dates.length > 1
    return {
      rows: displayedGradeLots,
      rateDate,
      dates,
      mixed,
      isStale: dates.length > 0 && dates.some((d) => !isBoardDateToday(d)),
      avg: avg(displayedGradeLots.map((r) => r.modal_price).filter((n) => n > 0)),
    }
  }, [displayedGradeLots])

  const placeAvg = placeSummary.avg

  const varietyAvgs = useMemo(() => {
    return Object.fromEntries(
      varietyGroups.map((g) => [
        g.key,
        avg(g.rows.map((r) => r.modal_price).filter((n) => n > 0)),
      ]),
    ) as Record<VarietyBucketKey, number | null>
  }, [varietyGroups])

  useEffect(() => {
    if (!activePlace) {
      setPlaceAverages({})
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const data = await fetchAgentQuotes({
          district: activePlace.mandi.district,
          market: activePlace.mandi.market,
          days: 30,
        })
        if (!cancelled) setPlaceAverages(data.averages_by_variety || {})
      } catch {
        if (!cancelled) setPlaceAverages({})
      }
    })()
    return () => {
      cancelled = true
    }
  }, [activePlace, agentTick])

  const agentRows = useMemo(() => {
    if (!resolved) return []
    return buildAgentRateRows(resolved.marketRows, placeAverages)
  }, [resolved, placeAverages])

  const agentByKey = useMemo(() => {
    return Object.fromEntries(agentRows.map((r) => [r.varietyKey, r])) as Partial<
      Record<VarietyBucketKey, (typeof agentRows)[number]>
    >
  }, [agentRows])

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
                  {t('acrossGradeLotsAt', {
                    n: placeSummary.rows.length,
                    market: activePlace.mandi.market,
                  })}
                </span>
                <span className="local-avg__note">{t('placeAvgFromGrades')}</span>
                {placeSummary.mixed ? (
                  <span className="local-avg__stale">
                    {t('notTodaysRate')} ·{' '}
                    {t('mixedRateDates', { dates: placeSummary.dates.join(', ') })}
                  </span>
                ) : placeSummary.rateDate ? (
                  <span className={placeSummary.isStale ? 'local-avg__stale' : 'local-avg__live'}>
                    {placeSummary.isStale
                      ? t('ratesAsOfStale', { date: placeSummary.rateDate })
                      : t('asOf', { date: placeSummary.rateDate })}
                  </span>
                ) : null}
              </div>
            </div>
          </>
        ) : null}
      </div>

      {activeReady && activePlace && resolved ? (
        <>
          <div className="glass local-grade-strip">
            <div className="local-variety-stats">
              {varietyGroups.map((g) => (
                <div key={g.key} className="local-variety-stat">
                  <label>
                    {g.title} <em>{g.kannada}</em>
                  </label>
                  <strong>
                    {varietyAvgs[g.key] != null ? formatINR(varietyAvgs[g.key]!) : '—'}
                  </strong>
                  {g.rateDate ? (
                    <small className={g.isStale ? 'is-stale' : ''}>
                      {g.rateDate}
                      {g.isStale ? ` · ${t('notTodaysRate')}` : ''}
                    </small>
                  ) : null}
                </div>
              ))}
            </div>
          </div>

          <div className="variety-grid">
            {varietyGroups.map((g) => {
              const agent = agentByKey[g.key]
              return (
                <VarietyTable
                  key={g.key}
                  title={g.title}
                  kannada={g.kannada}
                  rows={g.rows}
                  rateDate={g.rateDate}
                  isStale={g.isStale}
                  agent={
                    agent
                      ? {
                          min: agent.agentMin,
                          max: agent.agentMax,
                          count: agent.agentCount,
                          latestDate: agent.latestDate,
                        }
                      : null
                  }
                />
              )
            })}
          </div>

          <AgentRatesBoard
            records={records}
            place={activePlace}
            onQuotesUpdated={() => setAgentTick((n) => n + 1)}
          />
        </>
      ) : null}
    </section>
  )
}
