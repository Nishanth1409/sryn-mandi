import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import {
  detectDeviceLocale,
  formatMessage,
  messages,
  type Locale,
  type MessageKey,
} from './messages'

export type ThemeMode = 'light' | 'dark'

type PrefsContextValue = {
  locale: Locale
  setLocale: (locale: Locale) => void
  theme: ThemeMode
  setTheme: (theme: ThemeMode) => void
  t: (key: MessageKey, vars?: Record<string, string | number>) => string
}

const PrefsContext = createContext<PrefsContextValue | null>(null)

const LOCALE_KEY = 'sryn-locale'
const THEME_KEY = 'sryn-theme'

function readStoredLocale(): Locale | null {
  try {
    const v = localStorage.getItem(LOCALE_KEY)
    if (v === 'en' || v === 'kn' || v === 'hi') return v
  } catch {
    /* ignore */
  }
  return null
}

function readStoredTheme(): ThemeMode | null {
  try {
    const v = localStorage.getItem(THEME_KEY)
    if (v === 'light' || v === 'dark') return v
  } catch {
    /* ignore */
  }
  return null
}

function systemTheme(): ThemeMode {
  if (typeof window === 'undefined') return 'dark'
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

function applyTheme(theme: ThemeMode) {
  document.documentElement.setAttribute('data-theme', theme)
  document.documentElement.style.colorScheme = theme
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', theme === 'light' ? '#e8f2eb' : '#061611')
}

function applyLocale(locale: Locale) {
  document.documentElement.lang = locale === 'kn' ? 'kn' : locale === 'hi' ? 'hi' : 'en'
}

export function PrefsProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => readStoredLocale() ?? detectDeviceLocale())
  const [theme, setThemeState] = useState<ThemeMode>(() => readStoredTheme() ?? systemTheme())
  const [themeTouched, setThemeTouched] = useState(() => readStoredTheme() != null)

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  useEffect(() => {
    applyLocale(locale)
  }, [locale])

  // Follow device theme until the user explicitly picks light/dark
  useEffect(() => {
    if (themeTouched) return
    const mq = window.matchMedia('(prefers-color-scheme: light)')
    const onChange = () => setThemeState(mq.matches ? 'light' : 'dark')
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [themeTouched])

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next)
    try {
      localStorage.setItem(LOCALE_KEY, next)
    } catch {
      /* ignore */
    }
  }, [])

  const setTheme = useCallback((next: ThemeMode) => {
    setThemeTouched(true)
    setThemeState(next)
    try {
      localStorage.setItem(THEME_KEY, next)
    } catch {
      /* ignore */
    }
  }, [])

  const t = useCallback(
    (key: MessageKey, vars?: Record<string, string | number>) => {
      const table = messages[locale] || messages.en
      return formatMessage(table[key] ?? messages.en[key] ?? key, vars)
    },
    [locale],
  )

  const value = useMemo(
    () => ({ locale, setLocale, theme, setTheme, t }),
    [locale, setLocale, theme, setTheme, t],
  )

  return <PrefsContext.Provider value={value}>{children}</PrefsContext.Provider>
}

export function usePrefs() {
  const ctx = useContext(PrefsContext)
  if (!ctx) throw new Error('usePrefs must be used within PrefsProvider')
  return ctx
}
