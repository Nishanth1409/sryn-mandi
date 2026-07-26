import { useCallback, useEffect, useState } from 'react'
import { findNearestMandi, type MandiPoint } from '../geo/mandis'

export type GeoStatus = 'idle' | 'locating' | 'ready' | 'denied' | 'error' | 'unsupported'

export type DevicePlace = {
  lat: number
  lng: number
  accuracyM: number
  mandi: MandiPoint
  distanceKm: number
  label: string
}

export function useDevicePlace() {
  const [status, setStatus] = useState<GeoStatus>('idle')
  const [place, setPlace] = useState<DevicePlace | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const locate = useCallback(() => {
    if (!('geolocation' in navigator)) {
      setStatus('unsupported')
      setMessage('Location is not supported on this device.')
      return
    }

    setStatus('locating')
    setMessage('Detecting your location…')

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude
        const lng = pos.coords.longitude
        const accuracyM = Math.round(pos.coords.accuracy)
        const { mandi, distanceKm } = findNearestMandi(lat, lng)
        setPlace({
          lat,
          lng,
          accuracyM,
          mandi,
          distanceKm,
          label: `${mandi.market} · ${mandi.district}`,
        })
        setStatus('ready')
        setMessage(null)
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          setStatus('denied')
          setMessage('Location permission denied. Allow location to see your place rates.')
        } else {
          setStatus('error')
          setMessage(err.message || 'Could not read device location.')
        }
      },
      {
        enableHighAccuracy: true,
        timeout: 20000,
        maximumAge: 60_000,
      },
    )
  }, [])

  useEffect(() => {
    locate()
  }, [locate])

  return { status, place, message, locate }
}
