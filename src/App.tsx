import React from 'react'
import dayjs, { Dayjs } from 'dayjs'
import {
  Alert,
  ConfigProvider,
  DatePicker,
  Empty,
  Input,
  Layout,
  Modal,
  Row,
  Col,
  Select,
  Space,
  Spin,
  Typography,
  theme as antdTheme,
} from 'antd'
import {
  SearchOutlined,
} from '@ant-design/icons'
import DarkModeButton from './components/DarkModeButton/DarkModeButton'
import { CAMPUS_OPTIONS, resolveCampusFromBuilding, type Campus } from './campusConfig'
import LanguageToggle from './components/LanguageToggle/LanguageToggle'
import useStore from './store'

type Language = 'zh' | 'en' | 'de'

type LocalizedText = string | Record<string, string> | null | undefined

type RoomFeatures = {
  hasAirConditioning?: boolean | null
  hasAccessControl?: boolean | null
  hasProjector?: boolean | null
  hasMicrophone?: boolean | null
}

type Course = {
  time: string
  name: LocalizedText
  prof?: LocalizedText
  link?: string
  note?: string | null
}

type RoomEntry = {
  room: string
  floor?: string | null
  features?: RoomFeatures | null
  courses: Course[]
}

type BuildingEntry = {
  id: string
  street?: LocalizedText
  displayName?: LocalizedText
  campus?: Campus | null
}

type ScheduleResponse = {
  buildings: BuildingEntry[]
  rooms: Record<string, RoomEntry[]>
}

type CourseModalState = {
  room: string
  course: Course
  startMinutes: number
  endMinutes: number
}

type TimelineEvent = {
  course: Course
  start: number
  end: number
  startOffset: number
  endOffset: number
}

type FloorGroup = {
  floor: string
  rooms: RoomEntry[]
}

const UI_TEXT = {
  zh: {
    brand: 'heiView',
    subtitle: '',
    campusLabel: '校区',
    buildingLabel: '建筑',
    dateLabel: '日期',
    featureLabel: '教室条件',
    featureAll: '全部',
    featureAC: '有空调',
    featureAccess: '无门禁',
    searchLabel: '搜索',
    reloadLabel: '刷新',
    boardTitle: '课程时间轴',
    loading: '正在加载课程数据...',
    empty: '当前日期没有可显示的课程数据',
    ready: '已就绪',
    errorPrefix: '加载失败：',
    searchPlaceholder: '教室、课程或教师',
    selectedBuildingFallback: '未选择建筑',
    noteLabel: '备注：',
    reportError: '汇报错误',
  },
  en: {
    brand: 'heiView',
    subtitle: '',
    campusLabel: 'Campus',
    buildingLabel: 'Building',
    dateLabel: 'Date',
    featureLabel: 'Room Feature',
    featureAll: 'All',
    featureAC: 'Air conditioning',
    featureAccess: 'No access control',
    searchLabel: 'Search',
    reloadLabel: 'Refresh',
    boardTitle: 'Course timeline',
    loading: 'Loading course data...',
    empty: 'No course data is available for the selected date',
    ready: 'Ready',
    errorPrefix: 'Load failed: ',
    searchPlaceholder: 'Room, course, or Lecturer',
    selectedBuildingFallback: 'No building selected',
    noteLabel: 'Note: ',
    reportError: 'Report Error',
  },
  de: {
    brand: 'heiView',
    subtitle: '',
    campusLabel: 'Campus',
    buildingLabel: 'Gebäude',
    dateLabel: 'Datum',
    featureLabel: 'Raummerkmal',
    featureAll: 'Alle',
    featureAC: 'Klimaanlage',
    featureAccess: 'Keine Zutrittskontrolle',
    searchLabel: 'Suche',
    reloadLabel: 'Aktualisieren',
    boardTitle: 'Kurs-Zeitleiste',
    loading: 'Kursdaten werden geladen...',
    empty: 'Für das gewählte Datum sind keine Kurse verfügbar',
    ready: 'Bereit',
    errorPrefix: 'Fehler beim Laden: ',
    searchPlaceholder: 'Raum, Kurs oder Vortragende*r',
    selectedBuildingFallback: 'Kein Gebäude ausgewählt',
    noteLabel: 'Anmerkung: ',
    reportError: 'Fehler melden',
  },
} as const

const TRACK_START_HOUR = 8
const TRACK_END_HOUR = 23
const PIXELS_PER_MINUTE = 2
const ROOM_ROW_HEIGHT = 126
const EVENT_HEIGHT = 112

function resolveLocalizedText(value: LocalizedText, language: Language) {
  if (!value) return ''
  if (typeof value === 'string') return value
  return value[language] || value.zh || value.en || value.de || Object.values(value)[0] || ''
}

function resolveBuildingLabel(displayName: LocalizedText, language: Language, fallbackStreet: string) {
  const localized = resolveLocalizedText(displayName, language)
  return localized || fallbackStreet
}

function resolveCampusName(street: string): Campus | null {
  return resolveCampusFromBuilding(street)
}

function formatCampusOptionLabel(campus: Campus) {
  if (campus === 'Altstadt' || campus === 'Bergheim') {
    return `${campus} Campus`
  }
  return campus
}

function normalizeFloorLabel(value: string | null | undefined) {
  const text = (value || '').trim()
  return text || 'Unspecified floor'
}

function floorSortValue(floor: string) {
  const normalized = floor.toLowerCase().trim()
  if (!normalized || normalized === 'unspecified floor') return 99999

  if (/basement|untergeschoss|keller|\bug\b/.test(normalized)) {
    const depthMatch = normalized.match(/(\d+)/)
    const depth = depthMatch ? Number.parseInt(depthMatch[1], 10) : 1
    return -100 - depth
  }

  if (/ground|erdgeschoss|\beg\b/.test(normalized)) {
    return 0
  }

  if (/mezzanine|zwischen/.test(normalized)) {
    return 0.5
  }

  const dotOgMatch = normalized.match(/(\d+)\s*\.?\s*og/)
  if (dotOgMatch) {
    return Number.parseInt(dotOgMatch[1], 10)
  }

  const ordinalMatch = normalized.match(/(-?\d+)\s*(st|nd|rd|th)?\s*(floor|level|stock|geschoss)?/)
  if (ordinalMatch) {
    return Number.parseInt(ordinalMatch[1], 10)
  }

  if (/attic|dach/.test(normalized)) {
    return 9990
  }

  return 9999
}

function compareFloors(left: string, right: string) {
  const leftValue = floorSortValue(left)
  const rightValue = floorSortValue(right)
  if (leftValue !== rightValue) return leftValue - rightValue
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' })
}

function normalizeCampusValue(value: string | null | undefined): Campus | null {
  const text = (value || '').trim().toLowerCase()
  if (!text) return null
  if (text === 'altstadt') return 'Altstadt'
  if (text === 'bergheim') return 'Bergheim'
  if (text === 'im neuenheimer feld' || text === 'im-neuenheimer-feld') return 'Im Neuenheimer Feld'
  if (text === 'online') return 'Online'
  if (text === 'other') return 'Other'
  return null
}

function parseTimeToMinutes(time: string) {
  const [hours, minutes] = time.split(':').map((value) => Number.parseInt(value, 10))
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return NaN
  return hours * 60 + minutes
}

function formatMinutesToTime(totalMinutes: number) {
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

function normalizeScheduleResponse(raw: ScheduleResponse): ScheduleResponse {
  const roomGroups: Record<string, RoomEntry[]> = {}

  Object.entries(raw.rooms || {}).forEach(([street, entries]) => {
    if (street.toLowerCase() === 'online') {
      const allCourses = (entries || []).flatMap((e) => e.courses || [])
      const sorted = [...allCourses].sort((a, b) => {
        const startA = parseTimeToMinutes((a.time || '').split('-')[0]) || 0
        const startB = parseTimeToMinutes((b.time || '').split('-')[0]) || 0
        return startA - startB
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
          if (start >= track.end) {
            track.courses.push(course)
            track.end = end
            placed = true
            break
          }
        }
        if (!placed) {
          tracks.push({ end, courses: [course] })
        }
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
        floor: normalizeFloorLabel(entry.floor),
        features: entry.features || null,
        courses: entry.courses || [],
      }))
    }
  })

  const fallbackBuildings = Object.keys(roomGroups).map((street) => ({
    id: street,
    street,
    displayName: street,
    campus: resolveCampusName(street) || 'Other' as Campus,
  }))

  const normalizedBuildings = (raw.buildings && raw.buildings.length > 0 ? raw.buildings : fallbackBuildings)
    .map((building) => {
      const street = building.id || resolveLocalizedText(building.street, 'en') || 'Unknown'
      const displayName = resolveLocalizedText(building.displayName, 'en') || street
      return {
        id: street,
        street,
        displayName,
        campus: normalizeCampusValue(building.campus) || resolveCampusName(street) || (street.toLowerCase() === 'online' ? 'Online' : 'Other'),
      }
    })
    .filter((building, index, array) => array.findIndex((item) => item.id === building.id) === index)

  return {
    buildings: normalizedBuildings,
    rooms: roomGroups,
  }
}

function toIsoDate(value: Dayjs) {
  return value.format('YYYY-MM-DD')
}

function getVisibleRoomCourses(room: RoomEntry, query: string, language: Language) {
  if (!query) return room.courses
  return room.courses.filter((course) => {
    const courseName = resolveLocalizedText(course.name, language).toLowerCase()
    const professor = resolveLocalizedText(course.prof, language).toLowerCase()
    return courseName.includes(query) || professor.includes(query)
  })
}

function clusterEvents(events: TimelineEvent[]) {
  const clusters: TimelineEvent[][] = []
  const sorted = [...events].sort((left, right) => left.start - right.start)

  for (const event of sorted) {
    const cluster = clusters[clusters.length - 1]
    if (!cluster) {
      clusters.push([event])
      continue
    }

    const clusterEnd = Math.max(...cluster.map((item) => item.end))
    if (event.start < clusterEnd) {
      cluster.push(event)
    } else {
      clusters.push([event])
    }
  }

  return clusters
}

async function fetchSchedule(date: string) {
  const response = await fetch(`/api/schedule?date=${date}`, {
    cache: 'no-store',
  })

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`)
  }

  const contentType = response.headers.get('content-type') || ''
  if (!contentType.includes('application/json')) {
    throw new Error(`Unexpected content type: ${contentType || 'unknown'}`)
  }

  const payload = (await response.json()) as ScheduleResponse
  return normalizeScheduleResponse(payload)
}

function App() {
  const language = useStore((state) => state.language)
  const theme = useStore((state) => state.theme)
  const text = UI_TEXT[language] || UI_TEXT.zh

  const [schedule, setSchedule] = React.useState<ScheduleResponse | null>(null)
  const [selectedCampus, setSelectedCampus] = React.useState<Campus>('Altstadt')
  const [selectedBuilding, setSelectedBuilding] = React.useState<string>('')
  const [selectedDate, setSelectedDate] = React.useState<Dayjs>(() => dayjs())
  const [search, setSearch] = React.useState('')
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [selectedCourse, setSelectedCourse] = React.useState<CourseModalState | null>(null)

  React.useEffect(() => {
    let alive = true

    const run = async () => {
      setLoading(true)
      setError(null)

      try {
        const data = await fetchSchedule(toIsoDate(selectedDate))
        if (!alive) return

        setSchedule(data)

        let firstBuilding = '';
        if (selectedCampus === 'Other') {
          const unknownBuilding = data.buildings.find(b => b.id === 'Unknown' && (normalizeCampusValue(b.campus) || resolveCampusName(resolveLocalizedText(b.street, language) || b.id) || 'Other') === 'Other');
          if (unknownBuilding) firstBuilding = unknownBuilding.id;
        }
        if (!firstBuilding) {
          firstBuilding = data.buildings.find((building) => {
            const street = resolveLocalizedText(building.street, language) || building.id
            const campus = normalizeCampusValue(building.campus) || resolveCampusName(street) || 'Other'
            return campus === selectedCampus
          })?.id || ''
        }
        setSelectedBuilding((current) => {
          if (current && data.buildings.some((building) => building.id === current)) {
            return current
          }
          return firstBuilding
        })
      } catch (loadError) {
        if (!alive) return
        setSchedule(null)
        setError(loadError instanceof Error ? loadError.message : String(loadError))
      } finally {
        if (alive) setLoading(false)
      }
    }

    void run()

    return () => {
      alive = false
    }
  }, [selectedDate, language])

  const buildingOptions = React.useMemo(
    () =>
      (schedule?.buildings || []).map((building) => ({
        value: building.id,
        label: resolveBuildingLabel(building.displayName, language, resolveLocalizedText(building.street, language) || building.id),
        campus: normalizeCampusValue(building.campus) || resolveCampusName(resolveLocalizedText(building.street, language) || building.id) || 'Other',
      })),
    [language, schedule],
  )

  const filteredBuildingOptions = React.useMemo(() => {
    const list = buildingOptions.filter((building) => building.campus === selectedCampus)
    return list.sort((a, b) => {
      const aUnknown = a.value.toLowerCase() === 'unknown' || String(a.label).toLowerCase() === 'unknown'
      const bUnknown = b.value.toLowerCase() === 'unknown' || String(b.label).toLowerCase() === 'unknown'
      if (aUnknown && !bUnknown) return -1
      if (!aUnknown && bUnknown) return 1
      return 0
    })
  }, [buildingOptions, selectedCampus])

  const activeBuildingId = React.useMemo(() => {
    if (selectedBuilding && filteredBuildingOptions.some((option) => option.value === selectedBuilding)) {
      return selectedBuilding
    }
    if (selectedCampus === 'Other') {
      const unknownOp = filteredBuildingOptions.find((op) => op.value === 'Unknown' || op.label.toLowerCase() === 'unknown')
      if (unknownOp) return unknownOp.value
    }
    return filteredBuildingOptions[0]?.value || ''
  }, [filteredBuildingOptions, selectedBuilding, selectedCampus])

  React.useEffect(() => {
    if (filteredBuildingOptions.length === 0) return
    if (!filteredBuildingOptions.some((option) => option.value === selectedBuilding)) {
      if (selectedCampus === 'Other') {
        const unknownOp = filteredBuildingOptions.find((op) => op.value === 'Unknown' || String(op.label).toLowerCase() === 'unknown')
        if (unknownOp) {
          setSelectedBuilding(unknownOp.value)
          return
        }
      }
      setSelectedBuilding(filteredBuildingOptions[0].value)
    }
  }, [filteredBuildingOptions, selectedBuilding, selectedCampus])

  const visibleRooms = React.useMemo(() => {
    const rooms = (schedule?.rooms[activeBuildingId] || []).filter((room) => room.room)

    const query = search.trim().toLowerCase()
    if (!query) return rooms
    return rooms.filter((room) => {
      if (room.room.toLowerCase().includes(query)) return true
      return getVisibleRoomCourses(room, query, language).length > 0
    })
  }, [activeBuildingId, language, schedule, search])

  const visibleRoomGroups = React.useMemo<FloorGroup[]>(() => {
    const floorMap = new Map<string, RoomEntry[]>()

    visibleRooms.forEach((room) => {
      const floor = normalizeFloorLabel(room.floor)
      const bucket = floorMap.get(floor)
      if (bucket) {
        bucket.push(room)
      } else {
        floorMap.set(floor, [room])
      }
    })

    return Array.from(floorMap.entries())
      .sort((left, right) => compareFloors(left[0], right[0]))
      .map(([floor, rooms]) => ({
        floor,
        rooms: [...rooms].sort((left, right) => left.room.localeCompare(right.room, undefined, { numeric: true })),
      }))
  }, [visibleRooms])

  const appTheme = React.useMemo(
    () => ({
      algorithm: theme === 'dark' ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
      token: {
        colorPrimary: theme === 'dark' ? '#7ab2ff' : '#0f62fe',
        borderRadius: 16,
        fontFamily: 'Manrope, "Noto Sans SC", "PingFang SC", sans-serif',
      },
    }),
    [theme],
  )

  const timelineMinWidth = 120 + (TRACK_END_HOUR - TRACK_START_HOUR) * 60 * PIXELS_PER_MINUTE

  return (
    <ConfigProvider theme={appTheme}>
      <Layout className="hei-layout">
        <div className="hei-orb hei-orb-a" />
        <div className="hei-orb hei-orb-b" />

        <Layout.Content className="hei-content">
          <header className="hei-topbar">
            <div className="hei-topbar-inner">
              <div className="hei-brand-cluster">
                <div className="hei-brand-row">
                  <a href="/" style={{ display: 'flex', alignItems: 'center' }}>
                    <img src="/heiView_logo.png" alt={text.brand} className="hei-brand-logo" />
                  </a>
                </div>
                <Space size={8} align="center" className="hei-topbar-campus-wrap">
                  <Select
                    size="large"
                    value={selectedCampus}
                    options={CAMPUS_OPTIONS.map((campus) => ({
                      value: campus,
                      label: formatCampusOptionLabel(campus),
                    }))}
                    popupMatchSelectWidth={false}
                    popupClassName="hei-campus-dropdown"
                    onChange={(value) => setSelectedCampus(value as Campus)}
                    className="hei-topbar-campus"
                  />
                </Space>
              </div>

              <div className="hei-topbar-center">
                <DatePicker
                  size="large"
                  allowClear={false}
                  value={selectedDate}
                  onChange={(value) => setSelectedDate(value || dayjs())}
                  className="hei-topbar-date"
                />
              </div>

              <Space size="middle" wrap align="center" className="hei-toolbar-actions">
                <DarkModeButton className="hei-toolbar-icon-button" />
                <LanguageToggle className="hei-toolbar-segmented" />
                <Input
                  size="large"
                  allowClear
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder={text.searchPlaceholder}
                  suffix={<SearchOutlined className="hei-toolbar-search-icon" />}
                  className="hei-toolbar-search"
                />
              </Space>
            </div>
          </header>

          <div className="hei-shell">
            {error && <Alert type="error" showIcon className="hei-error" message={`${text.errorPrefix}${error}`} />}

            <section className="hei-board-card">
            <div className="hei-board-controls">
              <Row gutter={[16, 16]} align="middle">
                <Col xs={24} sm={24} lg={12}>
                  <Space direction="horizontal" size={12} align="center" className="hei-control-group hei-control-inline">
                    <Select
                      size="large"
                      value={activeBuildingId || undefined}
                      placeholder={text.selectedBuildingFallback}
                      options={filteredBuildingOptions.map(({ campus, ...option }) => option)}
                      popupMatchSelectWidth={false}
                      onChange={(value) => setSelectedBuilding(value)}
                      disabled={filteredBuildingOptions.length === 0}
                      className="hei-control-select"
                      style={{ width: 335 }}
                      virtual={false}
                      listHeight={500}
                      popupClassName="hei-building-dropdown-multi"
                    />
                  </Space>
                </Col>
              </Row>
            </div>

            <div className="hei-board-controls-divider" />

            <div className="hei-board-frame">
              {loading ? (
                <div className="hei-board-loading">
                  <Spin size="large" />
                  <Typography.Text type="secondary">{text.loading}</Typography.Text>
                </div>
              ) : activeBuildingId === 'No Information' ? (
                <div className="hei-no-info-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '16px', padding: '16px' }}>
                  {(() => {
                    const allCourses = visibleRoomGroups.flatMap(g => g.rooms.flatMap(r => getVisibleRoomCourses(r, search.trim().toLowerCase(), language)));
                    return allCourses.map((event, idx) => (
                      <div
                        key={idx}
                        className="hei-event"
                        style={{ position: 'relative', width: '100%', height: '140px', padding: '12px', cursor: 'pointer', overflow: 'hidden' }}
                        onClick={() => setSelectedCourse({ room: 'No Information', course: event, startMinutes: 0, endMinutes: 0 })}
                      >
                        <span className="hei-event-title" style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', whiteSpace: 'normal' }}>{resolveLocalizedText(event.name, language)}</span>
                        <span className="hei-event-meta" style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', whiteSpace: 'normal' }}>{resolveLocalizedText(event.prof, language) || '—'}</span>
                        {event.note && (
                          <div style={{ marginTop: 8, fontSize: 12, opacity: 0.8, whiteSpace: 'normal', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                             {event.note.slice(0, 100)}{event.note.length > 100 ? '...' : ''}
                          </div>
                        )}
                      </div>
                    ));
                  })()}
                </div>
              ) : visibleRoomGroups.length > 0 ? (
                <div
                  className="hei-timetable"
                  role="table"
                  aria-label={text.boardTitle}
                  style={{ width: `max(100%, ${timelineMinWidth}px)` }}
                >
                  <div className="hei-timetable-head">
                    <div className="hei-timetable-head-label" />
                    <div className="hei-timetable-head-track">
                      {Array.from({ length: TRACK_END_HOUR - TRACK_START_HOUR + 1 }, (_, index) => TRACK_START_HOUR + index).map((hour) => {
                        if (hour > 22) return null
                        const left = (hour - TRACK_START_HOUR) * 60 * PIXELS_PER_MINUTE
                        return (
                          <div key={hour} className="hei-hour-label" style={{ left }}>
                            {String(hour).padStart(2, '0')}:00
                          </div>
                        )
                      })}
                    </div>
                  </div>

                  <div className="hei-timetable-body">
                    {visibleRoomGroups.map((group) => (
                      <div key={`floor-${group.floor}`} className="hei-floor-group">
                        <div className="hei-floor-header">{group.floor}</div>
                        {group.rooms.map((room) => {
                          const visibleCourses = getVisibleRoomCourses(room, search.trim().toLowerCase(), language)
                          const parsedEvents = visibleCourses
                            .map<TimelineEvent | null>((course) => {
                              const [startText, endText] = course.time.split('-')
                              const start = parseTimeToMinutes(startText)
                              const end = parseTimeToMinutes(endText)
                              if (Number.isNaN(start) || Number.isNaN(end)) return null
                              const startOffset = Math.max(0, start - TRACK_START_HOUR * 60)
                              const endOffset = Math.min((TRACK_END_HOUR - TRACK_START_HOUR) * 60, end - TRACK_START_HOUR * 60)
                              return {
                                course,
                                start,
                                end,
                                startOffset,
                                endOffset,
                              }
                            })
                            .filter((event): event is TimelineEvent => event !== null)

                          const clusters = clusterEvents(parsedEvents)

                          return (
                            <div key={`${group.floor}-${room.room}`} className="hei-room-row" style={{ minHeight: ROOM_ROW_HEIGHT }}>
                              <div className="hei-room-label">
                                <span>{room.room.replace(/\s*\/\s*/g, ' / ')}</span>
                              </div>

                              <div className="hei-room-track" style={{ minHeight: ROOM_ROW_HEIGHT }}>
                                {Array.from({ length: TRACK_END_HOUR - TRACK_START_HOUR + 1 }, (_, index) => index).map((index) => (
                                  <div
                                    key={index}
                                    className="hei-grid-line"
                                    style={{ left: index * 60 * PIXELS_PER_MINUTE }}
                                  />
                                ))}

                                {clusters.flatMap((cluster, clusterIndex) => {
                                  const columns: TimelineEvent[][] = []

                                  cluster.forEach((event) => {
                                    let placed = false
                                    for (const column of columns) {
                                      const lastEvent = column[column.length - 1]
                                      if (lastEvent.end <= event.start) {
                                        column.push(event)
                                        placed = true
                                        break
                                      }
                                    }

                                    if (!placed) {
                                      columns.push([event])
                                    }
                                  })

                                  return cluster.map((event) => {
                                    const columnIndex = columns.findIndex((column) => column.includes(event))
                                    const columnCount = Math.max(1, columns.length)
                                    const durationPx = Math.max(30, (event.endOffset - event.startOffset) * PIXELS_PER_MINUTE)
                                    const slotWidth = Math.max(24, Math.floor(durationPx / columnCount) - 6)
                                    const left = event.startOffset * PIXELS_PER_MINUTE + columnIndex * slotWidth
                                    const top = 7 + columnIndex * 4
                                    const professor = resolveLocalizedText(event.course.prof, language)
                                    const courseName = resolveLocalizedText(event.course.name, language) || 'Untitled'

                                    return (
                                      <button
                                        key={`${room.room}-${clusterIndex}-${event.start}-${event.end}-${courseName}`}
                                        type="button"
                                        className="hei-event"
                                        style={{ left, top, width: slotWidth, height: EVENT_HEIGHT }}
                                        onClick={() => setSelectedCourse({ room: room.room, course: event.course, startMinutes: event.start, endMinutes: event.end })}
                                      >
                                        <span className="hei-event-title">{courseName}</span>
                                        <span className="hei-event-meta">{professor || '—'}</span>
                                        <span className="hei-event-time">
                                          {formatMinutesToTime(event.start)} - {formatMinutesToTime(event.end)}
                                        </span>
                                      </button>
                                    )
                                  })
                                })}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="hei-empty-state">
                  <Empty description={text.empty} />
                </div>
              )}
            </div>
            </section>
          </div>
        </Layout.Content>

        <Layout.Footer className="hei-footer">
          <div className="hei-footer-inner">
            <div className="hei-footer-content">
              <div className="hei-footer-section hei-footer-brand">
                  <img src="/heiView_logo.png" alt={text.brand} className="hei-footer-logo" />
                <ul>
                  <li className="hei-footer-copyright">
                    © 2026
                  </li>
                </ul>
              </div>

              <div className="hei-footer-section">
                <h4>Support</h4>
                <ul>
                  <li><a href="#faq">FAQ</a></li>
                  <li><a href="#feedback">Feedback</a></li>
                  <li><a href="#privacy">Privacy Policy</a></li>
                </ul>
              </div>

              <div className="hei-footer-section">
                <h4>Developers</h4>
                <ul>
                  <li><a href="https://github.com/hitable" target="_blank" rel="noreferrer">GitHub</a></li>
                </ul>
              </div>

              <div className="hei-footer-section">
                <h4>About</h4>
                <ul>
                  <li><a href="#team">Team</a></li>
                  <li><a href="#joinus">Join Us</a></li>
                  <li><a href="#contact">Contact</a></li>
                </ul>
              </div>
            </div>
          </div>
        </Layout.Footer>

        <Modal
          open={selectedCourse !== null}
          onCancel={() => setSelectedCourse(null)}
          footer={null}
          title={
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingRight: '32px' }}>
              <span style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', whiteSpace: 'normal', wordBreak: 'break-word', paddingRight: 8 }}>
                {selectedCourse ? resolveLocalizedText(selectedCourse.course.name, language) : ''}
              </span>
              {selectedCourse && (
                <div
                  className="report-error-btn"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    padding: '2px 8px',
                    color: '#ff4d4f',
                    backgroundColor: 'transparent',
                    border: '1px solid #ff4d4f',
                    borderRadius: '4px',
                    fontWeight: 500,
                    fontSize: '12px',
                    whiteSpace: 'nowrap',
                    flexShrink: 0,
                    cursor: 'pointer',
                    userSelect: 'none'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = '#fff1f0';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = 'transparent';
                  }}
                  onClick={(e) => {
                    // Email feature temporarily removed per user request
                    e.preventDefault();
                  }}
                >
                  {text.reportError}
                </div>
              )}
            </div>
          }
          destroyOnClose
        >
          {selectedCourse && (
            <Space direction="vertical" size="middle" style={{ width: '100%' }}>
              <div className="hei-modal-summary">
                <Space direction="vertical" size={8} style={{ width: '100%' }}>
                  <Typography.Text strong>
                    {selectedCourse.room} · {formatMinutesToTime(selectedCourse.startMinutes)} - {formatMinutesToTime(selectedCourse.endMinutes)}
                  </Typography.Text>
                  <Typography.Text type="secondary">
                    {resolveLocalizedText(selectedCourse.course.prof, language) || '—'}
                  </Typography.Text>
                  {selectedCourse.course.note && (
                    <Typography.Text type="secondary" style={{ whiteSpace: 'pre-wrap', marginTop: 8, display: 'block' }}>
                      <span style={{ fontWeight: 'normal', color: 'var(--hei-text)' }}>{text.noteLabel}</span> {selectedCourse.course.note}
                    </Typography.Text>
                  )}
                </Space>
              </div>

              {selectedCourse.course.link ? (
                <a href={selectedCourse.course.link} target="_blank" rel="noreferrer">
                  {selectedCourse.course.link}
                </a>
              ) : (
                <Typography.Text type="secondary">No course link provided.</Typography.Text>
              )}
            </Space>
          )}
        </Modal>
      </Layout>
    </ConfigProvider>
  )
}

export default App
