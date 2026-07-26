import { useEffect, useState } from 'react'
import { usePrefs } from '../i18n/PrefsContext'

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

function isIos(): boolean {
  if (typeof navigator === 'undefined') return false
  return /iphone|ipad|ipod/i.test(navigator.userAgent)
}

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    // @ts-expect-error iOS Safari
    Boolean(window.navigator.standalone)
  )
}

export function InstallAppBanner() {
  const { t } = usePrefs()
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null)
  const [iosHint, setIosHint] = useState(false)
  const [hidden, setHidden] = useState(false)

  useEffect(() => {
    if (isStandalone()) {
      setHidden(true)
      return
    }
    const onBip = (e: Event) => {
      e.preventDefault()
      setDeferred(e as BeforeInstallPromptEvent)
    }
    window.addEventListener('beforeinstallprompt', onBip)
    if (isIos()) setIosHint(true)
    return () => window.removeEventListener('beforeinstallprompt', onBip)
  }, [])

  if (hidden || (!deferred && !iosHint)) return null

  const onInstall = async () => {
    if (!deferred) return
    await deferred.prompt()
    const choice = await deferred.userChoice
    if (choice.outcome === 'accepted') setHidden(true)
    setDeferred(null)
  }

  return (
    <div className="shell install-banner glass" role="region" aria-label={t('installApp')}>
      <div>
        <strong>{t('installApp')}</strong>
        <p>{iosHint && !deferred ? t('installIosHint') : t('installAndroidHint')}</p>
      </div>
      <div className="install-actions">
        {deferred ? (
          <button className="btn btn-gold" type="button" onClick={() => void onInstall()}>
            {t('installNow')}
          </button>
        ) : null}
        <button className="btn btn-ghost" type="button" onClick={() => setHidden(true)}>
          {t('installLater')}
        </button>
      </div>
    </div>
  )
}
