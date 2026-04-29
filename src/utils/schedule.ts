import type { Dayjs } from 'dayjs'
import { resolveCampusFromBuilding, type Campus } from '../campusConfig'
import type {
  Language,
  LocalizedText,
  Course,
  RoomEntry,
  ScheduleResponse,
  TimelineEvent,
  FloorGroup,
} from '../types/schedule'

export const TRACK_START_HOUR = 8
export const TRACK_END_HOUR = 23
export const PIXELS_PER_MINUTE = 2
export const ROOM_ROW_HEIGHT = 126
export const EVENT_HEIGHT = 112

export function resolveLocalizedText(value: LocalizedText, language: Language) {
  if (!value) return ''
  if (typeof value === 'string') return value
  return value[language] || value.zh || value.en || value.de || Object.values(value)[0] || ''
}

export function resolveBuildingLabel(displayName: LocalizedText, language: Language, fallbackStreet: string) {
  return resolveLocalizedText(displayName, language) || fallbackStreet
}

export function resolveCampusName(street: string): Campus | null {
  return resolveCampusFromBuilding(street)
}

export function formatCampusOptionLabel(campus: Campus) {
  if (campus === 'Im Neuenheimer Feld') return 'INF'
  if (campus === 'Mannheim & Ludwigshafen') return 'Mannheim'
  return campus
}

export function normalizeFloorLabel(value: string | null | undefined) {
  const text = (value || '').trim()
  return text || 'Unknown floor'
}

export function floorSortValue(floor: string) {
  const normalized = floor.toLowerCase().trim()
  if (!normalized || normalized === 'unknown floor') return 99999
  if (/basement|untergeschoss|keller|\bug\b/.test(normalized)) {
    const m = normalized.match(/(\d+)/)
    return -100 - (m ? Number.parseInt(m[1], 10) : 1)
  }
  if (/ground|erdgeschoss|\beg\b/.test(normalized)) return 0
  if (/mezzanine|zwischen/.test(normalized)) return 0.5
  const og = normalized.match(/(\d+)\s*\.?\s*og/)
  if (og) return Number.parseInt(og[1], 10)
  const ord = normalized.match(/(-?\d+)\s*(st|nd|rd|th)?\s*(floor|level|stock|geschoss)?/)
  if (ord) return Number.parseInt(ord[1], 10)
  if (/attic|dach/.test(normalized)) return 9990
  return 9999
}

export function compareFloors(left: string, right: string) {
  const diff = floorSortValue(left) - floorSortValue(right)
  return diff !== 0 ? diff : left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' })
}

export function normalizeCampusValue(value: string | null | undefined): Campus | null {
  const text = (value || '').trim().toLowerCase()
  if (!text) return null
  if (text === 'altstadt') return 'Altstadt'
  if (text === 'bergheim') return 'Bergheim'
  if (text === 'im neuenheimer feld' || text === 'im-neuenheimer-feld') return 'Im Neuenheimer Feld'
  if (text === 'heidelberg') return 'Heidelberg'
  if (text === 'mannheim & ludwigshafen' || text === 'mannheim-and-ludwigshafen') return 'Mannheim & Ludwigshafen'
  if (text === 'online') return 'Online'
  if (text === 'other') return 'Other'
  return null
}

export function parseTimeToMinutes(time: string) {
  const [h, m] = time.split(':').map((v) => Number.parseInt(v, 10))
  if (Number.isNaN(h) || Number.isNaN(m)) return NaN
  return h * 60 + m
}

export function formatMinutesToTime(total: number) {
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

export function normalizeScheduleResponse(raw: ScheduleResponse): ScheduleResponse {
  const roomGroups: Record<string, RoomEntry[]> = {}

  Object.entries(raw.rooms || {}).forEach(([street, entries]) => {
    if (street.toLowerCase() === 'online') {
      const allCourses = (entries || []).flatMap((e) => e.courses || [])
      const sorted = [...allCourses].sort((a, b) => {
        const sa = parseTimeToMinutes((a.time || '').split('-')[0]) || 0
        const sb = parseTimeToMinutes((b.time || '').split('-')[0]) || 0
        return sa - sb
      })
      const tracks: { end: number; courses: Course[] }[] = []
      for (const course of sorted) {
        const start = parseTimeToMinutes((course.time || '').split('-')[0])
        const end = parseTimeToMinutes((course.time || '').split('-')[1])
        if (Number.isNaN(start) || Number.isNaN(end)) {
          if (tracks.length === 0) tracks.push({ end: 0, courses: [] })
          tracks[0].courses.push(course)
          continue
        }
        let placed = false
        for (const track of tracks) {
          if (start >= track.end) { track.courses.push(course); track.end = end; placed = true; break }
        }
        if (!placed) tracks.push({ end, courses: [course] })
      }
      roomGroups[street] = tracks.map((track, i) => ({
        room: `Online ${i + 1}`,
        floor: 'Virtual Spaces',
        features: null,
        courses: track.courses,
      }))
    } else {
      roomGroups[street] = (entries || []).map((entry) => ({
        room: entry.room,
        displayName: (entry as RoomEntry).displayName || null,
        floor: normalizeFloorLabel(entry.floor),
        features: entry.features || null,
        courses: entry.courses || [],
      }))
    }
  })

  const fallbackBuildings = Object.keys(roomGroups).map((street) => ({
    id: street, street, displayName: street,
    campus: (resolveCampusName(street) || 'Other') as Campus,
  }))
  const seen = new Set<string>()
  const normalizedBuildings = (raw.buildings && raw.buildings.length > 0 ? raw.buildings : fallbackBuildings)
    .map((b) => {
      const street = b.id || resolveLocalizedText(b.street, 'en') || 'Unknown'
      return {
        id: street,
        street,
        displayName: resolveLocalizedText(b.displayName, 'en') || street,
        campus: normalizeCampusValue(b.campus) || resolveCampusName(street) || (street.toLowerCase() === 'online' ? 'Online' : 'Other'),
      }
    })
    .filter((b) => {
      if (seen.has(b.id)) return false
      seen.add(b.id)
      return true
    })
  return { buildings: normalizedBuildings, rooms: roomGroups, lastSyncTime: raw.lastSyncTime }
}

export function toIsoDate(d: Dayjs) {
  return d.format('YYYY-MM-DD')
}

export function getVisibleRoomCourses(room: RoomEntry, query: string, language: Language) {
  if (!query) return room.courses
  return room.courses.filter((course) => {
    const name = resolveLocalizedText(course.name, language).toLowerCase()
    const prof = resolveLocalizedText(course.prof, language).toLowerCase()
    const note = (course.note || '').toLowerCase()
    return name.includes(query) || prof.includes(query) || note.includes(query)
  })
}

export function clusterEvents(events: TimelineEvent[]) {
  const clusters: TimelineEvent[][] = []
  const sorted = [...events].sort((l, r) => l.start - r.start)
  for (const event of sorted) {
    const cluster = clusters[clusters.length - 1]
    if (!cluster) { clusters.push([event]); continue }
    const clusterEnd = Math.max(...cluster.map((e) => e.end))
    if (event.start < clusterEnd) { cluster.push(event) } else { clusters.push([event]) }
  }
  return clusters
}

export async function fetchSchedule(date: string, cacheMode: RequestCache = 'default') {
  const res = await fetch(`/api/schedule?date=${date}`, { cache: cacheMode })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const ct = res.headers.get('content-type') || ''
  if (!ct.includes('application/json')) throw new Error(`Unexpected content type: ${ct || 'unknown'}`)
  return normalizeScheduleResponse((await res.json()) as ScheduleResponse)
}

export function groupRoomsByFloor(rooms: RoomEntry[]): FloorGroup[] {
  const floorMap = new Map<string, RoomEntry[]>()
  rooms.forEach((room) => {
    const floor = normalizeFloorLabel(room.floor)
    const bucket = floorMap.get(floor)
    if (bucket) bucket.push(room)
    else floorMap.set(floor, [room])
  })
  return Array.from(floorMap.entries())
    .sort((l, r) => compareFloors(l[0], r[0]))
    .map(([floor, floorRooms]) => ({
      floor,
      rooms: [...floorRooms].sort((a, b) => a.room.localeCompare(b.room, undefined, { numeric: true })),
    }))
}
