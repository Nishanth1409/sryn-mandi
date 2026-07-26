import { LOCALES } from '../i18n/messages'
import { usePrefs } from '../i18n/PrefsContext'

export function PrefsControls() {
  const { locale, setLocale, theme, setTheme, t } = usePrefs()

  return (
    <div className="prefs-controls" role="group" aria-label="Language and theme">
      <label className="prefs-field">
        <span className="visually-hidden">{t('language')}</span>
        <select
          className="prefs-select"
          value={locale}
          onChange={(e) => setLocale(e.target.value as typeof locale)}
          aria-label={t('language')}
        >
          {LOCALES.map((l) => (
            <option key={l.id} value={l.id}>
              {l.native}
            </option>
          ))}
        </select>
      </label>
      <div className="theme-toggle" role="group" aria-label={t('theme')}>
        <button
          type="button"
          className={`theme-btn ${theme === 'light' ? 'on' : ''}`}
          onClick={() => setTheme('light')}
          aria-pressed={theme === 'light'}
        >
          {t('themeLight')}
        </button>
        <button
          type="button"
          className={`theme-btn ${theme === 'dark' ? 'on' : ''}`}
          onClick={() => setTheme('dark')}
          aria-pressed={theme === 'dark'}
        >
          {t('themeDark')}
        </button>
      </div>
    </div>
  )
}
