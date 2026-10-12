import config from '../../config/semesters.json'

export function berlinToday(): string {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: config.timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date())
  const get = (type: string) => parts.find(part => part.type === type)?.value || ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T12:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}

export function semesterForDate(value: string): string {
  if (!isCalendarDate(value)) throw new Error('Invalid calendar date')
  const year = Number(value.slice(0, 4))
  const month = Number(value.slice(5, 7))
  if (month < config.summerStartMonth) return `${year - 1}WS`
  return `${year}${month < config.winterStartMonth ? 'SS' : 'WS'}`
}

export function initialDate(search: string): string {
  const requested = new URLSearchParams(search).get('date')
  return requested && isCalendarDate(requested) ? requested : berlinToday()
}

export function semesterUrl(url: string, semester: string): string {
  return `${url}${url.includes('?') ? '&' : '?'}semester=${encodeURIComponent(semester)}`
}
