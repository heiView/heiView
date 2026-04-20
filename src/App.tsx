import React from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import dayjs, { Dayjs } from 'dayjs'
import {
  Alert,
  Button,
  ConfigProvider,
  DatePicker,
  Divider,
  Empty,
  Input,
  Layout,
  Modal,
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
import { CAMPUS_OPTIONS, type Campus } from './campusConfig'
import useStore from './store'
import type {
  Language,
  LocalizedText,
  Course,
  CourseSlot,
  RoomEntry,
  ScheduleResponse,
  CourseModalState,
  TimelineEvent,
  FloorGroup,
  SearchResult,
} from './types/schedule'
import {
  TRACK_START_HOUR,
  TRACK_END_HOUR,
  PIXELS_PER_MINUTE,
  ROOM_ROW_HEIGHT,
  EVENT_HEIGHT,
  resolveLocalizedText,
  resolveBuildingLabel,
  resolveCampusName,
  formatCampusOptionLabel,
  normalizeFloorLabel,
  compareFloors,
  normalizeCampusValue,
  parseTimeToMinutes,
  formatMinutesToTime,
  normalizeScheduleResponse,
  toIsoDate,
  getVisibleRoomCourses,
  clusterEvents,
  fetchSchedule,
  groupRoomsByFloor,
} from './utils/schedule'

const UI_TEXT = {
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
  boardTitle: 'Course Timeline',
  loading: 'Loading course data...',
  empty: 'No course data is available for the selected date',
  ready: 'Ready',
  errorPrefix: 'Load failed: ',
  searchPlaceholder: 'Course or instructor',
  selectedBuildingFallback: 'No building selected',
  noteLabel: 'Note: ',
  reportError: 'Report Error',
  addToCalendar: 'Add to Calendar',
  downloadIcs: 'Download .ics',
  searchResultsEmpty: 'No courses match your search',
  viewInTimetable: 'View in timetable',
} as const

function toGoogleCalendarUrl(name: string, room: string, dateStr: string, startMin: number, endMin: number, prof: string, link: string, endDate?: string | null) {
  const pad = (n: number) => String(n).padStart(2, '0')
  const start = `${pad(Math.floor(startMin / 60))}${pad(startMin % 60)}00`
  const end = `${pad(Math.floor(endMin / 60))}${pad(endMin % 60)}00`
  const d = dateStr.replace(/-/g, '')
  const details = [prof, link].filter(Boolean).join('\n')
  // If endDate differs from dateStr, mark as recurring weekly until endDate (Google Calendar uses RRULE via recur param)
  const isRecurring = endDate && endDate !== dateStr
  const recur = isRecurring ? `RRULE:FREQ=WEEKLY;UNTIL=${endDate!.replace(/-/g, '')}T235959Z` : undefined
  const params = new URLSearchParams({ action: 'TEMPLATE', text: name, dates: `${d}T${start}/${d}T${end}`, ctz: 'Europe/Berlin', location: room, details })
  if (recur) params.set('recur', recur)
  return `https://calendar.google.com/calendar/render?${params}`
}

function downloadIcsFile(name: string, room: string, dateStr: string, startMin: number, endMin: number, prof: string, endDate?: string | null) {
  const pad = (n: number) => String(n).padStart(2, '0')
  const d = dateStr.replace(/-/g, '')
  const start = `${d}T${pad(Math.floor(startMin / 60))}${pad(startMin % 60)}00`
  const end = `${d}T${pad(Math.floor(endMin / 60))}${pad(endMin % 60)}00`
  const escape = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n')
  const isRecurring = endDate && endDate !== dateStr
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//heiView//heiView//EN',
    'BEGIN:VEVENT',
    `DTSTART;TZID=Europe/Berlin:${start}`,
    `DTEND;TZID=Europe/Berlin:${end}`,
    `SUMMARY:${escape(name)}`,
    `LOCATION:${escape(room)}`,
    prof ? `DESCRIPTION:${escape(prof)}` : '',
    isRecurring ? `RRULE:FREQ=WEEKLY;UNTIL=${endDate!.replace(/-/g, '')}T235959Z` : '',
    'END:VEVENT', 'END:VCALENDAR',
  ].filter(Boolean).join('\r\n')
  const blob = new Blob([lines], { type: 'text/calendar;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${name.replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '_').slice(0, 50)}.ics`
  document.body.appendChild(a); a.click(); document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

function downloadMultiSlotIcsFile(name: string, prof: string, slots: CourseSlot[]) {
  const pad = (n: number) => String(n).padStart(2, '0')
  const escape = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n')
  const vevents = slots.map(slot => {
    const startMin = parseTimeToMinutes(slot.start_time)
    const endMin = parseTimeToMinutes(slot.end_time)
    const d = slot.first_date.replace(/-/g, '')
    const start = `${d}T${pad(Math.floor(startMin / 60))}${pad(startMin % 60)}00`
    const end = `${d}T${pad(Math.floor(endMin / 60))}${pad(endMin % 60)}00`
    const isRecurring = slot.last_date !== slot.first_date
    return [
      'BEGIN:VEVENT',
      `DTSTART;TZID=Europe/Berlin:${start}`,
      `DTEND;TZID=Europe/Berlin:${end}`,
      `SUMMARY:${escape(name)}`,
      `LOCATION:${escape(slot.room)}`,
      prof ? `DESCRIPTION:${escape(prof)}` : null,
      isRecurring ? `RRULE:FREQ=WEEKLY;UNTIL=${slot.last_date.replace(/-/g, '')}T235959Z` : null,
      'END:VEVENT',
    ].filter(Boolean).join('\r\n')
  })
  const content = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//heiView//heiView//EN', ...vevents, 'END:VCALENDAR'].join('\r\n')
  const blob = new Blob([content], { type: 'text/calendar;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${name.replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '_').slice(0, 50)}.ics`
  document.body.appendChild(a); a.click(); document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

function App() {
  const location = useLocation()
  const navigate = useNavigate()
  const buildingFromUrl = location.pathname === '/' ? '' : decodeURIComponent(location.pathname.slice(1))
  const theme = useStore((state) => state.theme)
  const language: Language = 'en'
  const text = UI_TEXT

  const [schedule, setSchedule] = React.useState<ScheduleResponse | null>(null)
  const [selectedCampus, setSelectedCampus] = React.useState<Campus>('Altstadt')
  const [selectedBuilding, setSelectedBuilding] = React.useState<string>(() => buildingFromUrl)
  const [selectedDate, setSelectedDate] = React.useState<Dayjs>(() => dayjs())
  const [search, setSearch] = React.useState('')
  const deferredSearch = React.useDeferredValue(search)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [selectedCourse, setSelectedCourse] = React.useState<CourseModalState | null>(null)
  const [courseSlots, setCourseSlots] = React.useState<CourseSlot[]>([])
  const [courseSlotsFetching, setCourseSlotsFetching] = React.useState(false)
  const [searchResults, setSearchResults] = React.useState<SearchResult[]>([])
  const [searchLoading, setSearchLoading] = React.useState(false)
  const [nowMinutes, setNowMinutes] = React.useState(() => {
    const n = dayjs()
    return n.hour() * 60 + n.minute()
  })

  const initializedRef = React.useRef(false)
  const campusSyncedRef = React.useRef(false)
  const headerScrollRef = React.useRef<HTMLDivElement>(null)
  const bodyScrollRef = React.useRef<HTMLDivElement>(null)
  const topbarRef = React.useRef<HTMLElement>(null)

  React.useEffect(() => {
    const update = () => {
      const n = dayjs()
      setNowMinutes(n.hour() * 60 + n.minute())
    }
    const id = setInterval(update, 60_000)
    return () => clearInterval(id)
  }, [])

  React.useEffect(() => {
    const el = topbarRef.current
    if (!el) return
    const update = () => {
      document.documentElement.style.setProperty('--topbar-h', el.clientHeight + 'px')
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const handleHeaderScroll = (e: React.UIEvent<HTMLDivElement>) => {
    if (bodyScrollRef.current && bodyScrollRef.current.scrollLeft !== (e.target as HTMLDivElement).scrollLeft) {
      bodyScrollRef.current.scrollLeft = (e.target as HTMLDivElement).scrollLeft;
    }
  }

  const handleBodyScroll = (e: React.UIEvent<HTMLDivElement>) => {
    if (headerScrollRef.current && headerScrollRef.current.scrollLeft !== (e.target as HTMLDivElement).scrollLeft) {
      headerScrollRef.current.scrollLeft = (e.target as HTMLDivElement).scrollLeft;
    }
  }

  React.useEffect(() => {
    if (buildingFromUrl) {
      setSelectedBuilding(buildingFromUrl)
    }
  }, [buildingFromUrl])

  React.useEffect(() => {
    if (!schedule || !selectedBuilding) return

    const selectedBuildingData = schedule.buildings.find((b) => b.id === selectedBuilding)
    if (!selectedBuildingData) return

    const street = resolveLocalizedText(selectedBuildingData.street, language) || selectedBuildingData.id
    const buildingCampus = normalizeCampusValue(selectedBuildingData.campus) || resolveCampusName(street) || 'Other'

    campusSyncedRef.current = true
    setSelectedCampus(buildingCampus as Campus)
  }, [selectedBuilding, schedule, language])

  React.useEffect(() => {
    if (!initializedRef.current) {
      initializedRef.current = true
      return
    }

    if (selectedBuilding) {
      navigate('/' + encodeURIComponent(selectedBuilding), { replace: true })
    } else {
      navigate('/', { replace: true })
    }
  }, [selectedBuilding, navigate])

  React.useEffect(() => {
    let alive = true

    const run = async () => {
      setLoading(true)
      setError(null)

      try {
        const data = await fetchSchedule(toIsoDate(selectedDate))
        if (!alive) return

        setSchedule(data)
        
        setSelectedBuilding((current) => {
          if (current) {
            if (data.buildings.some((building) => building.id === current)) {
              return current
            }
            
            const lowerCurrent = current.toLowerCase()
            const matchedBuilding = data.buildings.find((building) => 
              building.id.toLowerCase() === lowerCurrent
            )
            if (matchedBuilding) {
              return matchedBuilding.id
            }
          }
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
    if (campusSyncedRef.current) {
      campusSyncedRef.current = false
      return
    }

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

  // Fetch all time slots for the selected course (used for per-slot calendar buttons)
  React.useEffect(() => {
    const courseId = selectedCourse?.course.id
    if (!courseId) { setCourseSlots([]); return }
    setCourseSlotsFetching(true)
    let alive = true
    fetch(`/api/course/${encodeURIComponent(courseId)}/slots`)
      .then(r => r.ok ? r.json() : [])
      .then((data: unknown) => { if (alive) setCourseSlots(Array.isArray(data) ? (data as CourseSlot[]) : []) })
      .catch(() => { if (alive) setCourseSlots([]) })
      .finally(() => { if (alive) setCourseSlotsFetching(false) })
    return () => { alive = false }
  }, [selectedCourse?.course.id])

  const visibleRooms = React.useMemo(() => {
    const rooms = (schedule?.rooms[activeBuildingId] || []).filter((room) => room.room)

    const query = deferredSearch.trim().toLowerCase()
    if (!query) return rooms
    return rooms.filter((room) => {
      const label = (room.displayName || room.room).toLowerCase()
      if (label.includes(query) || room.room.toLowerCase().includes(query)) return true
      return getVisibleRoomCourses(room, query, language).length > 0
    })
  }, [activeBuildingId, language, schedule, deferredSearch])

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

  React.useEffect(() => {
    const query = deferredSearch.trim()
    if (!query) {
      setSearchResults([])
      setSearchLoading(false)
      return
    }

    let alive = true
    setSearchLoading(true)

    const timer = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(query)}`)
        .then((r) => r.json())
        .then((data: SearchResult[]) => {
          if (!alive) return
          setSearchResults(Array.isArray(data) ? data : [])
        })
        .catch(() => {
          if (alive) setSearchResults([])
        })
        .finally(() => {
          if (alive) setSearchLoading(false)
        })
    }, 300)

    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [deferredSearch])

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

  const isSearchMode = !loading && deferredSearch.trim().length > 0
  const timelineMinWidth = 120 + (TRACK_END_HOUR - TRACK_START_HOUR) * 60 * PIXELS_PER_MINUTE
  const isToday = selectedDate.isSame(dayjs(), 'day')
  const nowLeft = (nowMinutes - TRACK_START_HOUR * 60) * PIXELS_PER_MINUTE
  const showNowLine = isToday && nowLeft >= 0 && nowLeft <= (TRACK_END_HOUR - TRACK_START_HOUR) * 60 * PIXELS_PER_MINUTE

  return (
    <ConfigProvider theme={appTheme}>
      <Layout className="hei-layout">
        <div className="hei-orb hei-orb-a" />
        <div className="hei-orb hei-orb-b" />

        <Layout.Content className="hei-content">
          <header className="hei-topbar" ref={topbarRef}>
            <div className="hei-topbar-inner">
              <div className="hei-brand-cluster">
                <div className="hei-brand-row">
                  <a href="/" style={{ display: 'flex', alignItems: 'center' }}>
                    <img src="/heiView_logo.png" alt={text.brand} className="hei-brand-logo" />
                  </a>
                </div>
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
                <Select
                  size="large"
                  value={activeBuildingId || undefined}
                  placeholder={text.selectedBuildingFallback}
                  options={filteredBuildingOptions.map(({ campus, ...option }) => option)}
                  popupMatchSelectWidth={false}
                  onChange={(value) => setSelectedBuilding(value)}
                  disabled={filteredBuildingOptions.length === 0}
                  className="hei-topbar-building"
                  listHeight={500}
                  popupClassName="hei-building-dropdown-multi"
                />
              </div>

              <div className="hei-toolbar-actions">
                <div className="hei-toolbar-core">
                  <DatePicker
                    size="large"
                    allowClear={false}
                    value={selectedDate}
                    onChange={(value) => setSelectedDate(value || dayjs())}
                    className="hei-topbar-date"
                  />
                  <DarkModeButton className="hei-toolbar-icon-button" />
                  <Input
                    size="large"
                    allowClear
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder={text.searchPlaceholder}
                    suffix={<SearchOutlined className="hei-toolbar-search-icon" />}
                    className="hei-toolbar-search"
                  />
                </div>
              </div>
            </div>
          </header>

          <div className="hei-shell">
            {error && <Alert type="error" showIcon className="hei-error" message={`${text.errorPrefix}${error}`} />}

            <section className="hei-board-card">


            {!isSearchMode && (!loading && activeBuildingId !== 'No Information' && visibleRoomGroups.length > 0) && (
              <div
                className="hei-board-frame-header"
                ref={headerScrollRef}
                onScroll={handleHeaderScroll}
              >
                <div
                  className="hei-timetable"
                  aria-hidden="true"
                  style={{ width: `max(100%, ${timelineMinWidth}px)`, borderBottomLeftRadius: 0, borderBottomRightRadius: 0, minHeight: 'auto' }}
                >
                  <div className="hei-timetable-head" style={{ borderTopLeftRadius: '20px', borderTopRightRadius: '20px' }}>
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
                      {showNowLine && (
                        <div className="hei-now-indicator" style={{ left: nowLeft }} />
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div 
              className="hei-board-frame"
              ref={bodyScrollRef}
              onScroll={handleBodyScroll}
            >
              {loading ? (
                <div className="hei-board-loading">
                  <Spin size="large" />
                  <Typography.Text type="secondary">{text.loading}</Typography.Text>
                </div>
              ) : isSearchMode ? (
                searchLoading ? (
                  <div className="hei-board-loading">
                    <Spin size="large" />
                    <Typography.Text type="secondary">{text.loading}</Typography.Text>
                  </div>
                ) : searchResults.length === 0 ? (
                  <div className="hei-empty-state">
                    <Empty description={text.searchResultsEmpty} />
                  </div>
                ) : (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '16px', padding: '16px' }}>
                    {searchResults.map((result) => (
                      <div
                        key={`${result.course.id || ''}-${result.buildingId}-${result.room}`}
                        className="hei-event"
                        style={{ position: 'relative', width: '100%', height: '140px', padding: '12px', cursor: 'pointer', overflow: 'hidden' }}
                        onClick={() => setSelectedCourse({ room: result.room, course: result.course, startMinutes: result.startMinutes, endMinutes: result.endMinutes, buildingId: result.buildingId, buildingLabel: result.buildingLabel, targetDate: result.targetDate })}
                      >
                        <span className="hei-event-title" style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', whiteSpace: 'normal' }}>
                          {resolveLocalizedText(result.course.name, language)}
                        </span>
                        <span className="hei-event-meta" style={{ overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', display: 'block' }}>
                          {resolveLocalizedText(result.course.prof, language) || '—'}
                        </span>
                        <span className="hei-event-time">
                          {result.hasValidTime
                            ? `${formatMinutesToTime(result.startMinutes)} – ${formatMinutesToTime(result.endMinutes)}`
                            : result.course.time || '—'}
                          {result.targetDate ? ` · ${dayjs(result.targetDate).isSame(dayjs(), 'day') ? 'Today' : dayjs(result.targetDate).format('MMM D')}` : ''}
                        </span>
                        <span style={{ fontSize: 11, opacity: 0.65, marginTop: 4, display: 'block', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                          {result.buildingLabel} · {result.roomDisplayName}
                        </span>
                      </div>
                    ))}
                  </div>
                )
              ) : activeBuildingId === 'No Information' ? (
                <div className="hei-no-info-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '16px', padding: '16px' }}>
                  {(() => {
                    const allCourses = visibleRoomGroups.flatMap(g => 
                      g.rooms.flatMap(r => getVisibleRoomCourses(r, deferredSearch.trim().toLowerCase(), language))
                    );
                    return allCourses.map((event, idx) => (
                      <div
                        key={`${event.id || idx}-${event.time}`}
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
                  style={{ width: `max(100%, ${timelineMinWidth}px)`, borderTopLeftRadius: 0, borderTopRightRadius: 0 }}
                >
                  {showNowLine && (
                    <div className="hei-now-line" style={{ left: 140 + nowLeft }} />
                  )}
                  <div className="hei-timetable-body">
                    {visibleRoomGroups.map((group) => (
                      <div key={`floor-${group.floor}`} className="hei-floor-group">
                        <div className="hei-floor-header">{group.floor}</div>
                        {group.rooms.map((room) => {
                          const visibleCourses = getVisibleRoomCourses(room, deferredSearch.trim().toLowerCase(), language)
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
                                <span>{(room.displayName || room.room).replace(/\s*\/\s*/g, ' / ')}</span>
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
            {schedule?.lastSyncTime && (() => {
                const syncDate = new Date(schedule.lastSyncTime!)
                const opts: Intl.DateTimeFormatOptions = { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Europe/Berlin' }
                const formatted = syncDate.toLocaleString('de-DE', opts)
                return (
                  <div className="hei-sync-time">
                    Synced with heiCO: {formatted}
                  </div>
                )
              })()}
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
                  <li><a href="/imprint">Imprint</a></li>
                  <li><a href="/privacy">Privacy Policy</a></li>
                </ul>
              </div>

              <div className="hei-footer-section">
                <h4>Developers</h4>
                <ul>
                  <li><a href="https://github.com/heiView/heiView" target="_blank" rel="noopener noreferrer">GitHub</a></li>
                </ul>
              </div>

              <div className="hei-footer-section">
                <h4>About</h4>
                <ul>
                  <li><a href="/about">Join Us</a></li>
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
                <a
                  href="https://github.com/heiView/heiView/issues/new"
                  target="_blank"
                  rel="noreferrer"
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
                    userSelect: 'none',
                    textDecoration: 'none'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = '#fff1f0';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = 'transparent';
                  }}
                >
                  {text.reportError}
                </a>
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
                  {selectedCourse.buildingLabel && (
                    <Typography.Text type="secondary">
                      {selectedCourse.buildingLabel}
                    </Typography.Text>
                  )}
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

              {selectedCourse.buildingId && (
                <Button
                  size="small"
                  onClick={() => {
                    setSelectedBuilding(selectedCourse.buildingId!)
                    if (selectedCourse.targetDate) {
                      setSelectedDate(dayjs(selectedCourse.targetDate))
                    }
                    setSearch('')
                    setSelectedCourse(null)
                  }}
                >
                  {text.viewInTimetable}
                  {selectedCourse.targetDate
                    ? ` · ${dayjs(selectedCourse.targetDate).isSame(dayjs(), 'day') ? 'Today' : dayjs(selectedCourse.targetDate).format('MMM D')}`
                    : ''}
                </Button>
              )}

              {(selectedCourse.startMinutes > 0 || courseSlots.length > 0 || courseSlotsFetching) && (
                <>
                  <Divider style={{ margin: '4px 0' }} />
                  <div>
                    <Typography.Text strong style={{ fontSize: 13, display: 'block', marginBottom: 8 }}>
                      {text.addToCalendar}
                    </Typography.Text>
                    {courseSlotsFetching ? (
                      <Spin size="small" />
                    ) : courseSlots.length > 0 ? (
                      <Space direction="vertical" size={6} style={{ width: '100%' }}>
                        {courseSlots.map((slot, i) => {
                          const startMin = parseTimeToMinutes(slot.start_time)
                          const endMin = parseTimeToMinutes(slot.end_time)
                          const isRecurring = slot.last_date !== slot.first_date
                          const firstDay = dayjs(slot.first_date + 'T12:00:00')
                          const lastDay = dayjs(slot.last_date + 'T12:00:00')
                          const weekday = firstDay.format('dddd')
                          const dateLabel = isRecurring
                            ? `${firstDay.format('MMM D')} – ${lastDay.format('MMM D')}`
                            : firstDay.format('MMM D')
                          const slotLabel = `${dateLabel}, ${weekday}, ${slot.start_time}–${slot.end_time}`
                          const courseName = resolveLocalizedText(selectedCourse.course.name, language)
                          const prof = resolveLocalizedText(selectedCourse.course.prof, language)
                          return (
                            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <Typography.Text type="secondary" style={{ fontSize: 12, flex: 1, minWidth: 0 }}>
                                {slotLabel}
                              </Typography.Text>
                              <a
                                href={toGoogleCalendarUrl(
                                  courseName,
                                  slot.room,
                                  slot.first_date,
                                  startMin,
                                  endMin,
                                  prof,
                                  selectedCourse.course.link || '',
                                  slot.last_date,
                                )}
                                target="_blank"
                                rel="noreferrer"
                                style={{ flexShrink: 0 }}
                              >
                                <Button size="small">Google Calendar</Button>
                              </a>
                            </div>
                          )
                        })}
                        <Button
                          size="small"
                          onClick={() => downloadMultiSlotIcsFile(
                            resolveLocalizedText(selectedCourse.course.name, language),
                            resolveLocalizedText(selectedCourse.course.prof, language),
                            courseSlots,
                          )}
                        >
                          {text.downloadIcs}{courseSlots.length > 1 ? ` (${courseSlots.length} slots)` : ''}
                        </Button>
                      </Space>
                    ) : (
                      <Space wrap>
                        <a
                          href={toGoogleCalendarUrl(
                            resolveLocalizedText(selectedCourse.course.name, language),
                            selectedCourse.room,
                            selectedCourse.course.start_date || selectedDate.format('YYYY-MM-DD'),
                            selectedCourse.startMinutes,
                            selectedCourse.endMinutes,
                            resolveLocalizedText(selectedCourse.course.prof, language),
                            selectedCourse.course.link || '',
                            selectedCourse.course.end_date,
                          )}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <Button size="small">Google Calendar</Button>
                        </a>
                        <Button
                          size="small"
                          onClick={() => downloadIcsFile(
                            resolveLocalizedText(selectedCourse.course.name, language),
                            selectedCourse.room,
                            selectedCourse.course.start_date || selectedDate.format('YYYY-MM-DD'),
                            selectedCourse.startMinutes,
                            selectedCourse.endMinutes,
                            resolveLocalizedText(selectedCourse.course.prof, language),
                            selectedCourse.course.end_date,
                          )}
                        >
                          {text.downloadIcs}
                        </Button>
                      </Space>
                    )}
                  </div>
                </>
              )}
            </Space>
          )}
        </Modal>
      </Layout>
    </ConfigProvider>
  )
}

export default App
