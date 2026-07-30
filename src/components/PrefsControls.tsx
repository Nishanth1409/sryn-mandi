import { LOCALES } from '../i18n/messages'
import { usePrefs } from '../i18n/PrefsContext'

function GlobeIcon() {
  return (
    <svg className="pref-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3c2.6 2.5 4 5.6 4 9s-1.4 6.5-4 9c-2.6-2.5-4-5.6-4-9s1.4-6.5 4-9Z" />
    </svg>
  )
}

function SunIcon() {
  return (
    <svg className="pref-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="4.2" />
      <path d="M12 2.5v2.2M12 19.3v2.2M4.9 4.9l1.6 1.6M17.5 17.5l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.9 19.1l1.6-1.6M17.5 6.5l1.6-1.6" />
    </svg>
  )
}

function MoonIcon() {
  return (
    <svg className="pref-icon pref-icon--moon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M20 14.2A8.2 8.2 0 0 1 9.8 4a8.4 8.4 0 1 0 10.2 10.2Z" />
    </svg>
  )
}

function ChevronIcon() {
  return (
    <svg className="pref-chevron" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="m7 10 5 5 5-5" />
    </svg>
  )
}

export function PrefsControls() {
  const { locale, setLocale, theme, setTheme, t } = usePrefs()
  const active = LOCALES.find((l) => l.id === locale) ?? LOCALES[0]
  const nextTheme = theme === 'dark' ? 'light' : 'dark'
  const themeLabel = theme === 'dark' ? t('themeDark') : t('themeLight')
  const switchLabel = nextTheme === 'dark' ? t('themeDark') : t('themeLight')

  return (
    <div className="prefs-controls" role="group" aria-label={`${t('language')} · ${t('theme')}`}>
      <div className="lang-field" title={t('language')}>
        <GlobeIcon />
        <span className="lang-field__code" aria-hidden="true">
          {active.short}
        </span>
        <ChevronIcon />
        <select
          className="lang-field__select"
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
      </div>
      <button
        type="button"
        className="theme-btn"
        onClick={() => setTheme(nextTheme)}
        aria-label={`${t('theme')}: ${themeLabel}. ${switchLabel}`}
        title={switchLabel}
      >
        {theme === 'dark' ? <MoonIcon /> : <SunIcon />}
      </button>
    </div>
  )
}
