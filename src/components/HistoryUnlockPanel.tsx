import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { fetchAgmarknetCaptcha, unlockAgmarknetHistory } from '../api'
import { usePrefs } from '../i18n/PrefsContext'
import type { AgmarknetCaptcha, PricesResponse } from '../types'

type Props = {
  needed: boolean
  availableDateCount: number
  onUnlocked: (prices: PricesResponse) => void
}

export function HistoryUnlockPanel({ needed, availableDateCount, onUnlocked }: Props) {
  const { t } = usePrefs()
  const [challenge, setChallenge] = useState<AgmarknetCaptcha | null>(null)
  const [answer, setAnswer] = useState('')
  const [loadingChallenge, setLoadingChallenge] = useState(false)
  const [unlocking, setUnlocking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const loadChallenge = useCallback(async () => {
    setLoadingChallenge(true)
    setError(null)
    setSuccess(null)
    setAnswer('')
    try {
      const next = await fetchAgmarknetCaptcha()
      setChallenge(next)
    } catch (exc) {
      setChallenge(null)
      setError(exc instanceof Error ? exc.message : t('captchaLoadFailed'))
    } finally {
      setLoadingChallenge(false)
    }
  }, [t])

  useEffect(() => {
    if (!needed) return
    void loadChallenge()
  }, [needed, loadChallenge])

  if (!needed && availableDateCount > 3) {
    return null
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!challenge || !answer.trim()) return
    setUnlocking(true)
    setError(null)
    setSuccess(null)
    try {
      const result = await unlockAgmarknetHistory({
        captcha_key: challenge.captcha_key,
        captcha: answer.trim(),
      })
      onUnlocked(result.prices)
      setSuccess(
        t('captchaUnlockSuccess', {
          dates: String(result.date_count),
          rows: String(result.fetched_rows),
        }),
      )
      setChallenge(null)
      setAnswer('')
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : t('captchaUnlockFailed'))
      void loadChallenge()
    } finally {
      setUnlocking(false)
    }
  }

  return (
    <section className="shell glass history-unlock" aria-label={t('captchaTitle')}>
      <div className="history-unlock__copy">
        <strong>{t('captchaTitle')}</strong>
        <p>{t('captchaBody')}</p>
        {availableDateCount > 0 ? (
          <span>{t('availableDateCount', { n: availableDateCount })}</span>
        ) : null}
      </div>

      {success ? <p className="history-unlock__success">{success}</p> : null}
      {error ? <p className="history-unlock__error">{error}</p> : null}

      {challenge ? (
        <form className="history-unlock__form" onSubmit={(event) => void handleSubmit(event)}>
          <img
            className="history-unlock__image"
            src={challenge.image_data_url}
            alt={t('captchaImageAlt')}
            width={200}
            height={80}
          />
          <label className="history-unlock__field">
            <span>{t('captchaAnswerLabel')}</span>
            <input
              value={answer}
              onChange={(event) => setAnswer(event.target.value)}
              autoComplete="off"
              spellCheck={false}
              maxLength={16}
              placeholder={t('captchaAnswerPlaceholder')}
              disabled={unlocking}
              required
            />
          </label>
          <div className="history-unlock__actions">
            <button className="btn btn-gold" type="submit" disabled={unlocking || !answer.trim()}>
              {unlocking ? t('captchaUnlocking') : t('captchaUnlock')}
            </button>
            <button
              className="btn"
              type="button"
              onClick={() => void loadChallenge()}
              disabled={loadingChallenge || unlocking}
            >
              {t('captchaRefresh')}
            </button>
          </div>
        </form>
      ) : (
        <button
          className="btn btn-gold"
          type="button"
          onClick={() => void loadChallenge()}
          disabled={loadingChallenge}
        >
          {loadingChallenge ? t('captchaLoading') : t('captchaShow')}
        </button>
      )}
    </section>
  )
}
