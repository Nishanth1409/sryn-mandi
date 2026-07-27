import { useEffect, useState } from 'react'
import { usePrefs } from '../i18n/PrefsContext'

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    // @ts-expect-error iOS Safari
    Boolean(window.navigator.standalone)
  )
}

/** Only show when the browser actually offers install — keeps the first screen clean. */
export function InstallAppBanner() {
  const { t } = usePrefs()
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null)
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
    return () => window.removeEventListener('beforeinstallprompt', onBip)
  }, [])

  if (hidden || !deferred) return null

  const onInstall = async () => {
    await deferred.prompt()
    const choice = await deferred.userChoice
    if (choice.outcome === 'accepted') setHidden(true)
    setDeferred(null)
  }

  return (
    <div className="shell install-banner glass" role="region" aria-label={t('installApp')}>
      <div>
        <strong>{t('installApp')}</strong>
        <p>{t('installAndroidHint')}</p>
      </div>
      <div className="install-actions">
        <button className="btn btn-gold" type="button" onClick={() => void onInstall()}>
          {t('installNow')}
        </button>
        <button className="btn btn-ghost" type="button" onClick={() => setHidden(true)}>
          {t('installLater')}
        </button>
      </div>
    </div>
  )
}
