import { useEffect, useMemo, useState } from 'react'
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
import { AvailableDateCalendar } from './AvailableDateCalendar'
import { formatINR, TrendDelta } from './shared'

function avg(nums: number[]): number | null {
  if (!nums.length) return null
  return Math.round((nums.reduce((sum, value) => sum + value, 0) / nums.length) * 100) / 100
}

function norm(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '')
}

export function filterPlaceRecords(records: PriceRecord[], mandi: MandiPoint): PriceRecord[] {
  const aliases = [mandi.market, ...mandi.aliases].map(norm)
  const districtNeedle = norm(mandi.district)
  const districtRows = records.filter((record) => {
    const district = norm(record.district)
    if (district.includes(districtNeedle) || districtNeedle.includes(district)) return true
    return (
      mandi.district === 'Shivamogga' &&
      (district.includes('shimoga') || district.includes('shivamogga') || record.is_shivamogga)
    )
  })
  const marketRows = districtRows.filter((record) => {
    const market = norm(record.market)
    return aliases.some(
      (alias) =>
        market.includes(alias) ||
        alias.includes(market) ||
        (alias.length >= 5 && market.includes(alias.slice(0, 5))) ||
        (market.length >= 5 && alias.includes(market.slice(0, 5))),
    )
  })
  return marketRows.length >= 2 ? marketRows : districtRows.length ? districtRows : marketRows
}

function bucketRows(rows: PriceRecord[], key: VarietyBucketKey): PriceRecord[] {
  const bucket = VARIETY_BUCKETS.find((item) => item.key === key)!
  return rows
    .filter((record) => matchesVarietyBucket(record.variety, bucket.match))
    .sort((a, b) => b.modal_price - a.modal_price)
}

function VarietyTable({
  title,
  kannada,
  rows,
  rateDate,
}: {
  title: string
  kannada: string
  rows: PriceRecord[]
  rateDate: string | null
}) {
  const { t } = usePrefs()
  const modalAvg = avg(rows.map((record) => record.modal_price).filter((price) => price > 0))

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
              : t('noRatesOnDate')}
          </p>
          {rateDate && rows.length ? (
            <p className="variety-card__stale is-live">{t('ratesAsOf', { date: rateDate })}</p>
          ) : null}
        </div>
      </header>

      {rows.length === 0 ? (
        <div className="empty">{t('noRatesOnDate')}</div>
      ) : (
        <div className="variety-lots">
          {rows.map((record) => (
            <article className="lot-card" key={record.id}>
              <div className="lot-card__top">
                <div className="market">
                  <strong>{record.market}</strong>
                  <small>
                    {record.district}
                    {record.grade ? ` · ${record.grade}` : ''}
                  </small>
                </div>
                <TrendDelta change={record.change} changePct={record.change_pct} />
              </div>
              <div className="lot-card__prices">
                <div>
                  <label>{t('min')}</label>
                  <strong className="num">{formatINR(record.min_price)}</strong>
                </div>
                <div>
                  <label>{t('modal')}</label>
                  <strong className="num lot-modal">{formatINR(record.modal_price)}</strong>
                </div>
                <div>
                  <label>{t('max')}</label>
                  <strong className="num">{formatINR(record.max_price)}</strong>
                </div>
              </div>
              <div className="lot-card__date">
                {t('rateDate')}: {record.arrival_date} · {record.source}
              </div>
            </article>
          ))}
        </div>
      )}
    </article>
  )
}

export function LocalPlacePanel({
  records,
  place,
  status,
  message,
  onRetryLocate,
  boardDate,
  availableDates,
  onSelectDate,
  onActivePlaceChange,
}: {
  records: PriceRecord[]
  place: DevicePlace | null
  status: GeoStatus
  message: string | null
  onRetryLocate: () => void
  boardDate?: string | null
  availableDates?: string[]
  onSelectDate?: (date: string) => void
  onActivePlaceChange?: (place: DevicePlace | null) => void
}) {
  const { t } = usePrefs()
  const [placeMode, setPlaceMode] = useState<'gps' | 'manual'>('gps')
  const [manualDistrict, setManualDistrict] = useState('')
  const [manualMandiId, setManualMandiId] = useState('')
  const districts = useMemo(
    () => Array.from(new Set(ARECA_MANDIS.map((mandi) => mandi.district))).sort(),
    [],
  )
  const marketsForDistrict = useMemo(
    () =>
      ARECA_MANDIS.filter((mandi) => !manualDistrict || mandi.district === manualDistrict).sort(
        (a, b) => a.market.localeCompare(b.market),
      ),
    [manualDistrict],
  )
  const manualMandi = useMemo(
    () => ARECA_MANDIS.find((mandi) => mandi.id === manualMandiId) || null,
    [manualMandiId],
  )
  const activePlace = useMemo<DevicePlace | null>(() => {
    if (placeMode === 'gps') return place
    if (!manualMandi) return null
    return {
      lat: manualMandi.lat,
      lng: manualMandi.lng,
      accuracyM: 0,
      mandi: manualMandi,
      distanceKm: 0,
      label: `${manualMandi.market} · ${manualMandi.district}`,
    }
  }, [manualMandi, place, placeMode])
  const activeReady =
    placeMode === 'manual' ? Boolean(manualMandi) : status === 'ready' && Boolean(place)

  useEffect(() => {
    if (placeMode === 'gps' && place && !manualDistrict) {
      setManualDistrict(place.mandi.district)
      setManualMandiId(place.mandi.id)
    }
  }, [manualDistrict, place, placeMode])

  useEffect(() => {
    onActivePlaceChange?.(activeReady ? activePlace : null)
  }, [activePlace, activeReady, onActivePlaceChange])

  const exactPlaceRows = useMemo(() => {
    if (!activePlace) return []
    const placeRows = filterPlaceRecords(records, activePlace.mandi)
    if (!boardDate) return placeRows
    return placeRows.filter((record) => record.arrival_date === boardDate)
  }, [activePlace, boardDate, records])
  const varietyGroups = useMemo(
    () =>
      VARIETY_BUCKETS.map((bucket) => ({
        ...bucket,
        rows: bucketRows(exactPlaceRows, bucket.key),
      })),
    [exactPlaceRows],
  )
  const displayedLots = varietyGroups.flatMap((group) => group.rows)
  const placeAvg = avg(displayedLots.map((record) => record.modal_price).filter((price) => price > 0))

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

        {availableDates?.length && onSelectDate ? (
          <AvailableDateCalendar
            compact
            label={t('placeRateDate')}
            availableDates={availableDates}
            selectedDate={boardDate || null}
            onSelect={onSelectDate}
          />
        ) : null}

        <div className="place-mode-row">
          <button className={`chip ${placeMode === 'gps' ? 'on' : ''}`} type="button" onClick={() => setPlaceMode('gps')}>
            {t('placeModeGps')}
          </button>
          <button className={`chip ${placeMode === 'manual' ? 'on' : ''}`} type="button" onClick={() => setPlaceMode('manual')}>
            {t('placeModeManual')}
          </button>
        </div>

        {placeMode === 'manual' ? (
          <div className="place-manual-form">
            <p>{t('manualPlaceHint')}</p>
            <div className="filters filters--compact">
              <div className="field">
                <label htmlFor="pd">{t('chooseDistrict')}</label>
                <select id="pd" value={manualDistrict} onChange={(event) => {
                  setManualDistrict(event.target.value)
                  setManualMandiId('')
                }}>
                  <option value="">{t('chooseDistrict')}</option>
                  {districts.map((district) => <option key={district}>{district}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor="pm">{t('chooseMarket')}</label>
                <select id="pm" value={manualMandiId} disabled={!manualDistrict} onChange={(event) => setManualMandiId(event.target.value)}>
                  <option value="">{t('chooseMarket')}</option>
                  {marketsForDistrict.map((mandi) => <option key={mandi.id} value={mandi.id}>{mandi.market}</option>)}
                </select>
              </div>
            </div>
          </div>
        ) : null}

        {placeMode === 'gps' && (status === 'locating' || status === 'idle') ? <div className="loading">{t('readingLocation')}</div> : null}
        {placeMode === 'gps' && (status === 'denied' || status === 'error' || status === 'unsupported') ? (
          <div className="error">
            <p>{message}</p>
            <button className="btn btn-gold" type="button" onClick={onRetryLocate}>{t('allowLocationRetry')}</button>
          </div>
        ) : null}

        {activeReady && activePlace ? (
          <div className="local-meta">
            <div>
              <label>{placeMode === 'manual' ? t('selectedPlace') : t('detectedPlace')}</label>
              <strong>{activePlace.mandi.district}</strong>
              <span>{activePlace.mandi.market}</span>
            </div>
            <div className="local-avg">
              <label>{t('placeAverageModal')}</label>
              <strong>{placeAvg == null ? '—' : formatINR(placeAvg)}</strong>
              <span>{t('ratesAsOf', { date: boardDate || '—' })}</span>
            </div>
          </div>
        ) : null}
      </div>

      {activeReady && activePlace ? (
        <div className="variety-grid">
          {varietyGroups.map((group) => (
            <VarietyTable key={group.key} title={group.title} kannada={group.kannada} rows={group.rows} rateDate={boardDate || null} />
          ))}
        </div>
      ) : null}
    </section>
  )
}
