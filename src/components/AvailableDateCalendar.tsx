import { useEffect, useMemo, useRef, useState } from 'react'
import { usePrefs } from '../i18n/PrefsContext'

type Props = {
  availableDates: string[]
  selectedDate: string | null
  onSelect: (date: string) => void
  archivedNotice?: string | null
  compact?: boolean
  label?: string
  id?: string
}

const localeTags = { en: 'en-IN', kn: 'kn-IN', hi: 'hi-IN' } as const

function parseOfficialDate(value: string): Date | null {
  const match = /^(\d{2})-(\d{2})-(\d{4})$/.exec(value)
  if (!match) return null
  const date = new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1]))
  return Number.isNaN(date.getTime()) ? null : date
}

function formatDisplayDate(value: string | null, localeTag: string): string {
  if (!value) return '—'
  const date = parseOfficialDate(value)
  if (!date) return value
  return new Intl.DateTimeFormat(localeTag, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date)
}

function monthKey(date: Date): number {
  return date.getFullYear() * 12 + date.getMonth()
}

function fromMonthKey(key: number): Date {
  return new Date(Math.floor(key / 12), key % 12, 1)
}

function toOfficial(day: number, monthIndex: number, year: number): string {
  return `${String(day).padStart(2, '0')}-${String(monthIndex + 1).padStart(2, '0')}-${year}`
}

export function AvailableDateCalendar({
  availableDates,
  selectedDate,
  onSelect,
  archivedNotice,
  compact = false,
  label,
  id,
}: Props) {
  const { locale, t } = usePrefs()
  const localeTag = localeTags[locale]
  const rootRef = useRef<HTMLDivElement>(null)
  const available = useMemo(() => new Set(availableDates), [availableDates])
  const parsedDates = useMemo(
    () =>
      availableDates
        .map((value) => ({ value, date: parseOfficialDate(value) }))
        .filter((item): item is { value: string; date: Date } => item.date !== null)
        .sort((a, b) => a.date.getTime() - b.date.getTime()),
    [availableDates],
  )
  const monthsWithData = useMemo(() => {
    const keys = new Set<number>()
    for (const item of parsedDates) keys.add(monthKey(item.date))
    return keys
  }, [parsedDates])
  const yearsWithData = useMemo(() => {
    const years = new Set<number>()
    for (const item of parsedDates) years.add(item.date.getFullYear())
    return [...years].sort((a, b) => a - b)
  }, [parsedDates])

  const firstMonth = parsedDates.length ? monthKey(parsedDates[0].date) : monthKey(new Date())
  const lastMonth = parsedDates.length
    ? monthKey(parsedDates[parsedDates.length - 1].date)
    : firstMonth
  const selected = selectedDate ? parseOfficialDate(selectedDate) : null
  const selectedMonth = selected ? monthKey(selected) : null

  const [open, setOpen] = useState(false)
  const [pickerMode, setPickerMode] = useState<'days' | 'months'>('days')
  const [visibleMonth, setVisibleMonth] = useState(() => selectedMonth ?? lastMonth)
  const [visibleYear, setVisibleYear] = useState(
    () => fromMonthKey(selectedMonth ?? lastMonth).getFullYear(),
  )

  useEffect(() => {
    if (selectedMonth !== null) {
      setVisibleMonth(selectedMonth)
      setVisibleYear(fromMonthKey(selectedMonth).getFullYear())
    } else {
      setVisibleMonth(lastMonth)
      setVisibleYear(fromMonthKey(lastMonth).getFullYear())
    }
  }, [lastMonth, selectedMonth])

  useEffect(() => {
    if (!open) return
    const onPointer = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false)
        setPickerMode('days')
      }
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
        setPickerMode('days')
      }
    }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const monthDate = fromMonthKey(visibleMonth)
  const daysInMonth = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0).getDate()
  const leadingDays = monthDate.getDay()
  const monthLabel = new Intl.DateTimeFormat(localeTag, {
    month: 'long',
    year: 'numeric',
  }).format(monthDate)
  const weekdayLabels = Array.from({ length: 7 }, (_, index) =>
    new Intl.DateTimeFormat(localeTag, { weekday: 'narrow' }).format(new Date(2026, 7, 2 + index)),
  )
  const displayDate = formatDisplayDate(selectedDate, localeTag)
  const heading = label || t('browseByDate')
  const yearMin = yearsWithData[0] ?? visibleYear
  const yearMax = yearsWithData[yearsWithData.length - 1] ?? visibleYear

  function openPicker() {
    setPickerMode('days')
    setVisibleMonth(selectedMonth ?? lastMonth)
    setVisibleYear(fromMonthKey(selectedMonth ?? lastMonth).getFullYear())
    setOpen(true)
  }

  function chooseMonth(monthIndex: number) {
    const key = visibleYear * 12 + monthIndex
    if (!monthsWithData.has(key)) return
    setVisibleMonth(key)
    setPickerMode('days')
  }

  function chooseDay(officialDate: string) {
    onSelect(officialDate)
    setOpen(false)
    setPickerMode('days')
  }

  const monthsView = (
    <>
      <div className="date-calendar__nav">
        <button
          type="button"
          aria-label={t('previousYear')}
          onClick={() => setVisibleYear((year) => Math.max(yearMin, year - 1))}
          disabled={visibleYear <= yearMin}
        >
          ‹
        </button>
        <button
          className="date-calendar__month-toggle is-active"
          type="button"
          onClick={() => setPickerMode('days')}
        >
          {visibleYear}
        </button>
        <button
          type="button"
          aria-label={t('nextYear')}
          onClick={() => setVisibleYear((year) => Math.min(yearMax, year + 1))}
          disabled={visibleYear >= yearMax}
        >
          ›
        </button>
      </div>
      <div className="date-calendar__months" role="listbox" aria-label={t('selectMonth')}>
        {Array.from({ length: 12 }, (_, monthIndex) => {
          const key = visibleYear * 12 + monthIndex
          const enabled = monthsWithData.has(key)
          const labelText = new Intl.DateTimeFormat(localeTag, { month: 'short' }).format(
            new Date(visibleYear, monthIndex, 1),
          )
          const isCurrent = key === visibleMonth
          return (
            <button
              key={key}
              type="button"
              role="option"
              className={isCurrent ? 'is-selected' : undefined}
              disabled={!enabled}
              aria-selected={isCurrent}
              onClick={() => chooseMonth(monthIndex)}
            >
              {labelText}
            </button>
          )
        })}
      </div>
      <p className="date-calendar__hint">{t('selectMonthHint')}</p>
    </>
  )

  const daysView = (
    <>
      <div className="date-calendar__nav">
        <button
          type="button"
          aria-label={t('previousMonth')}
          onClick={() => {
            const next = Math.max(firstMonth, visibleMonth - 1)
            setVisibleMonth(next)
            setVisibleYear(fromMonthKey(next).getFullYear())
          }}
          disabled={visibleMonth <= firstMonth}
        >
          ‹
        </button>
        <button
          className="date-calendar__month-toggle"
          type="button"
          aria-label={t('selectMonth')}
          onClick={() => {
            setVisibleYear(monthDate.getFullYear())
            setPickerMode('months')
          }}
        >
          {monthLabel}
        </button>
        <button
          type="button"
          aria-label={t('nextMonth')}
          onClick={() => {
            const next = Math.min(lastMonth, visibleMonth + 1)
            setVisibleMonth(next)
            setVisibleYear(fromMonthKey(next).getFullYear())
          }}
          disabled={visibleMonth >= lastMonth}
        >
          ›
        </button>
      </div>

      <div className="date-calendar__grid" role="grid" aria-label={monthLabel}>
        {weekdayLabels.map((weekday, index) => (
          <span className="date-calendar__weekday" key={`${weekday}-${index}`} aria-hidden="true">
            {weekday}
          </span>
        ))}
        {Array.from({ length: leadingDays }, (_, index) => (
          <span key={`empty-${index}`} aria-hidden="true" />
        ))}
        {Array.from({ length: daysInMonth }, (_, index) => {
          const day = index + 1
          const officialDate = toOfficial(day, monthDate.getMonth(), monthDate.getFullYear())
          const enabled = available.has(officialDate)
          const isSelected = officialDate === selectedDate
          return (
            <button
              className={isSelected ? 'is-selected' : undefined}
              type="button"
              role="gridcell"
              key={officialDate}
              disabled={!enabled}
              aria-selected={isSelected}
              aria-label={officialDate}
              onClick={() => chooseDay(officialDate)}
            >
              {day}
            </button>
          )
        })}
      </div>
      <p className="date-calendar__hint">{t('calendarAvailableHint')}</p>
    </>
  )

  return (
    <div
      className={compact ? 'date-picker date-picker--compact' : 'shell glass date-browser date-picker'}
      id={id}
      ref={rootRef}
      aria-label={heading}
    >
      {!compact ? (
        <div className="date-browser__heading">
          <strong>{heading}</strong>
          <span>{t('availableDateCount', { n: availableDates.length })}</span>
        </div>
      ) : null}

      <div className={`date-picker__summary${compact ? '' : ' date-picker__summary--board'}`}>
        <div>
          <label>{compact ? heading : t('rateDate')}</label>
          <strong>{displayDate}</strong>
          {selectedDate ? <span>{selectedDate}</span> : null}
        </div>
        <button
          className={compact ? 'btn btn-ghost' : 'btn btn-gold'}
          type="button"
          aria-expanded={open}
          onClick={() => (open ? setOpen(false) : openPicker())}
        >
          {open ? t('closeCalendar') : t('changeDate')}
        </button>
      </div>

      <div className={`date-calendar__collapse${open ? ' is-open' : ''}`}>
        <div className="date-calendar__collapse-inner" inert={!open}>
          <div className="date-calendar">{pickerMode === 'months' ? monthsView : daysView}</div>
        </div>
      </div>

      {!compact && archivedNotice ? <p className="date-browser__notice">{archivedNotice}</p> : null}
    </div>
  )
}
