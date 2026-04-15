import type { Campus } from '../campusConfig'

export type Language = 'zh' | 'en' | 'de'

export type LocalizedText = string | Record<string, string> | null | undefined

export type RoomFeatures = {
  hasAirConditioning?: boolean | null
  hasAccessControl?: boolean | null
  hasProjector?: boolean | null
  hasMicrophone?: boolean | null
}

export type Course = {
  id?: string
  time: string
  name: LocalizedText
  prof?: LocalizedText
  link?: string
  note?: string | null
  start_date?: string | null
  end_date?: string | null
}

export type CourseSlot = {
  start_time: string
  end_time: string
  room: string
  building_name: string | null
  first_date: string
  last_date: string
}

export type RoomEntry = {
  room: string
  displayName?: string | null
  floor?: string | null
  features?: RoomFeatures | null
  courses: Course[]
}

export type BuildingEntry = {
  id: string
  street?: LocalizedText
  displayName?: LocalizedText
  campus?: Campus | null
}

export type ScheduleResponse = {
  buildings: BuildingEntry[]
  rooms: Record<string, RoomEntry[]>
}

export type CourseModalState = {
  room: string
  course: Course
  startMinutes: number
  endMinutes: number
  dayOfWeek?: number
  buildingId?: string
  buildingLabel?: string
  targetDate?: string | null
}

export type TimelineEvent = {
  course: Course
  start: number
  end: number
  startOffset: number
  endOffset: number
}

export type FloorGroup = {
  floor: string
  rooms: RoomEntry[]
}

export type SearchResult = {
  course: Course
  room: string
  roomDisplayName: string
  buildingId: string
  buildingLabel: string
  startMinutes: number
  endMinutes: number
  hasValidTime: boolean
  targetDate?: string | null
}
