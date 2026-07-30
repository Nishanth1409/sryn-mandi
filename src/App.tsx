import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { fetchPrices } from './api'
import { ArakaScene } from './components/ArakaScene'
import { AvailableDateCalendar } from './components/AvailableDateCalendar'
import { HistoryUnlockPanel } from './components/HistoryUnlockPanel'
import { LocalPlacePanel } from './components/LocalPlacePanel'
import {
  HeroOverlay,
  RatesPanel,
  StatsStrip,
  TrendsPanel,
  type FiltersState,
} from './components/MarketPanels'
import { InstallAppBanner } from './components/InstallAppBanner'
import { usePrefs } from './i18n/PrefsContext'
import { useDevicePlace, type DevicePlace } from './hooks/useDevicePlace'
import { isBoardDateToday, filterToBoardDate, pickLiveBoardDate } from './components/shared'
import type { PriceRecord, PricesResponse, SummaryStats } from './types'
import './index.css'

const REFRESH_MS = 5 * 60 * 1000
// Ask for the full archive window so every saved official date stays browsable.
const SERVE_WINDOW_DAYS = 400
const HEAL_BASE_DELAY_MS = 10 * 1000
const HEAL_MAX_DELAY_MS = 5 * 60 * 1000

const emptyFilters: FiltersState = {
  query: '',
  state: '',
  district: '',
  variety: '',
  focus: 'all',
}

function summarizeRecords(records: PriceRecord[], boardDate: string | null): SummaryStats {
  const modals = records.map((record) => record.modal_price).filter((price) => price > 0)
  const shivamogga = records
    .filter((record) => record.is_shivamogga)
    .map((record) => record.modal_price)
    .filter((price) => price > 0)
  return {
    avg_modal: modals.length ? Math.round((modals.reduce((a, b) => a + b, 0) / modals.length) * 100) / 100 : 0,
    highest: modals.length ? Math.max(...modals) : 0,
    lowest: modals.length ? Math.min(...modals) : 0,
    markets: new Set(records.map((record) => `${record.market}|${record.district}`)).size,
    varieties: new Set(records.map((record) => record.variety)).size,
    states: new Set(records.map((record) => record.state)).size,
    records: records.length,
    latest_date: boardDate,
    shivamogga_avg: shivamogga.length
      ? Math.round((shivamogga.reduce((a, b) => a + b, 0) / shivamogga.length) * 100) / 100
      : null,
  }
}

export default function App() {
  const { t } = usePrefs()
  const [data, setData] = useState<PricesResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [filters, setFilters] = useState<FiltersState>(emptyFilters)
  const [scope, setScope] = useState<'karnataka' | 'india'>('karnataka')
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [healAttempt, setHealAttempt] = useState(0)
  const [activePlace, setActivePlace] = useState<DevicePlace | null>(null)
  const scopeRef = useRef(scope)
  const hasDataRef = useRef(false)
  scopeRef.current = scope
  const { status: geoStatus, place, message: geoMessage, locate } = useDevicePlace()

  const load = useCallback(async (refresh = false, nextScope?: 'karnataka' | 'india') => {
    const activeScope = nextScope ?? scopeRef.current
    try {
      if (refresh || hasDataRef.current) setRefreshing(true)
      else setLoading(true)
      setError(null)
      const payload = await fetchPrices({
        days: SERVE_WINDOW_DAYS,
        scope: activeScope,
        refresh,
      })
      // Keep existing boards if upstream returns an empty/zero payload
      if (payload.records?.length) {
        setData(payload)
        hasDataRef.current = true
        if (nextScope) setScope(nextScope)
      } else if (!hasDataRef.current) {
        setData(payload)
      }
    } catch (err) {
      setError((err as Error).message || 'Unable to load market prices')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    const boot = async () => {
      try {
        setLoading(true)
        setError(null)
        // Karnataka keeps the full official lookback; All-India remains opt-in.
        const quick = await fetchPrices({ days: SERVE_WINDOW_DAYS, scope: 'karnataka' })
        if (cancelled) return
        if (quick.records?.length) {
          setData(quick)
          hasDataRef.current = true
          setScope('karnataka')
        }
        setLoading(false)
      } catch (err) {
        if (cancelled) return
        setError((err as Error).message || 'Unable to load market prices')
      } finally {
        if (!cancelled) {
          setLoading(false)
          setRefreshing(false)
        }
      }
    }

    void boot()
    // Soft refresh (use cache) — hard refresh only via Sync Markets button
    const id = window.setInterval(() => void load(false), REFRESH_MS)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [load])

  const emptyBoard = Boolean(data ? data.records.length === 0 : error)

  // Keep retrying on a widening delay until the official feeds answer again.
  useEffect(() => {
    if (!emptyBoard) return
    const delay = Math.min(HEAL_BASE_DELAY_MS * 2 ** healAttempt, HEAL_MAX_DELAY_MS)
    const id = window.setTimeout(() => {
      setHealAttempt((attempt) => attempt + 1)
      void load(true)
    }, delay)
    return () => window.clearTimeout(id)
  }, [emptyBoard, healAttempt, load])

  useEffect(() => {
    if (!emptyBoard && healAttempt !== 0) setHealAttempt(0)
  }, [emptyBoard, healAttempt])

  const availableDates = useMemo(() => {
    if (!data) return null
    return data.available_dates?.length
      ? data.available_dates
      : Array.from(new Set(data.records.map((record) => record.arrival_date).filter(Boolean)))
  }, [data])

  useEffect(() => {
    if (!data || !availableDates?.length) {
      setSelectedDate(null)
      return
    }
    setSelectedDate((current) =>
      current && availableDates.includes(current)
        ? current
        : data.board_date || data.summary.latest_date || pickLiveBoardDate(data.records),
    )
  }, [availableDates, data])

  const boardDate = selectedDate

  const boardRecords = useMemo(() => {
    if (!data) return []
    return filterToBoardDate(data.records, boardDate)
  }, [data, boardDate])

  const boardIsToday = Boolean(boardRecords.length && boardDate && isBoardDateToday(boardDate))
  const staleBoardDate = boardDate && !boardIsToday ? boardDate : null

  const updatedLabel = useMemo(() => {
    if (!data?.records.length) return t('noOfficialRates')
    if (!data?.updated_at) return t('syncingAgmarknet')
    if (staleBoardDate) return t('ratesAsOfStale', { date: staleBoardDate })
    const age = data.cache_age_seconds
    if (age < 60) return t('justNow')
    return t('minutesAgo', { n: Math.round(age / 60) })
  }, [data, staleBoardDate, t])

  const boardSummary = useMemo<SummaryStats | null>(() => {
    if (!data) return null
    return summarizeRecords(boardRecords, boardDate)
  }, [boardDate, boardRecords, data])

  const scrollToRates = () => {
    document.getElementById('local')?.scrollIntoView({ behavior: 'smooth' })
  }

  const handleFocusChange = (next: FiltersState) => {
    const explicitlyOpenedAllIndia = next.focus === 'all' && filters.focus !== 'all'
    setFilters(next)
    if (scope !== 'india' && explicitlyOpenedAllIndia) void load(false, 'india')
  }

  return (
    <>
      <ArakaScene />

      <div className="app-overlay">
        <HeroOverlay
          updatedLabel={updatedLabel}
          livePrefix={boardIsToday}
          onExplore={scrollToRates}
          onRefresh={() => void load(true)}
          loading={refreshing}
        />

        <div className="panel-stack">
          <InstallAppBanner />
          {data?.records.length && availableDates?.length ? (
            <AvailableDateCalendar
              availableDates={availableDates}
              selectedDate={boardDate}
              onSelect={setSelectedDate}
              archivedNotice={
                data.feed_health?.state === 'archived' ? t('archivedRatesNotice') : null
              }
            />
          ) : null}

          <HistoryUnlockPanel
            needed={Boolean(
              (availableDates?.length ?? 0) <= 3 &&
                (data?.feed_health?.captcha_required ||
                  data?.feed_health?.sources?.agmarknet === 'captcha_required'),
            )}
            availableDateCount={availableDates?.length ?? 0}
            onUnlocked={(prices) => {
              setData(prices)
              setSelectedDate(null)
              setError(null)
              setHealAttempt(0)
            }}
          />

          {boardSummary ? <StatsStrip summary={boardSummary} boardDate={boardDate} /> : null}

          {loading && !data ? (
            <div className="shell glass loading">{t('growingPlantation')}</div>
          ) : null}

          {emptyBoard && !loading ? (
            <div className="shell glass error">
              <p>{data ? t('noOfficialRates') : error}</p>
              <p className="error__healing">{t('retryingAutomatically')}</p>
              <button className="btn btn-gold" type="button" onClick={() => void load(true)}>
                {t('retry')}
              </button>
            </div>
          ) : null}

          {data?.records.length ? (
            <>
              <LocalPlacePanel
                records={data.records}
                place={place}
                status={geoStatus}
                message={geoMessage}
                onRetryLocate={locate}
                boardDate={boardDate}
                availableDates={availableDates || []}
                onSelectDate={setSelectedDate}
                onActivePlaceChange={setActivePlace}
              />
              <RatesPanel
                records={boardRecords}
                filters={filters}
                onChange={handleFocusChange}
                onRefresh={() => void load(true)}
                loading={refreshing}
                updatedAt={data.updated_at}
                boardDate={boardDate}
                availableDates={availableDates || []}
                onSelectDate={setSelectedDate}
              />
              <TrendsPanel
                allRecords={data.records}
                boardRecords={boardRecords}
                activePlace={activePlace}
                boardDate={boardDate}
              />
            </>
          ) : null}

          <footer className="shell footer">
            <p className="footer__copy">{t('footerCopyright', { year: new Date().getFullYear() })}</p>
            <p className="footer__note">{t('footer')}</p>
          </footer>
        </div>
      </div>
    </>
  )
}
