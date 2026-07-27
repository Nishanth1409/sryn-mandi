import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { fetchPrices } from './api'
import { ArakaScene } from './components/ArakaScene'
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
import { useDevicePlace } from './hooks/useDevicePlace'
import type { PricesResponse } from './types'
import './index.css'

const REFRESH_MS = 5 * 60 * 1000

const emptyFilters: FiltersState = {
  query: '',
  state: '',
  district: '',
  variety: '',
  focus: 'all',
}

export default function App() {
  const { t } = usePrefs()
  const [data, setData] = useState<PricesResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [filters, setFilters] = useState<FiltersState>(emptyFilters)
  const [scope, setScope] = useState<'karnataka' | 'india'>('india')
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
        days: 14,
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
        // Stage 1: Karnataka first so boards appear quickly with real rates
        const quick = await fetchPrices({ days: 14, scope: 'karnataka' })
        if (cancelled) return
        if (quick.records?.length) {
          setData(quick)
          hasDataRef.current = true
          setScope('karnataka')
        }
        setLoading(false)

        // Stage 2: expand to All-India — never replace good data with an empty board
        setRefreshing(true)
        const full = await fetchPrices({ days: 14, scope: 'india' })
        if (cancelled) return
        if (full.records?.length) {
          setData(full)
          setScope('india')
          hasDataRef.current = true
        }
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

  const updatedLabel = useMemo(() => {
    if (!data?.updated_at) return t('syncingAgmarknet')
    const age = data.cache_age_seconds
    if (age < 60) return t('justNow')
    return t('minutesAgo', { n: Math.round(age / 60) })
  }, [data, t])

  const scrollToRates = () => {
    document.getElementById('local')?.scrollIntoView({ behavior: 'smooth' })
  }

  const handleFocusChange = (next: FiltersState) => {
    setFilters(next)
    if (scope !== 'india') void load(false, 'india')
  }

  return (
    <>
      <ArakaScene />

      <div className="app-overlay">
        <HeroOverlay
          updatedLabel={updatedLabel}
          onExplore={scrollToRates}
          onRefresh={() => void load(true)}
          loading={refreshing}
        />

        <div className="panel-stack">
          <InstallAppBanner />
          {data ? <StatsStrip summary={data.summary} updatedAt={data.updated_at} /> : null}

          {loading && !data ? (
            <div className="shell glass loading">{t('growingPlantation')}</div>
          ) : null}

          {error && !data ? (
            <div className="shell glass error">
              <p>{error}</p>
              <button className="btn btn-gold" type="button" onClick={() => void load(true)}>
                {t('retry')}
              </button>
            </div>
          ) : null}

          {data ? (
            <>
              <LocalPlacePanel
                records={data.records}
                place={place}
                status={geoStatus}
                message={geoMessage}
                onRetryLocate={locate}
              />
              <TrendsPanel history={data.history} topMarkets={data.top_markets} />
              <RatesPanel
                records={data.records}
                filters={filters}
                onChange={handleFocusChange}
                onRefresh={() => void load(true)}
                loading={refreshing}
                updatedAt={data.updated_at}
              />
            </>
          ) : null}

          <footer className="shell footer">
            <p>{t('footer')}</p>
          </footer>
        </div>
      </div>
    </>
  )
}
