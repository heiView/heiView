import React from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import dayjs, { Dayjs } from 'dayjs'
import {
  Alert,
  AutoComplete,
  Badge,
  Button,
  Checkbox,
  ConfigProvider,
  DatePicker,
  Empty,
  Input,
  Layout,
  message,
  Modal,
  Form,
  Row,
  Col,
  Select,
  Space,
  Spin,
  Tag,
  Tooltip,
  Typography,
  theme as antdTheme,
} from 'antd'
import {
  LogoutOutlined,
  MessageOutlined,
  PushpinOutlined,
  SearchOutlined,
  UnorderedListOutlined,
  WarningOutlined,
} from '@ant-design/icons'
import DarkModeButton from '../components/DarkModeButton/DarkModeButton'
import { CAMPUS_OPTIONS, type Campus } from '../campusConfig'
import useStore from '../store'
import { clearToken, adminFetch, isSuperAdmin, getUsername } from './adminAuth'
import type {
  Language,
  LocalizedText,
  Course,
  RoomEntry,
  BuildingEntry,
  ScheduleResponse,
  CourseModalState,
  TimelineEvent,
  FloorGroup,
  SearchResult,
} from '../types/schedule'
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
} from '../utils/schedule'

const COMMON_FLOORS = [
  'Ground floor', '1st floor', '2nd floor', '3rd floor', '4th floor',
  'Lower level 1', 'Lower level 2', 'Unknown floor',
]
const BUILDING_CAMPUS_OPTIONS = [
  { value: 'altstadt', label: 'Altstadt' },
  { value: 'bergheim', label: 'Bergheim' },
  { value: 'im-neuenheimer-feld', label: 'Im Neuenheimer Feld' },
  { value: 'heidelberg', label: 'Heidelberg' },
  { value: 'mannheim-and-ludwigshafen', label: 'Mannheim & Ludwigshafen' },
  { value: 'online', label: 'Online' },
  { value: 'other', label: 'Other' },
]

// ── Admin-specific components ────────────────────────────────────────────────

type WeekEntry = {
  day_of_week?: number
  start_time?: string
  end_time?: string
  location?: string
  location_link?: string | null
  room?: string | null
  building?: string | null
  note?: string | null
  [key: string]: unknown
}

type EditFileState = {
  courseId: string
  weekIndex: number   // index into weeks[]; -1 = no specific week
  data: Record<string, unknown>
}

type BuildingEditState = {
  isNew: boolean
  buildingId: string
  data: Record<string, unknown>
}

// ── Stale-override diff renderer ─────────────────────────────────────────────
const STALE_IGNORED_FIELDS = new Set(['last_updated'])

// Recursive line-level diff helpers
type DiffLine = { text: string; bg: string }
const DIFF_AMBER  = 'rgba(250,173,20,0.22)'
const DIFF_GREEN  = 'rgba(82,196,26,0.18)'
const DIFF_PURPLE = 'rgba(147,51,234,0.14)'
const DIFF_GREY   = 'rgba(128,128,128,0.07)'
const DIFF_NONE   = 'transparent'

function isPlainObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

// Render a value (any JSON type) as lines with a uniform background color
function renderValueLines(key: string | null, val: unknown, indent: string, isLast: boolean, bg: string): DiffLine[] {
  const keyPart = key !== null ? `"${key}": ` : ''
  const comma = isLast ? '' : ','
  const raw = JSON.stringify(val, null, 2)
  const parts = raw.split('\n')
  if (parts.length === 1) return [{ text: `${indent}${keyPart}${raw}${comma}`, bg }]
  return parts.map((part, i) => {
    let text: string
    if (i === 0) text = `${indent}${keyPart}${part}`
    else if (i === parts.length - 1) text = `${indent}${part}${comma}`
    else text = `${indent}${part}`
    return { text, bg }
  })
}

// Recursively produce diff lines for any value pair; used by the two functions below
function buildDiffLines(key: string | null, a: unknown, b: unknown, side: 'source' | 'override', indent: string, isLast: boolean): DiffLine[] {
  const keyPart = key !== null ? `"${key}": ` : ''
  const comma = isLast ? '' : ','
  // Missing on this side
  if (a === undefined) return [{ text: `${indent}${keyPart}—${comma}`, bg: DIFF_GREY }]
  // Only on this side
  if (b === undefined) return renderValueLines(key, a, indent, isLast, side === 'source' ? DIFF_GREEN : DIFF_PURPLE)
  // Equal — no highlight
  if (JSON.stringify(a) === JSON.stringify(b)) return renderValueLines(key, a, indent, isLast, DIFF_NONE)
  // Both objects → recurse into keys
  if (isPlainObj(a) && isPlainObj(b)) return buildObjDiffLines(key, a, b, side, indent, isLast)
  // Both arrays → recurse into elements
  if (Array.isArray(a) && Array.isArray(b)) return buildArrDiffLines(key, a, b, side, indent, isLast)
  // Primitive / type mismatch → highlight this line
  return renderValueLines(key, a, indent, isLast, DIFF_AMBER)
}

function buildObjDiffLines(key: string | null, a: Record<string, unknown>, b: Record<string, unknown>, side: 'source' | 'override', indent: string, isLast: boolean): DiffLine[] {
  const keyPart = key !== null ? `"${key}": ` : ''
  const comma = isLast ? '' : ','
  const childIndent = indent + '  '
  const allKeys = Array.from(new Set([...Object.keys(a), ...Object.keys(b)]))
  const lines: DiffLine[] = [{ text: `${indent}${keyPart}{`, bg: DIFF_NONE }]
  allKeys.forEach((k, i) => {
    const childIsLast = i === allKeys.length - 1
    if (STALE_IGNORED_FIELDS.has(k)) {
      if (k in a) lines.push(...renderValueLines(k, a[k], childIndent, childIsLast, DIFF_NONE))
      return
    }
    lines.push(...buildDiffLines(k, a[k], b[k], side, childIndent, childIsLast))
  })
  lines.push({ text: `${indent}}${comma}`, bg: DIFF_NONE })
  return lines
}

function buildArrDiffLines(key: string | null, a: unknown[], b: unknown[], side: 'source' | 'override', indent: string, isLast: boolean): DiffLine[] {
  const keyPart = key !== null ? `"${key}": ` : ''
  const comma = isLast ? '' : ','
  const childIndent = indent + '  '
  const maxLen = Math.max(a.length, b.length)
  const lines: DiffLine[] = [{ text: `${indent}${keyPart}[`, bg: DIFF_NONE }]
  for (let i = 0; i < maxLen; i++) {
    lines.push(...buildDiffLines(null, a[i], b[i], side, childIndent, i === maxLen - 1))
  }
  lines.push({ text: `${indent}]${comma}`, bg: DIFF_NONE })
  return lines
}

function renderJsonDiffSide(
  obj: Record<string, unknown> | null,
  other: Record<string, unknown> | null,
  side: 'source' | 'override',
): React.ReactNode {
  if (!obj) return <span style={{ color: 'var(--hei-text-secondary)' }}>(not found)</span>
  const lines = buildObjDiffLines(null, obj, other ?? {}, side, '', true)
  return lines.map((line, i) => (
    <span key={i} style={{ display: 'block', background: line.bg }}>{line.text}</span>
  ))
}
// Returns true if source and override differ in any field other than 'weeks' and 'last_updated'
function hasNonWeeksDiff(source: Record<string, unknown>, override: Record<string, unknown>): boolean {
  const IGNORED = new Set(['weeks', 'last_updated'])
  const allKeys = Array.from(new Set([...Object.keys(source), ...Object.keys(override)])).filter(k => !IGNORED.has(k))
  return allKeys.some(k => JSON.stringify(source[k]) !== JSON.stringify(override[k]))
}
// ─────────────────────────────────────────────────────────────────────────────

function AdminApp() {
  const location = useLocation()
  const navigate = useNavigate()
  const buildingFromUrl = location.pathname === '/admin' ? '' : decodeURIComponent(location.pathname.slice('/admin/'.length - 1 + 1))
  const theme = useStore((s) => s.theme)
  const language: Language = 'en'

  const [schedule, setSchedule] = React.useState<ScheduleResponse | null>(null)
  const [scheduleVersion, setScheduleVersion] = React.useState(0)
  const [selectedCampus, setSelectedCampus] = React.useState<Campus>('Altstadt')
  const [selectedBuilding, setSelectedBuilding] = React.useState<string>('')
  const [selectedDate, setSelectedDate] = React.useState<Dayjs>(() => {
    try {
      const saved = sessionStorage.getItem('admin-selected-date')
      if (saved) {
        const d = dayjs(saved)
        if (d.isValid()) return d
      }
    } catch (_) { /* ignore */ }
    return dayjs()
  })
  const [search, setSearch] = React.useState('')
  const deferredSearch = React.useDeferredValue(search)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [selectedCourse, setSelectedCourse] = React.useState<CourseModalState | null>(null)
  const [searchResults, setSearchResults] = React.useState<SearchResult[]>([])
  const [searchLoading, setSearchLoading] = React.useState(false)
  const [skipSet, setSkipSet] = React.useState<Set<string>>(new Set())
  const [skipLoading, setSkipLoading] = React.useState<string | null>(null)
  const [editFileState, setEditFileState] = React.useState<EditFileState | null>(null)
  const [editFileLoading, setEditFileLoading] = React.useState(false)
  const [editFileSaving, setEditFileSaving] = React.useState(false)
  const [batchEditChecked, setBatchEditChecked] = React.useState(false)
  const [batchEditCount, setBatchEditCount] = React.useState<{ matches: { courseId: string; title: string; weeks: unknown[] }[]; totalWeeks: number } | null>(null)
  const [batchEditSaving, setBatchEditSaving] = React.useState(false)
  const [noteMapSaving, setNoteMapSaving] = React.useState(false)
  const [noteMapModalOpen, setNoteMapModalOpen] = React.useState(false)
  const [noteMapPattern, setNoteMapPattern] = React.useState('')
  const [noteMapOriginal, setNoteMapOriginal] = React.useState('')
  const [noteMapMatchType, setNoteMapMatchType] = React.useState<'exact' | 'contains'>('exact')
  const [noteMapOrganisation, setNoteMapOrganisation] = React.useState('')
  const [editForm] = Form.useForm()
  const [buildingEditState, setBuildingEditState] = React.useState<BuildingEditState | null>(null)
  const [buildingEditSaving, setBuildingEditSaving] = React.useState(false)
  const [buildingDeleteLoading, setBuildingDeleteLoading] = React.useState(false)
  const [buildingForm] = Form.useForm()
  const [allBuildingsList, setAllBuildingsList] = React.useState<{ id: string; street: string; displayName: string; campusId: string }[] | null>(null)
  const [weekEditCampus, setWeekEditCampus] = React.useState<string>('')

  const bldOptions = React.useMemo(() => {
    return (allBuildingsList || [])
      .filter(b => !weekEditCampus || b.campusId === weekEditCampus)
      .map(b => ({ value: b.street, label: (b.displayName && b.displayName.trim()) ? b.displayName.trim() : b.street }))
      .sort((a, b) => String(a.label).localeCompare(String(b.label)))
  }, [allBuildingsList, weekEditCampus])
  const [editRoomOptions, setEditRoomOptions] = React.useState<{ value: string }[]>([])
  const [newEventRoomOptions, setNewEventRoomOptions] = React.useState<{ value: string }[]>([])
  const [mergeTargetId, setMergeTargetId] = React.useState<string | null>(null)
  const [mergeSaving, setMergeSaving] = React.useState(false)
  const [roomEditState, setRoomEditState] = React.useState<{ buildingId: string; room: Record<string, unknown> } | null>(null)
  const [roomEditSaving, setRoomEditSaving] = React.useState(false)
  const [roomDeleteLoading, setRoomDeleteLoading] = React.useState<string | null>(null)
  const [roomForm] = Form.useForm()
  const [roomsModalOpen, setRoomsModalOpen] = React.useState(false)
  const [roomsModalBuildingId, setRoomsModalBuildingId] = React.useState('')
  const [roomsModalLabel, setRoomsModalLabel] = React.useState('')
  const [roomsModalRooms, setRoomsModalRooms] = React.useState<Record<string, unknown>[]>([])
  const [roomsModalLoading, setRoomsModalLoading] = React.useState(false)
  const [addRoomSaving, setAddRoomSaving] = React.useState(false)
  const [addRoomForm] = Form.useForm()
  const [newEventOpen, setNewEventOpen] = React.useState(false)
  const [newEventSaving, setNewEventSaving] = React.useState(false)
  const [newEventCampus, setNewEventCampus] = React.useState('')
  const [newEventForm] = Form.useForm()
  const watchedEditBuilding = Form.useWatch('week_building', editForm)
  const watchedNewEventBuilding = Form.useWatch('week_building', newEventForm)

  // ── Superadmin-only state ─────────────────────────────────────────────────
  const superAdmin = React.useMemo(() => isSuperAdmin(), [])
  const currentUser = React.useMemo(() => getUsername(), [])
  const [accountsOpen, setAccountsOpen] = React.useState(false)
  const [accountsList, setAccountsList] = React.useState<{ username: string; role: string }[]>([])
  const [accountsLoading, setAccountsLoading] = React.useState(false)
  const [accountForm] = Form.useForm()
  const [accountSaving, setAccountSaving] = React.useState(false)
  const [auditOpen, setAuditOpen] = React.useState(false)
  const [auditLog, setAuditLog] = React.useState<{ id?: string; ts: string; username: string; action: string; target: string | null; summary: string | null; undone?: boolean }[]>([])
  const [auditLoading, setAuditLoading] = React.useState(false)
  const [undoLoadingSet, setUndoLoadingSet] = React.useState<Set<string>>(new Set())

  // Stale overrides — source JSON updated more recently than override
  type StaleEntry = { courseId: string; srcMtime: number | null; ovMtime: number; sourceDeleted?: boolean; inDeleted?: boolean }
  type BothFiles = { source: Record<string, unknown> | null; override: Record<string, unknown> | null; srcMtime: number | null; ovMtime: number | null }
  const [staleOpen, setStaleOpen] = React.useState(false)
  const [staleList, setStaleList] = React.useState<StaleEntry[]>([])
  const [staleLoading, setStaleLoading] = React.useState(false)
  const [staleDiffCourseId, setStaleDiffCourseId] = React.useState<string | null>(null)
  const [staleDiffData, setStaleDiffData] = React.useState<BothFiles | null>(null)
  const [staleDiffLoading, setStaleDiffLoading] = React.useState(false)
  const [staleDismissLoading, setStaleDismissLoading] = React.useState<string | null>(null)
  const [staleMergeLoading, setStaleMergeLoading] = React.useState<string | null>(null)
  const [staleMergeNonWeeksLoading, setStaleMergeNonWeeksLoading] = React.useState<string | null>(null)
  const [staleDeleteLoading, setStaleDeleteLoading] = React.useState<string | null>(null)
  const [staleOverrideEdit, setStaleOverrideEdit] = React.useState<string | null>(null) // null = view mode
  const [staleOverrideSaveLoading, setStaleOverrideSaveLoading] = React.useState(false)
  const [staleOverrideParseError, setStaleOverrideParseError] = React.useState<string | null>(null)
  const [staleDiffWasSaved, setStaleDiffWasSaved] = React.useState(false)
  const [staleDiffUndoSnapshot, setStaleDiffUndoSnapshot] = React.useState<Record<string, unknown> | null>(null)
  const [staleUndoLoading, setStaleUndoLoading] = React.useState(false)
  // Further Info Queue — courses with further_info but no schedule weeks
  type FurtherInfoEntry = { id: string; title: string | null; detail_link: string | null; further_info: string; organisation: string | null; hasOverride?: boolean }
  type FiWeekEntry = { day_of_week: number | null; start_time: string; end_time: string; room: string; building: string; campus: string; floor: string; note: string }
  const [fiQueueOpen, setFiQueueOpen] = React.useState(false)
  const [fiQueueList, setFiQueueList] = React.useState<FurtherInfoEntry[]>([])
  const [fiQueueLoading, setFiQueueLoading] = React.useState(false)
  const [fiSkipSet, setFiSkipSet] = React.useState<Set<string>>(new Set())
  const [fiSkipLoading, setFiSkipLoading] = React.useState<string | null>(null)
  const [fiShowSkipped, setFiShowSkipped] = React.useState(false)
  // Override editor
  const [fiOverrideCourseId, setFiOverrideCourseId] = React.useState<string | null>(null)
  const [fiOverrideCourseData, setFiOverrideCourseData] = React.useState<Record<string, unknown> | null>(null)
  const [fiOverrideLoading, setFiOverrideLoading] = React.useState(false)
  const [fiOverrideSaving, setFiOverrideSaving] = React.useState(false)
  const [fiOverrideStartDate, setFiOverrideStartDate] = React.useState<Dayjs | null>(null)
  const [fiOverrideEndDate, setFiOverrideEndDate] = React.useState<Dayjs | null>(null)
  const [fiOverrideWeeks, setFiOverrideWeeks] = React.useState<FiWeekEntry[]>([])
  const [fiOverrideRoomOptions, setFiOverrideRoomOptions] = React.useState<{ value: string }[][]>([])
  const emptyFiWeek = (): FiWeekEntry => ({ day_of_week: null, start_time: '', end_time: '', room: '', building: '', campus: '', floor: '', note: '' })
  // ─────────────────────────────────────────────────────────────────────────

  // User Feedback queue
  type FeedbackItem = {
    id: string; courseId: string; courseTitle: string; email: string | null
    message: string; files: string[]; proposedWeeks: unknown[]; submittedAt: string; status: string
  }
  const [feedbackOpen, setFeedbackOpen] = React.useState(false)
  const [feedbackList, setFeedbackList] = React.useState<FeedbackItem[]>([])
  const [feedbackLoading, setFeedbackLoading] = React.useState(false)
  const [feedbackDetailId, setFeedbackDetailId] = React.useState<string | null>(null)
  const [feedbackDetailData, setFeedbackDetailData] = React.useState<{ feedback: FeedbackItem; currentCourse: Record<string, unknown> | null } | null>(null)
  const [feedbackDetailLoading, setFeedbackDetailLoading] = React.useState(false)
  const [feedbackDismissLoading, setFeedbackDismissLoading] = React.useState<string | null>(null)
  const [feedbackEmailOpen, setFeedbackEmailOpen] = React.useState(false)
  const [feedbackEmailSubject, setFeedbackEmailSubject] = React.useState('')
  const [feedbackEmailBody, setFeedbackEmailBody] = React.useState('')
  const [feedbackEmailSending, setFeedbackEmailSending] = React.useState(false)
  // ─────────────────────────────────────────────────────────────────────────

  const initializedRef = React.useRef(false)
  const campusSyncedRef = React.useRef(false)
  const topbarRef = React.useRef<HTMLElement>(null)

  // Keep --topbar-h in sync so content isn't occluded when navbar wraps
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

  // Load skip list
  React.useEffect(() => {
    adminFetch('/api/admin/skip')
      .then((r) => r.json())
      .then((data) => setSkipSet(new Set(data.skip || [])))
      .catch(() => {})
  }, [])

  // Building from URL
  React.useEffect(() => {
    const b = location.pathname.replace(/^\/admin\/?/, '')
    if (b) setSelectedBuilding(decodeURIComponent(b))
  }, [location.pathname])

  // Sync selectedBuilding → campus
  React.useEffect(() => {
    if (!schedule || !selectedBuilding) return
    const bld = schedule.buildings.find((b) => b.id === selectedBuilding)
    if (!bld) return
    const street = resolveLocalizedText(bld.street, language) || bld.id
    const campus = normalizeCampusValue(bld.campus) || resolveCampusName(street) || 'Other'
    campusSyncedRef.current = true
    setSelectedCampus(campus as Campus)
  }, [selectedBuilding, schedule])

  // Update URL when building changes
  React.useEffect(() => {
    if (!initializedRef.current) { initializedRef.current = true; return }
    if (selectedBuilding) {
      navigate('/admin/' + encodeURIComponent(selectedBuilding), { replace: true })
    } else {
      navigate('/admin', { replace: true })
    }
  }, [selectedBuilding, navigate])

  // Fetch schedule
  React.useEffect(() => {
    let alive = true
    const run = async () => {
      setLoading(true); setError(null)
      try {
        const data = await fetchSchedule(toIsoDate(selectedDate), 'no-store')
        if (!alive) return
        setSchedule(data)
        setSelectedBuilding((cur) => {
          if (cur && data.buildings.some((b) => b.id === cur)) return cur
          return data.buildings.find((b) => {
            const street = resolveLocalizedText(b.street, language) || b.id
            const campus = normalizeCampusValue(b.campus) || resolveCampusName(street) || 'Other'
            return campus === selectedCampus
          })?.id || ''
        })
      } catch (e) {
        if (!alive) return
        setSchedule(null)
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (alive) setLoading(false)
      }
    }
    void run()
    return () => { alive = false }
  }, [selectedDate, scheduleVersion])

  const buildingOptions = React.useMemo(
    () =>
      (schedule?.buildings || []).map((b) => ({
        value: b.id,
        label: resolveBuildingLabel(b.displayName, language, resolveLocalizedText(b.street, language) || b.id),
        campus: normalizeCampusValue(b.campus) || resolveCampusName(resolveLocalizedText(b.street, language) || b.id) || 'Other',
      })),
    [schedule],
  )

  const filteredBuildingOptions = React.useMemo(() => {
    return buildingOptions
      .filter((b) => b.campus === selectedCampus)
      .sort((a, b) => {
        const aU = a.value.toLowerCase() === 'unknown'
        const bU = b.value.toLowerCase() === 'unknown'
        if (aU && !bU) return -1
        if (!aU && bU) return 1
        return 0
      })
  }, [buildingOptions, selectedCampus])

  const activeBuildingId = React.useMemo(() => {
    if (selectedBuilding && filteredBuildingOptions.some((o) => o.value === selectedBuilding)) return selectedBuilding
    return filteredBuildingOptions[0]?.value || ''
  }, [filteredBuildingOptions, selectedBuilding])

  React.useEffect(() => {
    if (campusSyncedRef.current) { campusSyncedRef.current = false; return }
    if (filteredBuildingOptions.length === 0) return
    if (!filteredBuildingOptions.some((o) => o.value === selectedBuilding)) {
      setSelectedBuilding(filteredBuildingOptions[0].value)
    }
  }, [filteredBuildingOptions, selectedBuilding])

  // When user selects "No Information", fire a separate request for unscheduled courses
  // (the server only populates that building when ?building=No+Information is present)
  React.useEffect(() => {
    if (activeBuildingId !== 'No Information') return
    if (schedule?.rooms['No Information']?.length) return  // already loaded
    let alive = true
    const run = async () => {
      try {
        const res = await fetch(`/api/schedule?date=${toIsoDate(selectedDate)}&building=No+Information`, { cache: 'no-store' })
        if (!res.ok || !alive) return
        const data = normalizeScheduleResponse(await res.json() as ScheduleResponse)
        if (!alive) return
        setSchedule(prev => prev
          ? { ...prev, rooms: { ...prev.rooms, 'No Information': data.rooms['No Information'] || [] } }
          : data
        )
      } catch (_) { /* ignore */ }
    }
    void run()
    return () => { alive = false }
  }, [activeBuildingId, selectedDate])

  // Sync edit form values whenever editFileState changes (handles multi-week re-open correctly)
  React.useEffect(() => {
    if (!editFileState || editFileState.weekIndex < 0) return
    const weeks = editFileState.data.weeks as WeekEntry[]
    const week = weeks[editFileState.weekIndex]
    if (!week) return
    const rawBuilding = week.building ?? ''
    const lastComma = rawBuilding.lastIndexOf(',')
    const floorLower = COMMON_FLOORS.map(f => f.toLowerCase())
    let initBuilding = rawBuilding
    let initFloor = ''
    if (lastComma >= 0) {
      const possibleFloor = rawBuilding.slice(lastComma + 1).trim()
      if (floorLower.includes(possibleFloor.toLowerCase())) {
        initBuilding = rawBuilding.slice(0, lastComma).trim()
        initFloor = possibleFloor
      }
    }
    const matched = (allBuildingsList || []).find(b => b.street === initBuilding)
    setWeekEditCampus(matched?.campusId || '')
    editForm.setFieldsValue({
      week_room: week.room ?? '',
      week_building: initBuilding || (week.building ?? ''),
      week_floor: initFloor ? [initFloor] : [],
      week_note: week.note ?? '',
      week_location: week.location ?? '',
    })
    // Fetch batch-edit preview count
    setBatchEditChecked(false)
    setBatchEditCount(null)
    const qRoom = encodeURIComponent(week.room || '')
    const qBuilding = encodeURIComponent(week.building || 'null')
    adminFetch(`/api/admin/courses/with-room?room=${qRoom}&building=${qBuilding}`)
      .then(r => (r.ok ? r.json() : null))
      .then((data: { matches: { courseId: string; title: string; weeks: unknown[] }[]; totalWeeks: number } | null) => { if (data) setBatchEditCount(data) })
      .catch(() => {})
  }, [editFileState])

  // Global search across all dates via backend
  React.useEffect(() => {
    const query = deferredSearch.trim()
    if (!query) { setSearchResults([]); return }
    let alive = true
    setSearchLoading(true)
    fetch(`/api/search?q=${encodeURIComponent(query)}`)
      .then((r) => r.json())
      .then((data: SearchResult[]) => { if (!alive) return; setSearchResults(Array.isArray(data) ? data : []) })
      .catch(() => { if (alive) setSearchResults([]) })
      .finally(() => { if (alive) setSearchLoading(false) })
    return () => { alive = false }
  }, [deferredSearch])

  const visibleRooms = React.useMemo(() => {
    const rooms = (schedule?.rooms[activeBuildingId] || []).filter((r) => r.room)
    const query = deferredSearch.trim().toLowerCase()
    if (!query) return rooms
    return rooms.filter((room) => {
      const label = (room.displayName || room.room).toLowerCase()
      if (label.includes(query) || room.room.toLowerCase().includes(query)) return true
      return getVisibleRoomCourses(room, query, language).length > 0
    })
  }, [activeBuildingId, schedule, deferredSearch])

  const visibleRoomGroups = React.useMemo<FloorGroup[]>(() => {
    const floorMap = new Map<string, RoomEntry[]>()
    visibleRooms.forEach((room) => {
      const floor = normalizeFloorLabel(room.floor)
      const bucket = floorMap.get(floor)
      if (bucket) bucket.push(room)
      else floorMap.set(floor, [room])
    })
    return Array.from(floorMap.entries())
      .sort((l, r) => compareFloors(l[0], r[0]))
      .map(([floor, rooms]) => ({
        floor,
        rooms: [...rooms].sort((l, r) => l.room.localeCompare(r.room, undefined, { numeric: true })),
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

  function handleLogout() {
    clearToken()
    navigate('/admin/login', { replace: true })
  }

  async function handleSkipToggle(courseId: string) {
    if (!courseId) return
    setSkipLoading(courseId)
    try {
      if (skipSet.has(courseId)) {
        const res = await adminFetch(`/api/admin/skip/${encodeURIComponent(courseId)}`, { method: 'DELETE' })
        const data = await res.json()
        setSkipSet(new Set(data.skip || []))
      } else {
        const res = await adminFetch('/api/admin/skip', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ courseId }),
        })
        const data = await res.json()
        setSkipSet(new Set(data.skip || []))
      }
    } catch (_) {
      /* ignore */
    } finally {
      setSkipLoading(null)
    }
  }

  async function handleOpenBuildingEdit() {
    if (!activeBuildingId || activeBuildingId === 'No Information') return
    const [buildingRes, listRes] = await Promise.all([
      adminFetch(`/api/admin/building/${encodeURIComponent(activeBuildingId)}`),
      adminFetch('/api/admin/buildings'),
    ])
    if (!buildingRes.ok) return
    const data = await buildingRes.json()
    if (listRes.ok) setAllBuildingsList(await listRes.json())
    setMergeTargetId(null)
    // Use the catalog id (data.id = slug like "bld-xxx"), not the street address
    setBuildingEditState({ isNew: false, buildingId: data.id as string, data })
    buildingForm.setFieldsValue({
      street: data.street || '',
      displayName: data.displayName || '',
      campusId: data.campusId || '',
      aliases: Array.isArray(data.aliases) ? data.aliases.join('\n') : '',
      floors: Array.isArray(data.floors) ? data.floors : [],
      notes: data.notes || '',
    })
  }

  function handleOpenBuildingAdd() {
    const campusIdMap: Record<string, string> = {
      Altstadt: 'altstadt',
      Bergheim: 'bergheim',
      'Im Neuenheimer Feld': 'im-neuenheimer-feld',
      Heidelberg: 'heidelberg',
      'Mannheim & Ludwigshafen': 'mannheim-and-ludwigshafen',
      Online: 'online',
      Other: 'other',
    }
    setBuildingEditState({ isNew: true, buildingId: '', data: {} })
    buildingForm.setFieldsValue({
      street: '',
      displayName: '',
      campusId: campusIdMap[selectedCampus] || 'altstadt',
      aliases: '',
      floors: [],
      notes: '',
    })
  }

  async function handleSaveNewEvent(values: Record<string, unknown>) {
    setNewEventSaving(true)
    try {
      const floorArr = Array.isArray(values.week_floor) ? values.week_floor as string[] : []
      const floor = floorArr[0] ?? ''
      let building = (values.week_building as string) || null
      if (building && floor) building = `${building}, ${floor}`
      const lecturers = (values.lecturers as string || '').split('\n').map((s: string) => s.trim()).filter(Boolean)
      const payload = {
        title: values.title as string,
        type: (values.type as string) || '',
        lecturers,
        detail_link: (values.detail_link as string) || null,
        start_date: values.start_date ? (values.start_date as unknown as { format: (f: string) => string }).format('YYYY-MM-DD') : null,
        end_date: values.end_date ? (values.end_date as unknown as { format: (f: string) => string }).format('YYYY-MM-DD') : null,
        weeks: [
          {
            day_of_week: values.day_of_week != null ? Number(values.day_of_week) : null,
            start_time: (values.start_time as string) || null,
            end_time: (values.end_time as string) || null,
            room: (values.week_room as string) || null,
            building,
            location_link: (values.week_link as string) || null,
            note: (values.week_note as string) || null,
          },
        ].filter(w => w.start_time || w.room),
      }
      const res = await adminFetch('/api/admin/course-file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) { const e = await res.json(); alert(e.error || 'Failed to create event'); return }
      setNewEventOpen(false)
      newEventForm.resetFields()
      setNewEventCampus('')
      setScheduleVersion(v => v + 1)
    } catch (_) {
      /* ignore */
    } finally {
      setNewEventSaving(false)
    }
  }

  async function handleMergeBuilding() {
    if (!buildingEditState || buildingEditState.isNew || !mergeTargetId) return
    const srcLabel = (buildingEditState.data.street as string) || buildingEditState.buildingId
    const targetBuilding = (allBuildingsList || []).find(b => b.id === mergeTargetId)
    const tgtLabel = targetBuilding ? (targetBuilding.displayName || targetBuilding.street) : mergeTargetId
    const confirmed = window.confirm(
      `Merge "${srcLabel}" INTO "${tgtLabel}"?\n\n` +
      `• "${srcLabel}" will become an alias of "${tgtLabel}"\n` +
      `• All rooms will be moved to "${tgtLabel}"\n` +
      `• This building entry will be removed\n\n` +
      `SQLite will be synced automatically after merge.`
    )
    if (!confirmed) return
    setMergeSaving(true)
    try {
      const res = await adminFetch(
        `/api/admin/building/${encodeURIComponent(buildingEditState.buildingId)}/merge-into/${encodeURIComponent(mergeTargetId)}`,
        { method: 'POST' }
      )
      if (!res.ok) {
        const err = await res.json()
        alert(err.error || 'Merge failed')
        return
      }
      setBuildingEditState(null)
      setMergeTargetId(null)
    } catch (_) {
      alert('Network error during merge')
    } finally {
      setMergeSaving(false)
    }
  }

  async function handleSaveBuildingEdit(values: Record<string, string>) {
    if (!buildingEditState) return
    setBuildingEditSaving(true)
    const payload = {
      street: values.street,
      displayName: values.displayName || '',
      campusId: values.campusId,
      aliases: (values.aliases || '').split('\n').map((s: string) => s.trim()).filter(Boolean),
      floors: Array.isArray(values.floors) ? (values.floors as string[]).map((s: string) => s.trim()).filter(Boolean) : [],
      notes: values.notes || '',
    }
    try {
      if (buildingEditState.isNew) {
        const res = await adminFetch('/api/admin/building', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        if (!res.ok) {
          const err = await res.json()
          alert(err.error || 'Failed to create building')
          return
        }
      } else {
        await adminFetch(`/api/admin/building/${encodeURIComponent(buildingEditState.buildingId)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...buildingEditState.data, ...payload }),
        })
      }
      setBuildingEditState(null)
      setScheduleVersion(v => v + 1)
      setAllBuildingsList(null)  // invalidate cache so next course edit re-fetches
    } catch (_) {
      /* ignore */
    } finally {
      setBuildingEditSaving(false)
    }
  }

  async function handleDeleteBuilding() {
    if (!buildingEditState || buildingEditState.isNew) return
    const label = (buildingEditState.data.street as string) || buildingEditState.buildingId
    setBuildingDeleteLoading(true)
    try {
      const res = await adminFetch(
        `/api/admin/building/${encodeURIComponent(buildingEditState.buildingId)}`,
        { method: 'DELETE' }
      )
      const body = await res.json()
      if (res.status === 409) {
        const ids: string[] = body.courseIds || []
        Modal.error({
          title: 'Cannot delete building',
          content: (
            <div>
              <p>The following courses are still mounted on this building. Please reassign or delete them first:</p>
              <ul style={{ maxHeight: 200, overflowY: 'auto', paddingLeft: 18 }}>
                {ids.map(id => <li key={id}><code>{id}</code></li>)}
              </ul>
            </div>
          ),
          width: 480,
        })
        return
      }
      if (!res.ok) { alert(body.error || 'Delete failed'); return }
      setBuildingEditState(null)
    } catch (_) {
      alert('Network error')
    } finally {
      setBuildingDeleteLoading(false)
    }
  }

  function confirmDeleteBuilding() {
    const label = (buildingEditState?.data?.street as string) || buildingEditState?.buildingId || ''
    Modal.confirm({
      title: `Delete building "${label}"?`,
      content: 'This action cannot be undone. The building and all its rooms will be removed from the catalog.',
      okText: 'Delete',
      okButtonProps: { danger: true },
      onOk: handleDeleteBuilding,
    })
  }

  async function handleDeleteRoom(buildingId: string, roomId: string, roomName: string) {
    setRoomDeleteLoading(roomId)
    try {
      const res = await adminFetch(
        `/api/admin/building/${encodeURIComponent(buildingId)}/room/${encodeURIComponent(roomId)}`,
        { method: 'DELETE' }
      )
      const body = await res.json()
      if (res.status === 409) {
        const ids: string[] = body.courseIds || []
        Modal.error({
          title: 'Cannot delete room',
          content: (
            <div>
              <p>The following courses are still mounted on room <strong>{roomName}</strong>. Please reassign or delete them first:</p>
              <ul style={{ maxHeight: 200, overflowY: 'auto', paddingLeft: 18 }}>
                {ids.map(id => <li key={id}><code>{id}</code></li>)}
              </ul>
            </div>
          ),
          width: 480,
        })
        return
      }
      if (!res.ok) { alert(body.error || 'Delete failed'); return }
      await refreshRoomsData(buildingId)
    } catch (_) {
      alert('Network error')
    } finally {
      setRoomDeleteLoading(null)
    }
  }

  function confirmDeleteRoom(buildingId: string, roomId: string, roomName: string) {
    Modal.confirm({
      title: `Delete room "${roomName}"?`,
      content: 'This action cannot be undone.',
      okText: 'Delete',
      okButtonProps: { danger: true },
      onOk: () => handleDeleteRoom(buildingId, roomId, roomName),
    })
  }

  function openRoomEditModal(buildingId: string, room: Record<string, unknown>) {
    setRoomEditState({ buildingId, room })
    roomForm.setFieldsValue({
      room_name: room.name ?? '',
      room_display_name: room.displayName ?? '',
      room_floors: Array.isArray(room.floors) && (room.floors as string[]).length > 0 ? [(room.floors as string[])[0]] : [],
      room_notes: room.notes ?? '',
    })
  }

  async function refreshRoomsData(buildingId: string) {
    const res = await adminFetch(`/api/admin/building/${encodeURIComponent(buildingId)}`)
    if (!res.ok) return
    const data = await res.json()
    const rooms: Record<string, unknown>[] = Array.isArray(data.rooms) ? data.rooms : []
    setRoomsModalRooms(rooms)
    setBuildingEditState(prev => prev?.buildingId === buildingId ? { ...prev, data } : prev)
  }

  async function handleOpenRoomsManage() {
    if (!activeBuildingId || activeBuildingId === 'No Information') return
    setRoomsModalLoading(true)
    setRoomsModalOpen(true)
    try {
      const res = await adminFetch(`/api/admin/building/${encodeURIComponent(activeBuildingId)}`)
      if (!res.ok) { setRoomsModalOpen(false); return }
      const data = await res.json()
      setRoomsModalBuildingId(data.id as string)
      setRoomsModalLabel((data.street as string) || (data.id as string))
      setRoomsModalRooms(Array.isArray(data.rooms) ? data.rooms : [])
    } catch (_) {
      setRoomsModalOpen(false)
    } finally {
      setRoomsModalLoading(false)
    }
  }

  async function handleAddRoomToBuilding(values: Record<string, string>) {
    if (!roomsModalBuildingId) return
    setAddRoomSaving(true)
    const payload = {
      name: values.room_add_name,
      displayName: values.room_add_display_name || '',
      floors: Array.isArray(values.room_add_floors) ? (values.room_add_floors as string[]).slice(0, 1) : [],
      notes: values.room_add_notes || '',
    }
    try {
      const res = await adminFetch(
        `/api/admin/building/${encodeURIComponent(roomsModalBuildingId)}/room`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }
      )
      if (!res.ok) { const e = await res.json(); alert(e.error || 'Failed to add room'); return }
      addRoomForm.resetFields()
      await refreshRoomsData(roomsModalBuildingId)
    } catch (_) {
      alert('Network error')
    } finally {
      setAddRoomSaving(false)
    }
  }

  // Removed: handleOpenRoomEdit (replaced by openRoomEditModal)
  // Removed: handleOpenRoomEditByName (replaced by handleOpenRoomsManage button in top bar)

  async function handleSaveRoomEdit(values: Record<string, string>) {
    if (!roomEditState) return
    const room = roomEditState.room
    setRoomEditSaving(true)
    const payload = {
      name: values.room_name,
      displayName: values.room_display_name || '',
      floors: Array.isArray(values.room_floors) ? (values.room_floors as string[]).slice(0, 1) : [],
      notes: values.room_notes || '',
      features: room.features ?? null,
    }
    try {
      const res = await adminFetch(
        `/api/admin/building/${encodeURIComponent(roomEditState.buildingId)}/room/${encodeURIComponent(room.id as string)}`,
        { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }
      )
      if (!res.ok) { const e = await res.json(); alert(e.error || 'Save failed'); return }
      setRoomEditState(null)
      await refreshRoomsData(roomEditState.buildingId)
    } catch (_) {
      alert('Network error')
    } finally {
      setRoomEditSaving(false)
    }
  }

  async function fetchBuildingRooms(buildingStreet: string, setter: (opts: { value: string }[]) => void) {
    if (!buildingStreet) { setter([]); return }
    const buildings = allBuildingsList || []
    const bld = buildings.find(b => b.street === buildingStreet)
    if (!bld) { setter([]); return }
    try {
      const res = await adminFetch(`/api/admin/building/${encodeURIComponent(bld.id)}/rooms`)
      if (res.ok) {
        const rooms: { name: string }[] = await res.json()
        setter(rooms.map(r => ({ value: r.name })))
      } else {
        setter([])
      }
    } catch { setter([]) }
  }

  // Reactively fetch room options when building selection changes
  React.useEffect(() => {
    if (watchedEditBuilding) {
      fetchBuildingRooms(watchedEditBuilding, setEditRoomOptions)
    } else {
      setEditRoomOptions([])
    }
  }, [watchedEditBuilding, allBuildingsList])

  React.useEffect(() => {
    if (watchedNewEventBuilding) {
      fetchBuildingRooms(watchedNewEventBuilding, setNewEventRoomOptions)
    } else {
      setNewEventRoomOptions([])
    }
  }, [watchedNewEventBuilding, allBuildingsList])

  async function handleOpenEdit(courseId: string, startTime?: string, dayOfWeek?: number, room?: string) {
    if (!courseId) return
    setEditFileLoading(true)
    setEditFileState(null)
    // Reset form and campus immediately so old values don't bleed into the next week
    editForm.resetFields()
    setWeekEditCampus('')
    try {
      // Lazy-load all buildings for the cascade selector
      let buildings = allBuildingsList
      if (!buildings) {
        const listRes = await adminFetch('/api/admin/buildings')
        if (listRes.ok) {
          buildings = await listRes.json()
          setAllBuildingsList(buildings)
        }
      }
      const res = await adminFetch(`/api/admin/course-file/${encodeURIComponent(courseId)}`)
      const data = await res.json()
      const weeks: WeekEntry[] = Array.isArray(data.weeks) ? data.weeks : []
      // Find the matching week by start_time, day_of_week, and room (most specific first)
      const weekIndex = startTime
        ? (() => {
            if (dayOfWeek !== undefined) {
              // Best match: day_of_week + start_time + room (handles duplicate time slots)
              if (room) {
                const idx = weeks.findIndex((w) => w.start_time === startTime && w.day_of_week === dayOfWeek && w.room === room)
                if (idx >= 0) return idx
              }
              const idx = weeks.findIndex((w) => w.start_time === startTime && w.day_of_week === dayOfWeek)
              if (idx >= 0) return idx
            }
            return weeks.findIndex((w) => w.start_time === startTime)
          })()
        : -1
      setEditFileState({ courseId, weekIndex, data })
      // Form values are set via useEffect watching editFileState
    } catch (_) {
      /* ignore */
    } finally {
      setEditFileLoading(false)
    }
  }

  async function handleSaveEdit(values: Record<string, unknown>) {
    if (!editFileState) return
    setEditFileSaving(true)
    try {
      const weeks: WeekEntry[] = Array.isArray(editFileState.data.weeks)
        ? [...(editFileState.data.weeks as WeekEntry[])]
        : []
      // week_floor is string[] from tags Select — take first entry
      const floorArr = Array.isArray(values.week_floor) ? values.week_floor as string[] : []
      const floor = floorArr[0] ?? (typeof values.week_floor === 'string' ? values.week_floor : '')
      let newBuilding = (values.week_building as string) || null
      if (newBuilding && floor) {
        newBuilding = `${newBuilding}, ${floor}`
      }
      if (editFileState.weekIndex >= 0 && editFileState.weekIndex < weeks.length) {
        weeks[editFileState.weekIndex] = {
          ...weeks[editFileState.weekIndex],
          room: (values.week_room as string) || null,
          building: newBuilding,
          location: (values.week_location as string) || weeks[editFileState.weekIndex].location || null,
          note: (values.week_note as string) || null,
        }
      }
      const payload = { ...editFileState.data, weeks }
      if (batchEditChecked) {
        // Batch mode: apply same room/building change to ALL matching courses/weeks
        setBatchEditSaving(true)
        const origWeek = (editFileState.data.weeks as WeekEntry[])[editFileState.weekIndex]
        await adminFetch('/api/admin/batch-edit-room', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            originalRoom: origWeek.room || null,
            originalBuilding: origWeek.building || null,
            newRoom: (values.week_room as string) || null,
            newBuilding: newBuilding,
          }),
        })
        setBatchEditSaving(false)
      } else {
        await adminFetch(`/api/admin/course-file/${encodeURIComponent(editFileState.courseId)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
      }
      setEditFileState(null)
    } catch (_) {
      /* ignore */
    } finally {
      setEditFileSaving(false)
    }
  }

  async function handleAddToNoteMap() {
    if (!editFileState || editFileState.weekIndex < 0) return
    const values = editForm.getFieldsValue()
    const note = (values.week_note as string) || null
    if (!note) { void message.warning('This occurrence has no note text to map.'); return }
    const room = (values.week_room as string) || null
    const floorArr = Array.isArray(values.week_floor) ? values.week_floor as string[] : []
    const floor = floorArr[0] ?? (typeof values.week_floor === 'string' ? values.week_floor : '')
    let building = (values.week_building as string) || null
    if (building && floor) building = `${building}, ${floor}`
    if (!room || !building) { void message.warning('Please set a room and building first.'); return }
    setNoteMapOriginal(note.trim())
    setNoteMapPattern(note.trim())
    setNoteMapMatchType('exact')
    setNoteMapOrganisation((editFileState.data.organisation as string) || '')
    setNoteMapModalOpen(true)
  }

  async function handleAddLocationToNoteMap() {
    if (!editFileState || editFileState.weekIndex < 0) return
    const values = editForm.getFieldsValue()
    const location = (values.week_location as string) || null
    if (!location) { void message.warning('The Location field is empty — enter a value to map.'); return }
    const room = (values.week_room as string) || null
    const floorArr = Array.isArray(values.week_floor) ? values.week_floor as string[] : []
    const floor = floorArr[0] ?? (typeof values.week_floor === 'string' ? values.week_floor : '')
    let building = (values.week_building as string) || null
    if (building && floor) building = `${building}, ${floor}`
    if (!room || !building) { void message.warning('Please set a room and building first.'); return }
    setNoteMapOriginal(location.trim())
    setNoteMapPattern(location.trim())
    setNoteMapMatchType('exact')
    setNoteMapOrganisation((editFileState.data.organisation as string) || '')
    setNoteMapModalOpen(true)
  }

  async function handleAddFurtherInfoToNoteMap() {
    if (!editFileState) return
    const furtherInfo = editFileState.data.further_info as string | undefined | null
    if (!furtherInfo) { void message.warning('This course has no further information text to map.'); return }
    const values = editForm.getFieldsValue()
    const room = (values.week_room as string) || null
    const floorArr = Array.isArray(values.week_floor) ? values.week_floor as string[] : []
    const floor = floorArr[0] ?? (typeof values.week_floor === 'string' ? values.week_floor : '')
    let building = (values.week_building as string) || null
    if (building && floor) building = `${building}, ${floor}`
    if (!room || !building) { void message.warning('Please set a room and building first.'); return }
    setNoteMapOriginal(furtherInfo.trim())
    setNoteMapPattern(furtherInfo.trim())
    setNoteMapMatchType('contains')
    setNoteMapOrganisation((editFileState.data.organisation as string) || '')
    setNoteMapModalOpen(true)
  }

  async function handleNoteMapConfirm() {
    if (!editFileState || editFileState.weekIndex < 0) return
    const values = editForm.getFieldsValue()
    const room = (values.week_room as string) || null
    const floorArr = Array.isArray(values.week_floor) ? values.week_floor as string[] : []
    const floor = floorArr[0] ?? (typeof values.week_floor === 'string' ? values.week_floor : '')
    let building = (values.week_building as string) || null
    if (building && floor) building = `${building}, ${floor}`
    if (!room || !building) return
    setNoteMapSaving(true)
    try {
      const res = await adminFetch('/api/admin/note-location-map', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: noteMapPattern.trim(), room, building, match: noteMapMatchType, organisation: noteMapOrganisation.trim() || undefined }),
      })
      const result = await res.json()
      if (!res.ok) { void message.error(result.error || 'Failed to update note-location-map'); return }
      setNoteMapModalOpen(false)
      void message.success(`Saved to note-location-map · ${result.syncedCourses} course(s) re-synced`)
    } catch (_) {
      void message.error('Network error')
    } finally {
      setNoteMapSaving(false)
    }
  }

  const timelineMinWidth = 140 + (TRACK_END_HOUR - TRACK_START_HOUR) * 60 * PIXELS_PER_MINUTE
  const isSearchMode = !loading && deferredSearch.trim().length > 0

  function renderCourseCard(event: TimelineEvent, room: RoomEntry, left: number, top: number, width: number, key: string) {
    const professor = resolveLocalizedText(event.course.prof, language)
    const courseName = resolveLocalizedText(event.course.name, language) || 'Untitled'
    const courseId = event.course.id || ''
    const isSkipped = courseId ? skipSet.has(courseId) : false

    return (
      <button
        key={key}
        type="button"
        className="hei-event"
        style={{
          position: 'absolute',
          left,
          top,
          width,
          height: EVENT_HEIGHT,
          opacity: isSkipped ? 0.4 : 1,
          outline: isSkipped ? '2px dashed #ff4d4f' : undefined,
        }}
        onClick={() => setSelectedCourse({ room: room.room, course: event.course, startMinutes: event.start, endMinutes: event.end, dayOfWeek: selectedDate.day() })}
      >
        <span className="hei-event-title">{courseName}</span>
        <span className="hei-event-meta">{professor || '—'}</span>
        <span className="hei-event-time">
          {formatMinutesToTime(event.start)} - {formatMinutesToTime(event.end)}
        </span>
      </button>
    )
  }

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
                  <a href="/admin" style={{ display: 'flex', alignItems: 'center' }}>
                    <img src="/heiView_logo.png" alt="heiView" className="hei-brand-logo" />
                  </a>
                  <Tag color="orange" style={{ marginLeft: 8, fontWeight: 600 }}>Admin</Tag>
                </div>
                <Select
                  size="large"
                  value={selectedCampus}
                  options={CAMPUS_OPTIONS.map((c) => ({ value: c, label: formatCampusOptionLabel(c) }))}
                  popupMatchSelectWidth={false}
                  popupClassName="hei-campus-dropdown"
                  onChange={(v) => setSelectedCampus(v as Campus)}
                  className="hei-topbar-campus"
                />
                <Select
                  size="large"
                  value={activeBuildingId || undefined}
                  placeholder="No building selected"
                  options={filteredBuildingOptions.map(({ campus, ...o }) => o)}
                  popupMatchSelectWidth={false}
                  onChange={(v) => setSelectedBuilding(v)}
                  disabled={filteredBuildingOptions.length === 0}
                  className="hei-topbar-building"
                  virtual={false}
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
                    onChange={(v) => {
                      const d = v || dayjs()
                      setSelectedDate(d)
                      try { sessionStorage.setItem('admin-selected-date', d.format('YYYY-MM-DD')) } catch (_) { /* ignore */ }
                    }}
                    className="hei-topbar-date"
                  />
                  <DarkModeButton className="hei-toolbar-icon-button" />
                  <Input
                    size="large"
                    allowClear
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Course or lecturer"
                    suffix={<SearchOutlined className="hei-toolbar-search-icon" />}
                    className="hei-toolbar-search"
                  />
                  {superAdmin && (
                    <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexShrink: 0 }}>
                      <Tooltip title="Further Info Queue">
                        <Badge count={fiQueueList.length} size="small" overflowCount={99}>
                          <Button
                            size="large"
                            icon={<UnorderedListOutlined />}
                            className="hei-toolbar-icon-button"
                            onClick={async () => {
                              setFiQueueOpen(true)
                              setFiShowSkipped(false)
                              setFiQueueLoading(true)
                              try {
                                const [rq, rs] = await Promise.all([
                                  adminFetch('/api/admin/further-info-queue'),
                                  adminFetch('/api/admin/further-info-skip'),
                                ])
                                if (rq.ok) setFiQueueList(await rq.json())
                                if (rs.ok) setFiSkipSet(new Set(await rs.json()))
                              } finally { setFiQueueLoading(false) }
                            }}
                          />
                        </Badge>
                      </Tooltip>
                      <Tooltip title={staleList.length > 0 ? `Stale Overrides (${staleList.length})` : 'Stale Overrides'}>
                        <Badge
                          count={staleList.length}
                          size="small"
                          color={staleList.some(e => e.sourceDeleted) ? '#ff4d4f' : staleList.length > 0 ? '#faad14' : undefined}
                          overflowCount={99}
                        >
                          <Button
                            size="large"
                            icon={<WarningOutlined />}
                            className="hei-toolbar-icon-button"
                            style={staleList.length > 0 ? (staleList.some(e => e.sourceDeleted) ? { color: '#ff4d4f' } : { color: '#faad14' }) : undefined}
                            onClick={async () => {
                              setStaleOpen(true)
                              setStaleLoading(true)
                              setStaleDiffCourseId(null)
                              setStaleDiffData(null)
                              try {
                                const r = await adminFetch('/api/admin/stale-overrides')
                                if (r.ok) setStaleList(await r.json())
                              } finally { setStaleLoading(false) }
                            }}
                          />
                        </Badge>
                      </Tooltip>
                      <Tooltip title={feedbackList.filter(f => f.status === 'pending').length > 0 ? `User Feedback (${feedbackList.filter(f => f.status === 'pending').length} pending)` : 'User Feedback'}>
                        <Badge count={feedbackList.filter(f => f.status === 'pending').length} size="small" overflowCount={99}>
                          <Button
                            size="large"
                            icon={<MessageOutlined />}
                            className="hei-toolbar-icon-button"
                            onClick={async () => {
                              setFeedbackOpen(true)
                              setFeedbackLoading(true)
                              try {
                                const r = await adminFetch('/api/admin/feedback')
                                if (r.ok) setFeedbackList(await r.json())
                              } finally { setFeedbackLoading(false) }
                            }}
                          />
                        </Badge>
                      </Tooltip>
                    </div>
                  )}
                </div>
                <div className="hei-toolbar-admin">
                  {superAdmin && (
                    <>
                      <Button
                        size="large"
                        onClick={async () => {
                          setAccountsOpen(true)
                          setAccountsLoading(true)
                          try {
                            const r = await adminFetch('/api/admin/accounts')
                            if (r.ok) setAccountsList(await r.json())
                          } finally { setAccountsLoading(false) }
                        }}
                      >
                        Accounts
                      </Button>
                    </>
                  )}
                  <Button
                    size="large"
                    icon={<LogoutOutlined />}
                    onClick={handleLogout}
                    danger
                  >
                    Logout
                  </Button>
                </div>
              </div>
            </div>
          </header>

          <div className="hei-shell">
            {error && <Alert type="error" showIcon className="hei-error" message={`Load failed: ${error}`} />}

            <section className="hei-board-card">
              <div className="hei-board-controls">
                <div className="hei-campus-building-row">
                  <Button
                    size="large"
                    disabled={!activeBuildingId || activeBuildingId === 'No Information'}
                    onClick={handleOpenBuildingEdit}
                  >
                    Edit Building
                  </Button>
                  <Button
                    size="large"
                    disabled={!activeBuildingId || activeBuildingId === 'No Information'}
                    onClick={handleOpenRoomsManage}
                  >
                    Edit Rooms
                  </Button>
                  <Button
                    size="large"
                    type="dashed"
                    onClick={handleOpenBuildingAdd}
                  >
                    + New Building
                  </Button>
                  <Button
                    size="large"
                    type="dashed"
                    onClick={async () => {
                      newEventForm.resetFields()
                      setNewEventCampus('')
                      setNewEventOpen(true)
                      // Lazy-load buildings list for the building selector
                      if (!allBuildingsList) {
                        const r = await adminFetch('/api/admin/buildings')
                        if (r.ok) setAllBuildingsList(await r.json())
                      }
                    }}
                  >
                    + New Event
                  </Button>
                </div>
              </div>

              <div className="hei-board-controls-divider" />

              <div className="hei-board-frame">
                {loading ? (
                  <div className="hei-board-loading">
                    <Spin size="large" />
                    <Typography.Text type="secondary">Loading course data...</Typography.Text>
                  </div>
                ) : isSearchMode ? (
                  searchLoading ? (
                    <div className="hei-board-loading">
                      <Spin size="large" />
                      <Typography.Text type="secondary">Searching...</Typography.Text>
                    </div>
                  ) : searchResults.length === 0 ? (
                    <div className="hei-empty-state">
                      <Empty description="No courses match your search" />
                    </div>
                  ) : (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '16px', padding: '16px' }}>
                      {searchResults.map((result, idx) => {
                        const courseId = result.course.id || ''
                        const isSkipped = courseId ? skipSet.has(courseId) : false
                        return (
                          <div
                            key={`search-${idx}`}
                            className="hei-event"
                            style={{ position: 'relative', width: '100%', height: '140px', padding: '12px', cursor: 'pointer', overflow: 'hidden', opacity: isSkipped ? 0.4 : 1, outline: isSkipped ? '2px dashed #ff4d4f' : undefined }}
                            onClick={() => setSelectedCourse({ room: result.room, course: result.course, startMinutes: result.startMinutes, endMinutes: result.endMinutes, dayOfWeek: result.targetDate ? dayjs(result.targetDate).day() : selectedDate.day(), buildingId: result.buildingId, buildingLabel: result.buildingLabel, targetDate: result.targetDate })}
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
                        )
                      })}
                    </div>
                  )
                ) : activeBuildingId === 'No Information' ? (
                  <div className="hei-no-info-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '16px', padding: '16px' }}>
                    {(() => {
                      const allCourses = visibleRoomGroups.flatMap((g) =>
                        g.rooms.flatMap((r) => getVisibleRoomCourses(r, deferredSearch.trim().toLowerCase(), language)),
                      )
                      return allCourses.map((event, idx) => {
                        const courseId = event.id || ''
                        const isSkipped = courseId ? skipSet.has(courseId) : false
                        return (
                          <div
                            key={idx}
                            className="hei-event"
                            style={{ position: 'relative', width: '100%', height: 'auto', minHeight: 140, padding: '12px', cursor: 'pointer', opacity: isSkipped ? 0.4 : 1, outline: isSkipped ? '2px dashed #ff4d4f' : undefined }}
                            onClick={() => setSelectedCourse({ room: 'No Information', course: event, startMinutes: 0, endMinutes: 0, dayOfWeek: selectedDate.day() })}
                          >
                            <span className="hei-event-title" style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', whiteSpace: 'normal' }}>{resolveLocalizedText(event.name, language)}</span>
                            <span className="hei-event-meta" style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', whiteSpace: 'normal' }}>{resolveLocalizedText(event.prof, language) || '—'}</span>
                          </div>
                        )
                      })
                    })()}
                  </div>
                ) : visibleRoomGroups.length > 0 ? (
                  <>
                    <div className="hei-timetable-head" style={{ width: `max(100%, ${timelineMinWidth}px)` }}>
                      <div className="hei-timetable-head-label" />
                      <div className="hei-timetable-head-track">
                        {Array.from({ length: TRACK_END_HOUR - TRACK_START_HOUR + 1 }, (_, i) => TRACK_START_HOUR + i).map((hour) => {
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
                    <div className="hei-timetable" role="table" aria-label="Course timeline" style={{ width: `max(100%, ${timelineMinWidth}px)`, borderTopLeftRadius: 0, borderTopRightRadius: 0 }}>
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
                                return { course, start, end, startOffset, endOffset }
                              })
                              .filter((e): e is TimelineEvent => e !== null)

                            const clusters = clusterEvents(parsedEvents)

                            return (
                              <div key={`${group.floor}-${room.room}`} className="hei-room-row" style={{ minHeight: ROOM_ROW_HEIGHT }}>
                                <div className="hei-room-label">
                                  <span>{(room.displayName || room.room).replace(/\s*\/\s*/g, ' / ')}</span>
                                </div>
                                <div className="hei-room-track" style={{ minHeight: ROOM_ROW_HEIGHT }}>
                                  {Array.from({ length: TRACK_END_HOUR - TRACK_START_HOUR + 1 }, (_, i) => i).map((i) => (
                                    <div key={i} className="hei-grid-line" style={{ left: i * 60 * PIXELS_PER_MINUTE }} />
                                  ))}
                                  {clusters.flatMap((cluster, ci) => {
                                    const columns: TimelineEvent[][] = []
                                    cluster.forEach((event) => {
                                      let placed = false
                                      for (const col of columns) {
                                        if (col[col.length - 1].end <= event.start) { col.push(event); placed = true; break }
                                      }
                                      if (!placed) columns.push([event])
                                    })
                                    return cluster.map((event) => {
                                      const colIdx = columns.findIndex((col) => col.includes(event))
                                      const colCount = Math.max(1, columns.length)
                                      const durationPx = Math.max(30, (event.endOffset - event.startOffset) * PIXELS_PER_MINUTE)
                                      const slotWidth = Math.max(24, Math.floor(durationPx / colCount) - 6)
                                      const left = event.startOffset * PIXELS_PER_MINUTE + colIdx * slotWidth
                                      const top = 7 + colIdx * 4
                                      const courseName = resolveLocalizedText(event.course.name, language) || 'Untitled'
                                      return renderCourseCard(event, room, left, top, slotWidth, `${room.room}-${ci}-${event.start}-${event.end}-${courseName}`)
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
                  </>
                ) : (
                  <div className="hei-empty-state">
                    <Empty description="No course data is available for the selected date" />
                  </div>
                )}
              </div>
            </section>
          </div>
        </Layout.Content>

        {/* Course detail modal */}
        <Modal
          open={selectedCourse !== null}
          onCancel={() => setSelectedCourse(null)}
          footer={null}
          title={
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingRight: 32 }}>
              <span style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', whiteSpace: 'normal', wordBreak: 'break-word', paddingRight: 8 }}>
                {selectedCourse ? resolveLocalizedText(selectedCourse.course.name, language) : ''}
              </span>
              {selectedCourse?.course.id && (
                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                  <button
                    type="button"
                    disabled={skipLoading === selectedCourse.course.id}
                    onClick={() => handleSkipToggle(selectedCourse.course.id!)}
                    style={{
                      padding: '2px 10px',
                      borderRadius: 4,
                      border: `1px solid ${skipSet.has(selectedCourse.course.id) ? '#52c41a' : '#ff4d4f'}`,
                      background: 'transparent',
                      color: skipSet.has(selectedCourse.course.id) ? '#52c41a' : '#ff4d4f',
                      fontSize: 12,
                      fontWeight: 500,
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {skipSet.has(selectedCourse.course.id) ? 'Undo Skip' : 'Skip'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const startTime = formatMinutesToTime(selectedCourse.startMinutes)
                      const room = selectedCourse.room
                      setSelectedCourse(null)
                      handleOpenEdit(selectedCourse.course.id!, startTime, selectedCourse.dayOfWeek, room)
                    }}
                    style={{
                      padding: '2px 10px',
                      borderRadius: 4,
                      border: '1px solid #7ab2ff',
                      background: 'transparent',
                      color: '#7ab2ff',
                      fontSize: 12,
                      fontWeight: 500,
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    Edit
                  </button>
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
                      <span style={{ fontWeight: 'normal', color: 'var(--hei-text)' }}>Note: </span>
                      {selectedCourse.course.note}
                    </Typography.Text>
                  )}
                  {selectedCourse.course.further_info && selectedCourse.course.further_info !== '-' && (
                    <Typography.Text type="secondary" style={{ whiteSpace: 'pre-wrap', marginTop: 8, display: 'block' }}>
                      <span style={{ fontWeight: 'normal', color: 'var(--hei-text)' }}>Further information: </span>
                      {selectedCourse.course.further_info}
                    </Typography.Text>
                  )}
                  {selectedCourse.course.id && (
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      ID: <code>{selectedCourse.course.id}</code>
                      {skipSet.has(selectedCourse.course.id) && (
                        <Tag color="red" style={{ marginLeft: 8 }}>Marked to skip</Tag>
                      )}
                    </Typography.Text>
                  )}
                </Space>
              </div>
              {selectedCourse.course.link ? (
                <a href={selectedCourse.course.link} target="_blank" rel="noreferrer">{selectedCourse.course.link}</a>
              ) : (
                <Typography.Text type="secondary">No course link provided.</Typography.Text>
              )}
              {selectedCourse.buildingId && (
                <Button
                  size="small"
                  onClick={() => {
                    if (selectedCourse.targetDate) setSelectedDate(dayjs(selectedCourse.targetDate))
                    setSelectedBuilding(selectedCourse.buildingId!)
                    setSearch('')
                    setSelectedCourse(null)
                  }}
                >
                  View in timetable
                  {selectedCourse.targetDate
                    ? ` · ${dayjs(selectedCourse.targetDate).isSame(dayjs(), 'day') ? 'Today' : dayjs(selectedCourse.targetDate).format('MMM D')}`
                    : ''}
                </Button>
              )}
            </Space>
          )}
        </Modal>

        {/* Edit course file modal */}
        <Modal
          open={editFileState !== null || editFileLoading}
          onCancel={() => { setEditFileState(null); setEditFileLoading(false); }}
          title={editFileState && editFileState.weekIndex >= 0
            ? (() => {
                const w = (editFileState.data.weeks as WeekEntry[])?.[editFileState.weekIndex]
                return `Edit Occurrence — ${w?.start_time ?? ''}${w?.end_time ? `–${w.end_time}` : ''}`
              })()
            : 'Edit Course'}
          width={560}
          footer={null}
          destroyOnClose
        >
          {editFileLoading ? (
            <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>
          ) : editFileState && editFileState.weekIndex >= 0 ? (() => {
            const week = (editFileState.data.weeks as WeekEntry[])[editFileState.weekIndex]
            return (
              <Form form={editForm} layout="vertical" onFinish={handleSaveEdit}>
                <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 16, fontSize: 12 }}>
                  {`Day ${week.day_of_week ?? '?'} · ${week.start_time ?? '?'} – ${week.end_time ?? '?'}`}
                  {week.location && <span style={{ marginLeft: 8 }}>· Original: <em>{week.location}</em></span>}
                </Typography.Text>
                <Form.Item label="Building">
                  <div style={{ display: 'flex', gap: 8 }}>
                    <Select
                      style={{ width: 160, flexShrink: 0 }}
                      placeholder="Campus…"
                      allowClear
                      value={weekEditCampus || undefined}
                      options={BUILDING_CAMPUS_OPTIONS}
                      onChange={(v: string | undefined) => {
                        setWeekEditCampus(v || '')
                        editForm.setFieldValue('week_building', undefined)
                        setEditRoomOptions([])
                      }}
                    />
                    <Form.Item name="week_building" noStyle>
                      <Select
                        showSearch
                        allowClear
                        placeholder="Select building…"
                        optionFilterProp="label"
                        options={bldOptions}
                        style={{ flex: 1 }}
                        onChange={() => editForm.setFieldValue('week_room', undefined)}
                      />
                    </Form.Item>
                  </div>
                </Form.Item>
                <Form.Item name="week_room" label="Room">
                  <AutoComplete
                    options={editRoomOptions}
                    filterOption={(input, option) =>
                      (option?.value ?? '').toLowerCase().includes(input.toLowerCase())
                    }
                    placeholder="e.g. Übungsraum 110.02.05 (4110.02.005)"
                  />
                </Form.Item>
                <Form.Item name="week_floor" label="Floor">
                  <Select
                    mode="tags"
                    maxCount={1}
                    placeholder="Select or type a floor…"
                    options={COMMON_FLOORS.map(f => ({ value: f, label: f }))}
                    tokenSeparators={[',']}
                  />
                </Form.Item>
                <Form.Item label="Note">
                  <Form.Item name="week_note" noStyle>
                    <Input.TextArea rows={2} />
                  </Form.Item>
                  <Button size="small" style={{ marginTop: 6 }} onClick={handleAddToNoteMap}>Add to Note Map</Button>
                </Form.Item>
                {editFileState.data.further_info && editFileState.data.further_info !== '-' && (
                  <Form.Item label="Further information (course-level)">
                    <Input.TextArea
                      rows={3}
                      value={editFileState.data.further_info as string}
                      readOnly
                      style={{ color: 'var(--hei-text-secondary)', background: 'var(--hei-bg-secondary, #f5f5f5)', cursor: 'default' }}
                    />
                    <Button
                      size="small"
                      style={{ marginTop: 6 }}
                      onClick={handleAddFurtherInfoToNoteMap}
                    >
                      Add to Note Map
                    </Button>
                  </Form.Item>
                )}
                <Form.Item name="week_location" label="Location (raw string, optional override)">
                  <Input placeholder="Leave empty to keep original" />
                </Form.Item>
                <Button
                  size="small"
                  loading={noteMapSaving}
                  style={{ marginTop: -8, marginBottom: 16 }}
                  onClick={handleAddLocationToNoteMap}
                  title="Add the Location field value as a mapping key in note-location-map.json so courses with this text in their note or location fields auto-resolve to this room/building"
                >
                  Add to Location Map
                </Button>
                <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 16, fontSize: 12 }}>
                  Saved to <code>overrides/course-{editFileState.courseId}.json</code> and synced to SQLite automatically.
                </Typography.Text>
                {batchEditCount && batchEditCount.totalWeeks > 1 && (
                  <Form.Item style={{ marginBottom: 12 }}>
                    <Checkbox
                      checked={batchEditChecked}
                      onChange={e => setBatchEditChecked(e.target.checked)}
                    >
                      Also update all {batchEditCount.totalWeeks} occurrences with the same room
                      <Typography.Text type="secondary" style={{ fontSize: 11, marginLeft: 6 }}>
                        ({batchEditCount.matches.length} course{batchEditCount.matches.length > 1 ? 's' : ''})
                      </Typography.Text>
                    </Checkbox>
                  </Form.Item>
                )}
                <Form.Item style={{ marginBottom: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 8 }}>
                    <Button onClick={() => setEditFileState(null)}>Cancel</Button>
                    <Button type="primary" htmlType="submit" loading={editFileSaving || batchEditSaving}>
                      {batchEditChecked ? 'Save to all matching' : 'Save to overrides'}
                    </Button>
                  </div>
                </Form.Item>
              </Form>
            )
          })() : null}
        </Modal>

        {/* Note-to-map confirmation modal */}
        <Modal
          open={noteMapModalOpen}
          title="Add note to location map"
          onCancel={() => setNoteMapModalOpen(false)}
          onOk={handleNoteMapConfirm}
          okText="Save mapping"
          confirmLoading={noteMapSaving}
          destroyOnClose
          width={520}
        >
          <div style={{ marginBottom: 12 }}>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              Original note text is pre-filled. Trim it to just the location-relevant part if needed.
              If you shorten the pattern, switch match type to <b>contains</b>.
            </Typography.Text>
          </div>
          <div style={{ marginBottom: 12 }}>
            <Typography.Text strong style={{ display: 'block', marginBottom: 4 }}>Match pattern</Typography.Text>
            <Input.TextArea
              rows={3}
              value={noteMapPattern}
              onChange={e => {
                const val = e.target.value
                setNoteMapPattern(val)
                if (val.trim() !== noteMapOriginal) {
                  setNoteMapMatchType('contains')
                } else {
                  setNoteMapMatchType('exact')
                }
              }}
            />
            {noteMapPattern.trim() !== noteMapOriginal && (
              <Typography.Text type="warning" style={{ fontSize: 12 }}>
                Pattern differs from original note — match type switched to <b>contains</b>.
              </Typography.Text>
            )}
          </div>
          <div>
            <Typography.Text strong style={{ display: 'block', marginBottom: 4 }}>Match type</Typography.Text>
            <Select
              value={noteMapMatchType}
              onChange={v => setNoteMapMatchType(v)}
              options={[
                { value: 'exact', label: 'exact — note must equal pattern exactly' },
                { value: 'contains', label: 'contains — note must contain pattern as substring' },
              ]}
              style={{ width: '100%' }}
            />
          </div>
          <div style={{ marginTop: 12 }}>
            <Typography.Text strong style={{ display: 'block', marginBottom: 4 }}>Organisation (optional)</Typography.Text>
            <Input
              value={noteMapOrganisation}
              onChange={e => setNoteMapOrganisation(e.target.value)}
              placeholder="Leave blank to match any organisation"
              allowClear
            />
            <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 4 }}>
              When set, this mapping only applies to courses whose organisation contains this string (case-insensitive).
            </Typography.Text>
          </div>
        </Modal>

        {/* Accounts modal (superadmin only) */}
        {superAdmin && (
          <Modal
            open={accountsOpen}
            onCancel={() => { setAccountsOpen(false); accountForm.resetFields() }}
            title="Account Management"
            width={680}
            footer={null}
            destroyOnClose
          >
            <Spin spinning={accountsLoading}>
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
                <Button
                  size="small"
                  onClick={async () => {
                    setAccountsOpen(false)
                    setAuditOpen(true)
                    setAuditLoading(true)
                    try {
                      const r = await adminFetch('/api/admin/audit-log?limit=200')
                      if (r.ok) setAuditLog(await r.json())
                    } finally { setAuditLoading(false) }
                  }}
                >
                  Audit Log
                </Button>
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 20 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--hei-border)' }}>
                    <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 600 }}>Username</th>
                    <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 600 }}>Role</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {accountsList.map(acc => (
                    <tr key={acc.username} style={{ borderBottom: '1px solid var(--hei-border)' }}>
                      <td style={{ padding: '6px 8px' }}>{acc.username}</td>
                      <td style={{ padding: '6px 8px' }}>
                        <Tag color={acc.role === 'superadmin' ? 'orange' : 'blue'}>{acc.role}</Tag>
                      </td>
                      <td style={{ padding: '6px 8px', textAlign: 'right' }}>
                        {acc.role !== 'superadmin' && (
                          <Button
                            size="small"
                            danger
                            onClick={async () => {
                              if (!window.confirm(`Delete account "${acc.username}"?`)) return
                              const r = await adminFetch(`/api/admin/accounts/${encodeURIComponent(acc.username)}`, { method: 'DELETE' })
                              if (!r.ok) { const e = await r.json(); alert(e.error || 'Failed'); return }
                              setAccountsList(prev => prev.filter(a => a.username !== acc.username))
                            }}
                          >Delete</Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <Typography.Text strong style={{ display: 'block', marginBottom: 12 }}>Add account</Typography.Text>
              <Form
                form={accountForm}
                layout="vertical"
                onFinish={async (vals: { username: string; password: string; role: string }) => {
                  setAccountSaving(true)
                  try {
                    const r = await adminFetch('/api/admin/accounts', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify(vals),
                    })
                    if (!r.ok) { const e = await r.json(); alert(e.error || 'Failed'); return }
                    accountForm.resetFields()
                    const listR = await adminFetch('/api/admin/accounts')
                    if (listR.ok) setAccountsList(await listR.json())
                  } finally { setAccountSaving(false) }
                }}
              >
                <Row gutter={12}>
                  <Col span={9}>
                    <Form.Item name="username" label="Username" rules={[{ required: true }]}>
                      <Input placeholder="alice" />
                    </Form.Item>
                  </Col>
                  <Col span={8}>
                    <Form.Item name="password" label="Password" rules={[{ required: true, min: 6 }]}>
                      <Input.Password placeholder="min 6 chars" />
                    </Form.Item>
                  </Col>
                  <Col span={7}>
                    <Form.Item name="role" label="Role" rules={[{ required: true }]} initialValue="editor">
                      <Select options={[{ value: 'editor', label: 'Editor' }, { value: 'superadmin', label: 'Superadmin' }]} />
                    </Form.Item>
                  </Col>
                </Row>
                <Form.Item style={{ marginBottom: 0, textAlign: 'right' }}>
                  <Button type="primary" htmlType="submit" loading={accountSaving}>Add Account</Button>
                </Form.Item>
              </Form>
            </Spin>
          </Modal>
        )}

        {/* Audit Log modal (superadmin only) */}
        {superAdmin && (
          <Modal
            open={auditOpen}
            onCancel={() => setAuditOpen(false)}
            title="Audit Log (last 200 actions)"
            width={720}
            footer={null}
            destroyOnClose
          >
            <Spin spinning={auditLoading}>
              <div style={{ maxHeight: 480, overflowY: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead style={{ position: 'sticky', top: 0, background: 'var(--hei-surface)', zIndex: 1 }}>
                    <tr style={{ borderBottom: '1px solid var(--hei-border)' }}>
                      <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 600, whiteSpace: 'nowrap' }}>Time</th>
                      <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 600 }}>User</th>
                      <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 600 }}>Action</th>
                      <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 600 }}>Target</th>
                      <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 600 }}>Summary</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {auditLog.map((entry, i) => {
                      const canUndo = !!entry.id && !entry.undone && entry.username !== currentUser
                      const isUndoing = !!entry.id && undoLoadingSet.has(entry.id)
                      return (
                        <tr key={i} style={{ borderBottom: '1px solid var(--hei-border)', verticalAlign: 'top', opacity: entry.undone ? 0.45 : 1 }}>
                          <td style={{ padding: '5px 8px', whiteSpace: 'nowrap', color: 'var(--hei-text-secondary)', fontSize: 12 }}>
                            {new Date(entry.ts).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                          </td>
                          <td style={{ padding: '5px 8px' }}>
                            <Tag color="blue" style={{ margin: 0 }}>{entry.username}</Tag>
                          </td>
                          <td style={{ padding: '5px 8px', whiteSpace: 'nowrap' }}>
                            <Typography.Text code style={{ fontSize: 12 }}>{entry.action}</Typography.Text>
                          </td>
                          <td style={{ padding: '5px 8px', maxWidth: 120, wordBreak: 'break-all', fontSize: 12, color: 'var(--hei-text-secondary)' }}>
                            {entry.target || '—'}
                          </td>
                          <td style={{ padding: '5px 8px', fontSize: 12 }}>{entry.undone ? <Typography.Text type="secondary" italic>Undone</Typography.Text> : (entry.summary || '—')}</td>
                          <td style={{ padding: '5px 8px', whiteSpace: 'nowrap' }}>
                            {canUndo && (
                              <Button
                                size="small"
                                loading={isUndoing}
                                onClick={async () => {
                                  if (!entry.id) return
                                  if (!window.confirm(`Undo "${entry.action}" by ${entry.username}?`)) return
                                  setUndoLoadingSet(prev => new Set(prev).add(entry.id!))
                                  try {
                                    const r = await adminFetch(`/api/admin/audit-log/${encodeURIComponent(entry.id!)}/undo`, { method: 'POST' })
                                    if (!r.ok) { const e = await r.json(); alert(e.error || 'Undo failed'); return }
                                    // Refresh log
                                    const lr = await adminFetch('/api/admin/audit-log?limit=200')
                                    if (lr.ok) setAuditLog(await lr.json())
                                  } finally {
                                    setUndoLoadingSet(prev => { const s = new Set(prev); s.delete(entry.id!); return s })
                                  }
                                }}
                              >Undo</Button>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                    {auditLog.length === 0 && !auditLoading && (
                      <tr><td colSpan={6} style={{ textAlign: 'center', padding: 24, color: 'var(--hei-text-secondary)' }}>No audit entries yet.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Spin>
          </Modal>
        )}

        {/* Further Info Queue modal */}
        {superAdmin && (
          <Modal
            open={fiQueueOpen}
            onCancel={() => setFiQueueOpen(false)}
            title={`Further Info Queue${fiQueueList.length > 0 ? ` (${fiQueueList.length})` : ''}`}
            width={740}
            footer={null}
            destroyOnClose
          >
            <Spin spinning={fiQueueLoading}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <Typography.Text type="secondary" style={{ flex: 1, fontSize: 12 }}>
                  Courses with time info in <code>further_info</code> but no schedule weeks. Add an override to place them in the timetable, or skip if there's nothing actionable.
                </Typography.Text>
                <Button
                  size="small"
                  type={fiShowSkipped ? 'primary' : 'default'}
                  onClick={() => setFiShowSkipped(v => !v)}
                >
                  {fiShowSkipped ? '← Active' : `Skipped (${fiSkipSet.size})`}
                </Button>
              </div>
              {(() => {
                const visible = fiQueueList.filter(e => fiShowSkipped ? fiSkipSet.has(e.id) : !fiSkipSet.has(e.id))
                if (visible.length === 0 && !fiQueueLoading) {
                  return <Typography.Text type="secondary" style={{ display: 'block', textAlign: 'center', padding: 24 }}>
                    {fiShowSkipped ? 'No skipped courses.' : 'No courses in queue.'}
                  </Typography.Text>
                }
                return visible.map(entry => {
                  const isSkipped = fiSkipSet.has(entry.id)
                  const hasOv = entry.hasOverride
                  return (
                    <div key={entry.id} style={{ borderBottom: '1px solid var(--hei-border)', paddingBottom: 12, marginBottom: 12 }}>
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 4 }}>
                        <Typography.Text strong style={{ flex: 1 }}>{entry.title || entry.id}</Typography.Text>
                        {entry.detail_link && (
                          <a href={entry.detail_link} target="_blank" rel="noreferrer" style={{ whiteSpace: 'nowrap', fontSize: 12 }}>HeiCO ↗</a>
                        )}
                      </div>
                      {entry.organisation && (
                        <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>{entry.organisation}</Typography.Text>
                      )}
                      <div style={{ background: 'var(--hei-bg-secondary, #f5f5f5)', borderRadius: 4, padding: '6px 10px', fontSize: 12, whiteSpace: 'pre-wrap', color: 'var(--hei-text)', marginBottom: 8 }}>
                        {entry.further_info}
                      </div>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        <Button
                          size="small"
                          type={hasOv ? 'default' : 'primary'}
                          onClick={async () => {
                            setFiOverrideCourseId(entry.id)
                            setFiOverrideLoading(true)
                            let bldList = allBuildingsList
                            if (!bldList) {
                              const r = await adminFetch('/api/admin/buildings-list')
                              if (r.ok) { bldList = await r.json(); setAllBuildingsList(bldList) }
                            }
                            try {
                              const r = await adminFetch(`/api/admin/course-file/${encodeURIComponent(entry.id)}`)
                              if (r.ok) {
                                const data = await r.json()
                                setFiOverrideCourseData(data)
                                const r2 = await adminFetch(`/api/admin/course-file-both/${encodeURIComponent(entry.id)}`)
                                if (r2.ok) {
                                  const both = await r2.json()
                                  const ov = both.override
                                  let weeks: FiWeekEntry[]
                                  if (ov && Array.isArray(ov.weeks) && ov.weeks.length > 0) {
                                    setFiOverrideStartDate(ov.start_date ? dayjs(ov.start_date) : null)
                                    setFiOverrideEndDate(ov.end_date ? dayjs(ov.end_date) : null)
                                    weeks = ov.weeks.map((w: Record<string, unknown>) => {
                                      const bldStreet = (w.building as string) ?? ''
                                      const campus = (bldList || []).find(b => b.street === bldStreet)?.campusId ?? ''
                                      return {
                                        day_of_week: (w.day_of_week as number) ?? null,
                                        start_time: (w.start_time as string) ?? '',
                                        end_time: (w.end_time as string) ?? '',
                                        room: (w.room as string) ?? '',
                                        building: bldStreet,
                                        campus,
                                        floor: (w.floor as string) ?? '',
                                        note: (w.note as string) ?? '',
                                      }
                                    })
                                  } else {
                                    setFiOverrideStartDate(data.start_date ? dayjs(data.start_date as string) : null)
                                    setFiOverrideEndDate(data.end_date ? dayjs(data.end_date as string) : null)
                                    weeks = [emptyFiWeek()]
                                  }
                                  setFiOverrideWeeks(weeks)
                                  // Pre-load room options for each occurrence
                                  const roomOpts = await Promise.all(weeks.map(async wk => {
                                    if (!wk.building) return []
                                    const bld = (bldList || []).find(b => b.street === wk.building)
                                    if (!bld) return []
                                    try {
                                      const rr = await adminFetch(`/api/admin/building/${encodeURIComponent(bld.id)}/rooms`)
                                      if (rr.ok) { const rms: { name: string }[] = await rr.json(); return rms.map(rm => ({ value: rm.name })) }
                                    } catch (_) {}
                                    return []
                                  }))
                                  setFiOverrideRoomOptions(roomOpts)
                                }
                              }
                            } finally { setFiOverrideLoading(false) }
                          }}
                        >
                          {hasOv ? 'Edit Override' : 'Add Override'}
                        </Button>
                        {isSkipped ? (
                          <Button
                            size="small"
                            loading={fiSkipLoading === entry.id}
                            onClick={async () => {
                              setFiSkipLoading(entry.id)
                              try {
                                const r = await adminFetch(`/api/admin/further-info-skip/${encodeURIComponent(entry.id)}`, { method: 'DELETE' })
                                if (r.ok) setFiSkipSet(prev => { const s = new Set(prev); s.delete(entry.id); return s })
                              } finally { setFiSkipLoading(null) }
                            }}
                          >
                            Unskip
                          </Button>
                        ) : (
                          <Button
                            size="small"
                            loading={fiSkipLoading === entry.id}
                            onClick={async () => {
                              setFiSkipLoading(entry.id)
                              try {
                                const r = await adminFetch(`/api/admin/further-info-skip/${encodeURIComponent(entry.id)}`, { method: 'POST' })
                                if (r.ok) setFiSkipSet(prev => new Set(prev).add(entry.id))
                              } finally { setFiSkipLoading(null) }
                            }}
                          >
                            Skip
                          </Button>
                        )}
                        {hasOv && <Tag color="green" style={{ margin: 0, alignSelf: 'center' }}>Override saved</Tag>}
                      </div>
                    </div>
                  )
                })
              })()}
            </Spin>
          </Modal>
        )}

        {/* Further Info Queue — Override editor modal */}
        {superAdmin && (
          <Modal
            open={!!fiOverrideCourseId}
            onCancel={() => { setFiOverrideCourseId(null); setFiOverrideCourseData(null); setFiOverrideWeeks([]); setFiOverrideRoomOptions([]) }}
            title={fiOverrideCourseData ? `Override: ${fiOverrideCourseData.title || fiOverrideCourseId}` : 'Override editor'}
            width={760}
            footer={null}
            destroyOnClose
          >
            <Spin spinning={fiOverrideLoading}>
              {fiOverrideCourseData && (
                <>
                  {/* Further info reference */}
                  {(fiOverrideCourseData.further_info as string) && (
                    <div style={{ background: 'var(--hei-bg-secondary, #f5f5f5)', borderRadius: 4, padding: '6px 10px', fontSize: 12, whiteSpace: 'pre-wrap', color: 'var(--hei-text)', marginBottom: 16 }}>
                      <Typography.Text strong style={{ fontSize: 12 }}>Further information: </Typography.Text>
                      {fiOverrideCourseData.further_info as string}
                    </div>
                  )}

                  {/* Semester date range */}
                  <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
                    <div style={{ flex: 1 }}>
                      <Typography.Text strong style={{ display: 'block', marginBottom: 4, fontSize: 13 }}>Semester start</Typography.Text>
                      <DatePicker
                        style={{ width: '100%' }}
                        value={fiOverrideStartDate}
                        onChange={v => setFiOverrideStartDate(v)}
                        placeholder="YYYY-MM-DD"
                      />
                    </div>
                    <div style={{ flex: 1 }}>
                      <Typography.Text strong style={{ display: 'block', marginBottom: 4, fontSize: 13 }}>Semester end</Typography.Text>
                      <DatePicker
                        style={{ width: '100%' }}
                        value={fiOverrideEndDate}
                        onChange={v => setFiOverrideEndDate(v)}
                        placeholder="YYYY-MM-DD"
                      />
                    </div>
                  </div>

                  <Typography.Text strong style={{ display: 'block', marginBottom: 8 }}>Occurrences</Typography.Text>
                  {fiOverrideWeeks.map((wk, idx) => (
                    <div key={idx} style={{ border: '1px solid var(--hei-border)', borderRadius: 6, padding: '10px 12px', marginBottom: 10, position: 'relative' }}>
                      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8, gap: 6 }}>
                        <Typography.Text strong style={{ fontSize: 12 }}>#{idx + 1}</Typography.Text>
                        <Button
                          size="small"
                          danger
                          style={{ marginLeft: 'auto' }}
                          disabled={fiOverrideWeeks.length <= 1}
                          onClick={() => { setFiOverrideWeeks(prev => prev.filter((_, i) => i !== idx)); setFiOverrideRoomOptions(prev => prev.filter((_, i) => i !== idx)) }}
                        >Remove</Button>
                      </div>
                      <Row gutter={8}>
                        <Col span={7}>
                          <Typography.Text style={{ fontSize: 12 }}>Day of week</Typography.Text>
                          <Select
                            style={{ width: '100%', marginTop: 2 }}
                            value={wk.day_of_week ?? undefined}
                            onChange={v => setFiOverrideWeeks(prev => prev.map((w, i) => i === idx ? { ...w, day_of_week: v } : w))}
                            options={[
                              { value: 1, label: 'Monday' }, { value: 2, label: 'Tuesday' },
                              { value: 3, label: 'Wednesday' }, { value: 4, label: 'Thursday' },
                              { value: 5, label: 'Friday' }, { value: 6, label: 'Saturday' }, { value: 7, label: 'Sunday' },
                            ]}
                            placeholder="Day"
                          />
                        </Col>
                        <Col span={8}>
                          <Typography.Text style={{ fontSize: 12 }}>Start time</Typography.Text>
                          <Input
                            style={{ marginTop: 2 }}
                            placeholder="09:00"
                            value={wk.start_time}
                            onChange={e => setFiOverrideWeeks(prev => prev.map((w, i) => i === idx ? { ...w, start_time: e.target.value } : w))}
                          />
                        </Col>
                        <Col span={9}>
                          <Typography.Text style={{ fontSize: 12 }}>End time</Typography.Text>
                          <Input
                            style={{ marginTop: 2 }}
                            placeholder="10:30"
                            value={wk.end_time}
                            onChange={e => setFiOverrideWeeks(prev => prev.map((w, i) => i === idx ? { ...w, end_time: e.target.value } : w))}
                          />
                        </Col>
                      </Row>
                      <Row gutter={8} style={{ marginTop: 8 }}>
                        <Col span={8}>
                          <Typography.Text style={{ fontSize: 12 }}>Campus</Typography.Text>
                          <Select
                            style={{ width: '100%', marginTop: 2 }}
                            allowClear
                            placeholder="Campus…"
                            value={wk.campus || undefined}
                            options={BUILDING_CAMPUS_OPTIONS}
                            onChange={v => {
                              setFiOverrideWeeks(prev => prev.map((w, i) => i === idx ? { ...w, campus: v ?? '', building: '', room: '' } : w))
                              setFiOverrideRoomOptions(prev => { const next = [...prev]; next[idx] = []; return next })
                            }}
                          />
                        </Col>
                        <Col span={16}>
                          <Typography.Text style={{ fontSize: 12 }}>Building</Typography.Text>
                          <Select
                            showSearch
                            allowClear
                            style={{ width: '100%', marginTop: 2 }}
                            placeholder="Select building…"
                            optionFilterProp="label"
                            value={wk.building || undefined}
                            onChange={async v => {
                              setFiOverrideWeeks(prev => prev.map((w, i) => i === idx ? { ...w, building: v ?? '', room: '' } : w))
                              if (v) {
                                const opts: { value: string }[] = []
                                const bld = (allBuildingsList || []).find(b => b.street === v)
                                if (bld) {
                                  try {
                                    const rr = await adminFetch(`/api/admin/building/${encodeURIComponent(bld.id)}/rooms`)
                                    if (rr.ok) { const rms: { name: string }[] = await rr.json(); opts.push(...rms.map(rm => ({ value: rm.name }))) }
                                  } catch (_) {}
                                }
                                setFiOverrideRoomOptions(prev => { const next = [...prev]; next[idx] = opts; return next })
                              } else {
                                setFiOverrideRoomOptions(prev => { const next = [...prev]; next[idx] = []; return next })
                              }
                            }}
                            options={(allBuildingsList || [])
                              .filter(b => !wk.campus || b.campusId === wk.campus)
                              .map(b => ({ value: b.street, label: (b.displayName?.trim()) ? b.displayName.trim() : b.street }))
                              .sort((a, b) => String(a.label).localeCompare(String(b.label)))}
                          />
                        </Col>
                      </Row>
                      <Row gutter={8} style={{ marginTop: 8 }}>
                        <Col span={12}>
                          <Typography.Text style={{ fontSize: 12 }}>Room</Typography.Text>
                          <AutoComplete
                            style={{ width: '100%', marginTop: 2 }}
                            placeholder="e.g. 169"
                            value={wk.room}
                            options={fiOverrideRoomOptions[idx] || []}
                            filterOption={(input, option) => (option?.value ?? '').toLowerCase().includes(input.toLowerCase())}
                            onChange={v => setFiOverrideWeeks(prev => prev.map((w, i) => i === idx ? { ...w, room: v } : w))}
                          />
                        </Col>
                        <Col span={12}>
                          <Typography.Text style={{ fontSize: 12 }}>Floor (optional)</Typography.Text>
                          <Select
                            mode="tags"
                            maxCount={1}
                            style={{ width: '100%', marginTop: 2 }}
                            placeholder="Select or type a floor…"
                            options={COMMON_FLOORS.map(f => ({ value: f, label: f }))}
                            tokenSeparators={[',']}
                            value={wk.floor ? [wk.floor] : []}
                            onChange={v => setFiOverrideWeeks(prev => prev.map((w, i) => i === idx ? { ...w, floor: v[0] ?? '' } : w))}
                          />
                        </Col>
                      </Row>
                      <Row gutter={8} style={{ marginTop: 8 }}>
                        <Col span={24}>
                          <Typography.Text style={{ fontSize: 12 }}>Note (optional)</Typography.Text>
                          <Input
                            style={{ marginTop: 2 }}
                            value={wk.note}
                            onChange={e => setFiOverrideWeeks(prev => prev.map((w, i) => i === idx ? { ...w, note: e.target.value } : w))}
                          />
                        </Col>
                      </Row>
                    </div>
                  ))}
                  <Button
                    size="small"
                    onClick={() => {
                      setFiOverrideWeeks(prev => [...prev, emptyFiWeek()])
                      setFiOverrideRoomOptions(prev => [...prev, []])
                    }}
                    style={{ marginBottom: 16 }}
                  >+ Add Occurrence</Button>

                  <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                    <Button onClick={() => { setFiOverrideCourseId(null); setFiOverrideCourseData(null); setFiOverrideWeeks([]); setFiOverrideRoomOptions([]) }}>Cancel</Button>
                    <Button
                      type="primary"
                      loading={fiOverrideSaving}
                      onClick={async () => {
                        const weeks = fiOverrideWeeks
                          .filter(w => w.day_of_week !== null)
                          .map(w => ({
                            day_of_week: w.day_of_week,
                            start_time: w.start_time.trim() || null,
                            end_time: w.end_time.trim() || null,
                            room: w.room.trim() || null,
                            building: w.building.trim() || null,
                            floor: w.floor.trim() || null,
                            note: w.note.trim() || null,
                          }))
                        if (weeks.length === 0) { void message.warning('Add at least one occurrence with a day of week.'); return }
                        const payload = {
                          ...fiOverrideCourseData,
                          start_date: fiOverrideStartDate ? fiOverrideStartDate.format('YYYY-MM-DD') : (fiOverrideCourseData.start_date ?? null),
                          end_date: fiOverrideEndDate ? fiOverrideEndDate.format('YYYY-MM-DD') : (fiOverrideCourseData.end_date ?? null),
                          weeks,
                        }
                        setFiOverrideSaving(true)
                        try {
                          const r = await adminFetch(`/api/admin/course-file/${encodeURIComponent(fiOverrideCourseId!)}`, {
                            method: 'PUT',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(payload),
                          })
                          if (!r.ok) { const e = await r.json(); void message.error(e.error || 'Save failed'); return }
                          void message.success('Override saved and synced')
                          // Mark hasOverride in the list
                          setFiQueueList(prev => prev.map(e => e.id === fiOverrideCourseId ? { ...e, hasOverride: true } : e))
                          setFiOverrideCourseId(null)
                          setFiOverrideCourseData(null)
                          setFiOverrideWeeks([])
                        } finally { setFiOverrideSaving(false) }
                      }}
                    >Save Override</Button>
                  </div>
                </>
              )}
            </Spin>
          </Modal>
        )}

        {/* Stale Overrides modal */}
        <Modal
          open={staleOpen}
          onCancel={() => { setStaleOpen(false); if (staleDiffWasSaved) { setStaleList(prev => prev.filter(e => e.courseId !== staleDiffCourseId)) } setStaleDiffCourseId(null); setStaleDiffData(null); setStaleDiffWasSaved(false); setStaleDiffUndoSnapshot(null) }}
          title="Stale Overrides"
          width={staleDiffCourseId ? 900 : 600}
          footer={null}
          destroyOnClose
        >
          <Spin spinning={staleLoading}>
            {!staleDiffCourseId ? (
              <>
                {staleList.length === 0 && !staleLoading && (
                  <Typography.Text type="secondary">All overrides are up-to-date.</Typography.Text>
                )}
                {staleList.some(e => e.sourceDeleted) && (
                  <>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                      <span style={{ color: '#ff4d4f', fontWeight: 700, fontSize: 13 }}>⛔ Source Deleted</span>
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        These overrides have no source file — the course was removed by the crawler.
                      </Typography.Text>
                    </div>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, marginBottom: 16 }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid var(--hei-border)' }}>
                          <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 600 }}>Course ID</th>
                          <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 600 }}>Override saved</th>
                          <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 600 }}>In deleted/</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {staleList.filter(e => e.sourceDeleted).map(entry => (
                          <tr key={entry.courseId} style={{ borderBottom: '1px solid var(--hei-border)', verticalAlign: 'middle', background: 'rgba(255,77,79,0.04)' }}>
                            <td style={{ padding: '5px 8px' }}>
                              <Typography.Text code style={{ fontSize: 12 }}>{entry.courseId}</Typography.Text>
                            </td>
                            <td style={{ padding: '5px 8px', fontSize: 12, color: 'var(--hei-muted)' }}>
                              {new Date(entry.ovMtime).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                            </td>
                            <td style={{ padding: '5px 8px', fontSize: 12 }}>
                              {entry.inDeleted ? <span style={{ color: '#faad14' }}>Yes</span> : <span style={{ color: 'var(--hei-muted)' }}>No</span>}
                            </td>
                            <td style={{ padding: '5px 8px', whiteSpace: 'nowrap' }}>
                              <Button
                                size="small"
                                danger
                                loading={staleDeleteLoading === entry.courseId}
                                onClick={async () => {
                                  if (!window.confirm(`The source for course-${entry.courseId} has been deleted by the crawler.\n\nDelete the override file too?`)) return
                                  setStaleDeleteLoading(entry.courseId)
                                  try {
                                    const r = await adminFetch(`/api/admin/overrides/${encodeURIComponent(entry.courseId)}`, { method: 'DELETE' })
                                    if (r.ok) setStaleList(prev => prev.filter(e => e.courseId !== entry.courseId))
                                  } finally { setStaleDeleteLoading(null) }
                                }}
                                title="Delete this orphaned override file"
                              >
                                Delete Override
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </>
                )}
                {staleList.some(e => !e.sourceDeleted) && (
                  <>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                      <span style={{ color: '#faad14', fontWeight: 700, fontSize: 13 }}>⚠ Source Updated</span>
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        The crawler updated these source files after the override was saved.
                      </Typography.Text>
                    </div>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid var(--hei-border)' }}>
                          <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 600 }}>Course ID</th>
                          <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 600 }}>Source updated</th>
                          <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 600 }}>Override saved</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {staleList.filter(e => !e.sourceDeleted).map(entry => (
                          <tr key={entry.courseId} style={{ borderBottom: '1px solid var(--hei-border)', verticalAlign: 'middle' }}>
                            <td style={{ padding: '5px 8px' }}>
                              <Typography.Text code style={{ fontSize: 12 }}>{entry.courseId}</Typography.Text>
                            </td>
                            <td style={{ padding: '5px 8px', fontSize: 12, color: '#faad14' }}>
                              {entry.srcMtime ? new Date(entry.srcMtime).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'}
                            </td>
                            <td style={{ padding: '5px 8px', fontSize: 12, color: 'var(--hei-text-secondary)' }}>
                              {new Date(entry.ovMtime).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                            </td>
                            <td style={{ padding: '5px 8px', whiteSpace: 'nowrap' }}>
                              <Space>
                                <Button
                                  size="small"
                                  onClick={async () => {
                                    setStaleDiffCourseId(entry.courseId)
                                    setStaleDiffLoading(true)
                                    setStaleOverrideEdit(null)
                                    setStaleOverrideParseError(null)
                                    setStaleDiffWasSaved(false)
                                    setStaleDiffUndoSnapshot(null)
                                    try {
                                      const r = await adminFetch(`/api/admin/course-file-both/${encodeURIComponent(entry.courseId)}`)
                                      if (r.ok) setStaleDiffData(await r.json())
                                    } finally { setStaleDiffLoading(false) }
                                  }}
                                >
                                  Compare
                                </Button>
                                <Button
                                  size="small"
                                  danger
                                  loading={staleDeleteLoading === entry.courseId}
                                  onClick={async () => {
                                    if (!window.confirm(`Delete override for course-${entry.courseId}? This action cannot be undone.`)) return
                                    setStaleDeleteLoading(entry.courseId)
                                    try {
                                      const r = await adminFetch(`/api/admin/overrides/${encodeURIComponent(entry.courseId)}`, { method: 'DELETE' })
                                      if (r.ok) setStaleList(prev => prev.filter(e => e.courseId !== entry.courseId))
                                    } finally { setStaleDeleteLoading(null) }
                                  }}
                                  title="Delete override file; course will revert to source data"
                                >
                                  Delete Override
                                </Button>
                              </Space>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </>
                )}
              </>
            ) : (
              <Spin spinning={staleDiffLoading}>
                <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Button size="small" onClick={() => { if (staleDiffWasSaved) { setStaleList(prev => prev.filter(e => e.courseId !== staleDiffCourseId)) } setStaleDiffCourseId(null); setStaleDiffData(null); setStaleOverrideEdit(null); setStaleOverrideParseError(null); setStaleDiffWasSaved(false); setStaleDiffUndoSnapshot(null) }}>← Back</Button>
                  <Typography.Text strong>course-{staleDiffCourseId}.json</Typography.Text>
                  {/* Show Merge Weeks only when source.weeks differs from override.weeks */}
                  {staleDiffData?.source && staleDiffData?.override &&
                    JSON.stringify(staleDiffData.source['weeks']) !== JSON.stringify(staleDiffData.override['weeks']) && (
                    <Button
                      size="small"
                      loading={staleMergeLoading === staleDiffCourseId}
                      title="Use source weeks structure, preserving manually set building and note from override"
                      onClick={async () => {
                        if (!staleDiffCourseId) return
                        setStaleMergeLoading(staleDiffCourseId)
                        try {
                          const snapshot = staleDiffData?.override ?? null
                          const r = await adminFetch(`/api/admin/stale-overrides/${encodeURIComponent(staleDiffCourseId)}/merge-weeks`, { method: 'POST' })
                          if (r.ok) {
                            // Refresh diff view to reflect merged result
                            setStaleDiffLoading(true)
                            const r2 = await adminFetch(`/api/admin/course-file-both/${encodeURIComponent(staleDiffCourseId)}`)
                            if (r2.ok) setStaleDiffData(await r2.json())
                            setStaleDiffLoading(false)
                            setStaleDiffWasSaved(true)
                            setStaleDiffUndoSnapshot(snapshot)
                          }
                        } finally { setStaleMergeLoading(null) }
                      }}
                      style={{ marginLeft: 'auto' }}
                    >
                      Merge Weeks
                    </Button>
                  )}
                  {/* Show Merge Non-Weeks when any non-weeks field differs (e.g. further_info updated) */}
                  {staleDiffData?.source && staleDiffData?.override &&
                    hasNonWeeksDiff(staleDiffData.source, staleDiffData.override) && (
                    <Button
                      size="small"
                      loading={staleMergeNonWeeksLoading === staleDiffCourseId}
                      title="Copy all non-weeks fields from source into override (weeks remain unchanged)"
                      onClick={async () => {
                        if (!staleDiffCourseId) return
                        setStaleMergeNonWeeksLoading(staleDiffCourseId)
                        try {
                          const snapshot = staleDiffData?.override ?? null
                          const r = await adminFetch(`/api/admin/stale-overrides/${encodeURIComponent(staleDiffCourseId)}/merge-non-weeks`, { method: 'POST' })
                          if (r.ok) {
                            setStaleDiffLoading(true)
                            const r2 = await adminFetch(`/api/admin/course-file-both/${encodeURIComponent(staleDiffCourseId)}`)
                            if (r2.ok) setStaleDiffData(await r2.json())
                            setStaleDiffLoading(false)
                            setStaleDiffWasSaved(true)
                            setStaleDiffUndoSnapshot(snapshot)
                          }
                        } finally { setStaleMergeNonWeeksLoading(null) }
                      }}
                      style={staleDiffData?.source && staleDiffData?.override &&
                        JSON.stringify(staleDiffData.source['weeks']) !== JSON.stringify(staleDiffData.override['weeks'])
                        ? {} : { marginLeft: 'auto' }}
                    >
                      Merge Non-Weeks
                    </Button>
                  )}
                  {staleDiffUndoSnapshot && (
                    <Button
                      size="small"
                      loading={staleUndoLoading}
                      title="Undo last Save or Merge Weeks, restoring previous override"
                      onClick={async () => {
                        if (!staleDiffCourseId || !staleDiffUndoSnapshot) return
                        setStaleUndoLoading(true)
                        try {
                          const r = await adminFetch(`/api/admin/course-file/${encodeURIComponent(staleDiffCourseId)}`, {
                            method: 'PUT',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(staleDiffUndoSnapshot),
                          })
                          if (r.ok) {
                            setStaleDiffLoading(true)
                            const r2 = await adminFetch(`/api/admin/course-file-both/${encodeURIComponent(staleDiffCourseId)}`)
                            if (r2.ok) setStaleDiffData(await r2.json())
                            setStaleDiffLoading(false)
                            setStaleDiffUndoSnapshot(null)
                            setStaleDiffWasSaved(false)
                          }
                        } finally { setStaleUndoLoading(false) }
                      }}
                    >
                      Undo
                    </Button>
                  )}
                  <Button
                    size="small"
                    loading={staleDismissLoading === staleDiffCourseId}
                    onClick={async () => {
                      if (!staleDiffCourseId) return
                      setStaleDismissLoading(staleDiffCourseId)
                      try {
                        const r = await adminFetch(`/api/admin/stale-overrides/${encodeURIComponent(staleDiffCourseId)}/dismiss`, { method: 'POST' })
                        if (r.ok) {
                          setStaleList(prev => prev.filter(e => e.courseId !== staleDiffCourseId))
                          setStaleDiffCourseId(null)
                          setStaleDiffData(null)
                        }
                      } finally { setStaleDismissLoading(null) }
                    }}
                    style={staleDiffData?.source && staleDiffData?.override &&
                      (JSON.stringify(staleDiffData.source['weeks']) !== JSON.stringify(staleDiffData.override['weeks']) ||
                       hasNonWeeksDiff(staleDiffData.source, staleDiffData.override))
                      ? {} : { marginLeft: 'auto' }}
                  >
                    Keep Override
                  </Button>
                  <Button
                    size="small"
                    danger
                    loading={staleDeleteLoading === staleDiffCourseId}
                    onClick={async () => {
                      if (!staleDiffCourseId) return
                      if (!window.confirm(`Delete override for course-${staleDiffCourseId}? This action cannot be undone.`)) return
                      setStaleDeleteLoading(staleDiffCourseId)
                      try {
                        const r = await adminFetch(`/api/admin/overrides/${encodeURIComponent(staleDiffCourseId)}`, { method: 'DELETE' })
                        if (r.ok) {
                          setStaleList(prev => prev.filter(e => e.courseId !== staleDiffCourseId))
                          setStaleDiffCourseId(null)
                          setStaleDiffData(null)
                        }
                      } finally { setStaleDeleteLoading(null) }
                    }}
                    title="Delete override file; course will revert to source data"
                  >
                    Delete Override
                  </Button>
                </div>
                {staleDiffData && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    {/* Legend */}
                    <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 16, fontSize: 11, color: 'var(--hei-text-secondary)', marginBottom: -4 }}>
                      <span><span style={{ display: 'inline-block', width: 10, height: 10, background: 'rgba(250,173,20,0.45)', borderRadius: 2, marginRight: 4 }} />Value changed</span>
                      <span><span style={{ display: 'inline-block', width: 10, height: 10, background: 'rgba(82,196,26,0.4)', borderRadius: 2, marginRight: 4 }} />New in source</span>
                      <span><span style={{ display: 'inline-block', width: 10, height: 10, background: 'rgba(147,51,234,0.3)', borderRadius: 2, marginRight: 4 }} />Only in override</span>
                    </div>
                    <div>
                      <Typography.Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: 4 }}>
                        SOURCE (crawler) — updated {staleDiffData.srcMtime ? new Date(staleDiffData.srcMtime).toLocaleString() : '—'}
                      </Typography.Text>
                      <pre style={{ background: 'var(--hei-surface)', border: '1px solid var(--hei-border)', borderRadius: 6, padding: 10, fontSize: 11, overflowY: 'auto', maxHeight: 460, margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                        {renderJsonDiffSide(staleDiffData.source, staleDiffData.override, 'source')}
                      </pre>
                    </div>
                    <div>
                      <Typography.Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: 4 }}>
                        OVERRIDE — saved {staleDiffData.ovMtime ? new Date(staleDiffData.ovMtime).toLocaleString() : '—'}
                        <Button
                          size="small"
                          type="link"
                          style={{ fontSize: 11, padding: '0 4px', height: 'auto', marginLeft: 6 }}
                          onClick={() => {
                            if (staleOverrideEdit !== null) {
                              setStaleOverrideEdit(null)
                              setStaleOverrideParseError(null)
                            } else {
                              setStaleOverrideEdit(JSON.stringify(staleDiffData.override, null, 2))
                              setStaleOverrideParseError(null)
                            }
                          }}
                        >
                          {staleOverrideEdit !== null ? 'Cancel' : 'Edit'}
                        </Button>
                        {staleOverrideEdit !== null && (
                          <Button
                            size="small"
                            type="link"
                            loading={staleOverrideSaveLoading}
                            style={{ fontSize: 11, padding: '0 4px', height: 'auto' }}
                            onClick={async () => {
                              if (!staleDiffCourseId || staleOverrideEdit === null) return
                              let parsed: Record<string, unknown>
                              try {
                                parsed = JSON.parse(staleOverrideEdit)
                              } catch (e: unknown) {
                                setStaleOverrideParseError(e instanceof Error ? e.message : 'Invalid JSON')
                                return
                              }
                              const snapshot = staleDiffData?.override ?? null
                              setStaleOverrideSaveLoading(true)
                              try {
                                const r = await adminFetch(`/api/admin/course-file/${encodeURIComponent(staleDiffCourseId)}`, {
                                  method: 'PUT',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify(parsed),
                                })
                                if (r.ok) {
                                  // Refresh diff — stay in view so user can review the result
                                  setStaleDiffLoading(true)
                                  const r2 = await adminFetch(`/api/admin/course-file-both/${encodeURIComponent(staleDiffCourseId)}`)
                                  if (r2.ok) setStaleDiffData(await r2.json())
                                  setStaleDiffLoading(false)
                                  setStaleOverrideEdit(null)
                                  setStaleOverrideParseError(null)
                                  setStaleDiffWasSaved(true)
                                  setStaleDiffUndoSnapshot(snapshot)
                                }
                              } finally { setStaleOverrideSaveLoading(false) }
                            }}
                          >
                            Save
                          </Button>
                        )}
                      </Typography.Text>
                      {staleOverrideParseError && (
                        <Typography.Text type="danger" style={{ fontSize: 11, display: 'block', marginBottom: 4 }}>
                          {staleOverrideParseError}
                        </Typography.Text>
                      )}
                      {staleOverrideEdit !== null ? (
                        <Input.TextArea
                          value={staleOverrideEdit}
                          onChange={e => { setStaleOverrideEdit(e.target.value); setStaleOverrideParseError(null) }}
                          autoSize={false}
                          style={{ fontFamily: 'monospace', fontSize: 11, height: 460, resize: 'none', background: 'var(--hei-surface)', border: '1px solid var(--hei-border)', borderRadius: 6 }}
                          spellCheck={false}
                        />
                      ) : (
                        <pre style={{ background: 'var(--hei-surface)', border: '1px solid var(--hei-border)', borderRadius: 6, padding: 10, fontSize: 11, overflowY: 'auto', maxHeight: 460, margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                          {renderJsonDiffSide(staleDiffData.override, staleDiffData.source, 'override')}
                        </pre>
                      )}
                    </div>
                  </div>
                )}
              </Spin>
            )}
          </Spin>
        </Modal>

        {/* New Event modal */}
        <Modal
          open={newEventOpen}
          onCancel={() => setNewEventOpen(false)}
          title="New Event / Lecture"
          width={600}
          footer={null}
          destroyOnClose
        >
          <Form form={newEventForm} layout="vertical" onFinish={handleSaveNewEvent}>
            <Form.Item name="title" label="Title" rules={[{ required: true, message: 'Title is required' }]}>
              <Input placeholder="e.g. Guest Lecture: Introduction to …" />
            </Form.Item>
            <Form.Item name="type" label="Type (optional)">
              <AutoComplete
                placeholder="Select or type a type…"
                options={[
                  { value: 'L', label: 'L — Lecture (Vorlesung)' },
                  { value: 'GL', label: 'GL — Guest Lecture' },
                  { value: 'SE', label: 'SE — Seminar' },
                  { value: 'WS', label: 'WS — Workshop' },
                  { value: 'T', label: 'T — Tutorial (Tutorium / Übung)' },
                  { value: 'CO', label: 'CO — Colloquium (Kolloquium)' },
                  { value: 'P', label: 'P — Praktikum' },
                  { value: 'PC', label: 'PC — Practical Course' },
                  { value: 'C', label: 'C — Course' },
                  { value: 'BT', label: 'BT — Block Tutorial' },
                  { value: 'AG', label: 'AG — Working Group (Arbeitsgruppe)' },
                ]}
                filterOption={(inputValue, option) =>
                  !!option && option.value.toLowerCase().includes(inputValue.toLowerCase())
                }
              />
            </Form.Item>
            <Form.Item name="lecturers" label="Lecturers (one per line, optional)">
              <Input.TextArea rows={2} placeholder="Max Müller&#10;Jane Doe" />
            </Form.Item>
            <Form.Item name="detail_link" label="Link (optional)">
              <Input placeholder="https://heilearn.uni-heidelberg.de/…" />
            </Form.Item>
            <Row gutter={12}>
              <Col span={12}>
                <Form.Item name="start_date" label="Start date">
                  <DatePicker style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item name="end_date" label="End date">
                  <DatePicker style={{ width: '100%' }} />
                </Form.Item>
              </Col>
            </Row>
            <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 12, fontSize: 12 }}>
              Session (repeats weekly between the dates above)
            </Typography.Text>
            <Row gutter={12}>
              <Col span={8}>
                <Form.Item name="day_of_week" label="Day of week">
                  <Select placeholder="Day" options={[
                    { value: 1, label: 'Monday' },
                    { value: 2, label: 'Tuesday' },
                    { value: 3, label: 'Wednesday' },
                    { value: 4, label: 'Thursday' },
                    { value: 5, label: 'Friday' },
                    { value: 6, label: 'Saturday' },
                    { value: 0, label: 'Sunday' },
                  ]} />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item name="start_time" label="Start time">
                  <Input placeholder="09:00" />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item name="end_time" label="End time">
                  <Input placeholder="10:30" />
                </Form.Item>
              </Col>
            </Row>
            <Form.Item label="Building">
              <div style={{ display: 'flex', gap: 8 }}>
                <Select
                  style={{ width: 160, flexShrink: 0 }}
                  placeholder="Campus…"
                  allowClear
                  value={newEventCampus || undefined}
                  options={BUILDING_CAMPUS_OPTIONS}
                  onChange={(v: string | undefined) => {
                    setNewEventCampus(v || '')
                    newEventForm.setFieldValue('week_building', undefined)
                    setNewEventRoomOptions([])
                  }}
                />
                <Form.Item name="week_building" noStyle>
                  <Select
                    showSearch
                    allowClear
                    placeholder="Select building…"
                    optionFilterProp="label"
                    options={(allBuildingsList || [])
                      .filter(b => !newEventCampus || b.campusId === newEventCampus)
                      .map(b => ({ value: b.street, label: (b.displayName && b.displayName.trim()) ? b.displayName.trim() : b.street }))
                      .sort((a, b) => String(a.label).localeCompare(String(b.label)))}
                    style={{ flex: 1 }}
                    onChange={() => newEventForm.setFieldValue('week_room', undefined)}
                  />
                </Form.Item>
              </div>
            </Form.Item>
            <Form.Item name="week_room" label="Room">
              <AutoComplete
                options={newEventRoomOptions}
                filterOption={(input, option) =>
                  (option?.value ?? '').toLowerCase().includes(input.toLowerCase())
                }
                placeholder="e.g. Seminarraum 1"
              />
            </Form.Item>
            <Form.Item name="week_floor" label="Floor (optional)">
              <Select
                mode="tags"
                maxCount={1}
                placeholder="Leave empty → Unknown floor"
                options={COMMON_FLOORS.map(f => ({ value: f, label: f }))}
                tokenSeparators={[',']}
              />
            </Form.Item>
            <Form.Item name="week_note" label="Note (optional)">
              <Input.TextArea rows={2} />
            </Form.Item>
            <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 12, fontSize: 12 }}>
              Saved to <code>data/2026SS/custom/</code> and synced to SQLite automatically.
            </Typography.Text>
            <Form.Item style={{ marginBottom: 0, textAlign: 'right' }}>
              <Space>
                <Button onClick={() => setNewEventOpen(false)}>Cancel</Button>
                <Button type="primary" htmlType="submit" loading={newEventSaving}>Create Event</Button>
              </Space>
            </Form.Item>
          </Form>
        </Modal>
        {/* Edit / Add building modal */}
        <Modal
          open={buildingEditState !== null}
          onCancel={() => setBuildingEditState(null)}
          title={buildingEditState?.isNew ? 'New Building' : `Edit Building — ${buildingEditState?.data?.street || buildingEditState?.buildingId || ''}`}
          width={560}
          footer={null}
          destroyOnClose
        >
          {buildingEditState && (
            <Form form={buildingForm} layout="vertical" onFinish={handleSaveBuildingEdit}>
              <Form.Item name="street" label="Street address" rules={[{ required: true }]}>
                <Input placeholder="Hauptstraße 47-51" />
              </Form.Item>
              <Form.Item name="displayName" label="Display name (optional)">
                <Input placeholder="Leave empty to use street address" />
              </Form.Item>
              <Form.Item name="campusId" label="Campus" rules={[{ required: true }]}>
                <Select
                  options={BUILDING_CAMPUS_OPTIONS}
                />
              </Form.Item>
              <Form.Item name="aliases" label="Aliases (one per line)">
                <Input.TextArea rows={3} placeholder="Alias 1&#10;Alias 2" />
              </Form.Item>
              <Form.Item name="floors" label="Floors (optional)">
                <Select
                  mode="tags"
                  placeholder="Select or type floors…"
                  options={COMMON_FLOORS.map(f => ({ value: f, label: f }))}
                  tokenSeparators={[',']}
                />
              </Form.Item>
              <Form.Item name="notes" label="Notes">
                <Input.TextArea rows={2} />
              </Form.Item>
              <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 16, fontSize: 12 }}>
                Saved to <code>data/building-catalog.json</code> and synced to SQLite automatically.
              </Typography.Text>
              <Form.Item style={{ marginBottom: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  {!buildingEditState.isNew ? (
                    <Button danger loading={buildingDeleteLoading} onClick={confirmDeleteBuilding}>
                      Delete Building
                    </Button>
                  ) : <span />}
                  <Space>
                    <Button onClick={() => setBuildingEditState(null)}>Cancel</Button>
                    <Button type="primary" htmlType="submit" loading={buildingEditSaving}>
                      {buildingEditState.isNew ? 'Create Building' : 'Save Changes'}
                    </Button>
                  </Space>
                </div>
              </Form.Item>
              {!buildingEditState.isNew && (
                <>
                  {/* ── Merge section ── */}
                  <div style={{ marginTop: 24, borderTop: '1px solid rgba(128,128,128,0.2)', paddingTop: 16 }}>
                    <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
                      Merge into another building — this building's street address will become an alias of the target, and all its rooms will be moved over. This entry will then be removed.
                    </Typography.Text>
                    <Space.Compact style={{ width: '100%' }}>
                      <Select
                        style={{ flex: 1 }}
                        placeholder="Select target building…"
                        showSearch
                        allowClear
                        optionFilterProp="label"
                        value={mergeTargetId}
                        onChange={(v) => setMergeTargetId(v ?? null)}
                        options={(allBuildingsList || [])
                          .filter(b => b.id !== buildingEditState.buildingId)
                          .map(b => ({ value: b.id, label: b.displayName || b.street }))}
                      />
                      <Button
                        danger
                        loading={mergeSaving}
                        disabled={!mergeTargetId}
                        onClick={handleMergeBuilding}
                      >
                        Merge
                      </Button>
                    </Space.Compact>
                  </div>
                </>
              )}
            </Form>
          )}
        </Modal>

        {/* ── Edit Room modal ── */}
        <Modal
          open={roomEditState !== null}
          onCancel={() => setRoomEditState(null)}
          title={`Edit Room — ${(roomEditState?.room?.name as string) || ''}`}
          width={440}
          footer={null}
          destroyOnClose
        >
          {roomEditState && (
            <Form form={roomForm} layout="vertical" onFinish={handleSaveRoomEdit}>
              <Form.Item name="room_name" label="Room name" rules={[{ required: true }]}>
                <Input placeholder="Hörsaal 5 (3041.EG.005)" />
              </Form.Item>
              <Form.Item name="room_display_name" label="Display name (optional)">
                <Input placeholder="Short or friendly name shown to users" />
              </Form.Item>
              <Form.Item name="room_floors" label="Floor">
                <Select
                  mode="tags"
                  maxCount={1}
                  placeholder="Select or type a floor…"
                  options={COMMON_FLOORS.map(f => ({ value: f, label: f }))}
                  tokenSeparators={[',']}
                />
              </Form.Item>
              <Form.Item name="room_notes" label="Notes">
                <Input.TextArea rows={2} />
              </Form.Item>
              <Form.Item style={{ marginBottom: 0, textAlign: 'right' }}>
                <Space>
                  <Button onClick={() => setRoomEditState(null)}>Cancel</Button>
                  <Button type="primary" htmlType="submit" loading={roomEditSaving}>
                    Save Room
                  </Button>
                </Space>
              </Form.Item>
            </Form>
          )}
        </Modal>

        {/* ── Manage Rooms modal ── */}
        <Modal
          open={roomsModalOpen}
          onCancel={() => setRoomsModalOpen(false)}
          title={`Rooms — ${roomsModalLabel || roomsModalBuildingId}`}
          width={560}
          footer={null}
          destroyOnClose
        >
          {roomsModalLoading ? (
            <div style={{ textAlign: 'center', padding: 32 }}><Spin /></div>
          ) : (
            <div style={{ maxHeight: '55vh', overflowY: 'auto', marginBottom: 20 }}>
              {roomsModalRooms.length === 0 && (
                <div style={{ color: '#999', textAlign: 'center', padding: 16 }}>No rooms defined.</div>
              )}
              {roomsModalRooms.map((room) => {
                const roomId = room.id as string
                const roomName = room.name as string
                return (
                  <div
                    key={roomId}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '6px 0',
                      borderBottom: '1px solid #f0f0f0',
                    }}
                  >
                    <div style={{ flex: 1 }}>
                      <span style={{ fontWeight: 500 }}>{roomName}</span>
                      {Array.isArray(room.floors) && (room.floors as string[]).length > 0 && (
                        <span style={{ fontSize: 11, color: '#888', marginLeft: 8 }}>
                          {(room.floors as string[]).join(', ')}
                        </span>
                      )}
                    </div>
                    <Button
                      size="small"
                      onClick={() => openRoomEditModal(roomsModalBuildingId, room)}
                    >
                      Edit
                    </Button>
                    <Button
                      size="small"
                      danger
                      loading={roomDeleteLoading === roomId}
                      onClick={() => confirmDeleteRoom(roomsModalBuildingId, roomId, roomName)}
                    >
                      Delete
                    </Button>
                  </div>
                )
              })}
            </div>
          )}
          <div style={{ borderTop: '1px solid #f0f0f0', paddingTop: 16 }}>
            <div style={{ fontWeight: 500, marginBottom: 8 }}>Add New Room</div>
            <Form form={addRoomForm} layout="vertical" onFinish={handleAddRoomToBuilding}>
              <Form.Item name="room_add_name" label="Room name" rules={[{ required: true, message: 'Name required' }]}>
                <Input placeholder="Hörsaal 5 (3041.EG.005)" />
              </Form.Item>
              <Form.Item name="room_add_display_name" label="Display name (optional)">
                <Input placeholder="Short or friendly name shown to users" />
              </Form.Item>
              <Form.Item name="room_add_floors" label="Floor">
                <Select
                  mode="tags"
                  maxCount={1}
                  placeholder="Select or type a floor…"
                  options={COMMON_FLOORS.map(f => ({ value: f, label: f }))}
                  tokenSeparators={[',']}
                />
              </Form.Item>
              <Form.Item name="room_add_notes" label="Notes">
                <Input />
              </Form.Item>
              <Form.Item style={{ marginBottom: 0, textAlign: 'right' }}>
                <Button type="primary" htmlType="submit" loading={addRoomSaving}>
                  Add Room
                </Button>
              </Form.Item>
            </Form>
          </div>
        </Modal>

        {/* ── User Feedback Queue modal ── */}
        <Modal
          open={feedbackOpen}
          onCancel={() => { setFeedbackOpen(false); setFeedbackDetailId(null); setFeedbackDetailData(null) }}
          title={`User Feedback${feedbackList.filter(f => f.status === 'pending').length > 0 ? ` (${feedbackList.filter(f => f.status === 'pending').length} pending)` : ''}`}
          width={700}
          footer={null}
        >
          <Spin spinning={feedbackLoading}>
            {feedbackDetailId && feedbackDetailData ? (
              /* Detail / compare view */
              <div>
                <Button size="small" onClick={() => { setFeedbackDetailId(null); setFeedbackDetailData(null) }} style={{ marginBottom: 12 }}>
                  ← Back to list
                </Button>
                <Spin spinning={feedbackDetailLoading}>
                  <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                    <div>
                      <Typography.Text strong>Course: </Typography.Text>
                      <Typography.Text>{feedbackDetailData.feedback.courseTitle}</Typography.Text>
                      <Typography.Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
                        (ID: {feedbackDetailData.feedback.courseId})
                      </Typography.Text>
                    </div>
                    <div>
                      <Typography.Text strong>Submitted: </Typography.Text>
                      <Typography.Text type="secondary">{new Date(feedbackDetailData.feedback.submittedAt).toLocaleString()}</Typography.Text>
                      {feedbackDetailData.feedback.email && (
                        <> · <Typography.Text type="secondary">{feedbackDetailData.feedback.email}</Typography.Text></>
                      )}
                      · <Tag color={feedbackDetailData.feedback.status === 'pending' ? 'blue' : feedbackDetailData.feedback.status === 'replied' ? 'green' : 'default'}>
                        {feedbackDetailData.feedback.status}
                      </Tag>
                    </div>

                    {feedbackDetailData.feedback.message && (
                      <div>
                        <Typography.Text strong style={{ display: 'block', marginBottom: 4 }}>Message:</Typography.Text>
                        <div style={{ background: 'var(--hei-surface)', border: '1px solid var(--hei-border)', borderRadius: 6, padding: '8px 12px', whiteSpace: 'pre-wrap', fontSize: 13 }}>
                          {feedbackDetailData.feedback.message}
                        </div>
                      </div>
                    )}

                    {feedbackDetailData.feedback.files.length > 0 && (
                      <div>
                        <Typography.Text strong style={{ display: 'block', marginBottom: 4 }}>Uploaded files:</Typography.Text>
                        <Space wrap>
                          {feedbackDetailData.feedback.files.map(fname => (
                            <a
                              key={fname}
                              href={`/api/admin/feedback/${feedbackDetailId}/file/${encodeURIComponent(fname)}`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              {fname}
                            </a>
                          ))}
                        </Space>
                      </div>
                    )}

                    {feedbackDetailData.feedback.proposedWeeks.length > 0 && (
                      <div>
                        <Typography.Text strong style={{ display: 'block', marginBottom: 8 }}>
                          Proposed schedule corrections vs. current data:
                        </Typography.Text>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                          <div>
                            <Typography.Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: 4 }}>
                              USER PROPOSED
                            </Typography.Text>
                            <pre style={{ background: 'var(--hei-surface)', border: '1px solid var(--hei-border)', borderRadius: 6, padding: 10, fontSize: 11, overflowY: 'auto', maxHeight: 300, margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                              {JSON.stringify(feedbackDetailData.feedback.proposedWeeks, null, 2)}
                            </pre>
                          </div>
                          <div>
                            <Typography.Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: 4 }}>
                              CURRENT DATA
                            </Typography.Text>
                            <pre style={{ background: 'var(--hei-surface)', border: '1px solid var(--hei-border)', borderRadius: 6, padding: 10, fontSize: 11, overflowY: 'auto', maxHeight: 300, margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                              {feedbackDetailData.currentCourse
                                ? JSON.stringify((feedbackDetailData.currentCourse as Record<string, unknown>).weeks ?? [], null, 2)
                                : '(course not found)'}
                            </pre>
                          </div>
                        </div>
                      </div>
                    )}

                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {feedbackDetailData.feedback.status === 'pending' && (
                        <Button
                          size="small"
                          loading={feedbackDismissLoading === feedbackDetailId}
                          onClick={async () => {
                            if (!feedbackDetailId) return
                            setFeedbackDismissLoading(feedbackDetailId)
                            try {
                              const r = await adminFetch(`/api/admin/feedback/${feedbackDetailId}/dismiss`, { method: 'POST' })
                              if (r.ok) {
                                setFeedbackList(prev => prev.map(f => f.id === feedbackDetailId ? { ...f, status: 'dismissed' } : f))
                                setFeedbackDetailData(prev => prev ? { ...prev, feedback: { ...prev.feedback, status: 'dismissed' } } : null)
                              }
                            } finally { setFeedbackDismissLoading(null) }
                          }}
                        >
                          Dismiss
                        </Button>
                      )}
                      {feedbackDetailData.feedback.email && (
                        <Button
                          size="small"
                          type="primary"
                          onClick={() => {
                            const fb = feedbackDetailData.feedback
                            setFeedbackEmailSubject('Re: Your heiView feedback')
                            setFeedbackEmailBody(
                              `Dear user,\n\nThank you for your feedback regarding the course "${fb.courseTitle}".\n\nYour information has been reviewed and added to our database.\n\nBest regards,\nThe heiView Team`
                            )
                            setFeedbackEmailOpen(true)
                          }}
                        >
                          Reply by Email
                        </Button>
                      )}
                      {feedbackDetailData.currentCourse && (
                        <Button
                          size="small"
                          onClick={() => {
                            // Open the course edit modal for this course
                            const courseId = feedbackDetailData.feedback.courseId
                            adminFetch(`/api/admin/course-file/${encodeURIComponent(courseId)}`)
                              .then(r => r.ok ? r.json() : null)
                              .then(data => {
                                if (!data) return
                                setEditFileState({ courseId, weekIndex: -1, data })
                              })
                              .catch(() => {})
                            setFeedbackOpen(false)
                          }}
                        >
                          Open in Edit
                        </Button>
                      )}
                    </div>
                  </Space>
                </Spin>
              </div>
            ) : (
              /* List view */
              <div style={{ maxHeight: '60vh', overflowY: 'auto' }}>
                {feedbackList.length === 0 ? (
                  <div style={{ textAlign: 'center', color: '#999', padding: 24 }}>No feedback submissions yet.</div>
                ) : (
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--hei-border)' }}>
                        <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 600 }}>Status</th>
                        <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 600 }}>Course</th>
                        <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 600 }}>Submitted</th>
                        <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 600 }}>Email</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {feedbackList.map(item => (
                        <tr key={item.id} style={{ borderBottom: '1px solid var(--hei-border)' }}>
                          <td style={{ padding: '6px 8px' }}>
                            <Tag color={item.status === 'pending' ? 'blue' : item.status === 'replied' ? 'green' : 'default'}>
                              {item.status}
                            </Tag>
                          </td>
                          <td style={{ padding: '6px 8px', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            <span title={item.courseTitle}>{item.courseTitle || item.courseId}</span>
                          </td>
                          <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>
                            {new Date(item.submittedAt).toLocaleDateString('de-DE')}
                          </td>
                          <td style={{ padding: '6px 8px' }}>
                            {item.email ? <span style={{ fontSize: 12, color: '#666' }}>{item.email}</span> : '—'}
                          </td>
                          <td style={{ padding: '6px 8px' }}>
                            <Button
                              size="small"
                              onClick={async () => {
                                setFeedbackDetailId(item.id)
                                setFeedbackDetailLoading(true)
                                try {
                                  const r = await adminFetch(`/api/admin/feedback/${item.id}`)
                                  if (r.ok) setFeedbackDetailData(await r.json())
                                } finally { setFeedbackDetailLoading(false) }
                              }}
                            >
                              View
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </Spin>
        </Modal>

        {/* ── Email reply modal ── */}
        <Modal
          open={feedbackEmailOpen}
          onCancel={() => setFeedbackEmailOpen(false)}
          title="Send Reply Email"
          footer={[
            <Button key="cancel" onClick={() => setFeedbackEmailOpen(false)}>Cancel</Button>,
            <Button
              key="send"
              type="primary"
              loading={feedbackEmailSending}
              onClick={async () => {
                if (!feedbackDetailId) return
                setFeedbackEmailSending(true)
                try {
                  const r = await adminFetch(`/api/admin/feedback/${feedbackDetailId}/send-email`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ subject: feedbackEmailSubject, body: feedbackEmailBody }),
                  })
                  const data = await r.json()
                  if (r.ok) {
                    void message.success('Email sent successfully')
                    setFeedbackEmailOpen(false)
                    setFeedbackList(prev => prev.map(f => f.id === feedbackDetailId ? { ...f, status: 'replied' } : f))
                    setFeedbackDetailData(prev => prev ? { ...prev, feedback: { ...prev.feedback, status: 'replied' } } : null)
                  } else {
                    void message.error(data.error || 'Failed to send email')
                  }
                } catch (_) {
                  void message.error('Network error')
                } finally {
                  setFeedbackEmailSending(false)
                }
              }}
            >
              Send
            </Button>,
          ]}
          width={560}
          destroyOnClose
        >
          <Space direction="vertical" style={{ width: '100%' }}>
            <div>
              <Typography.Text strong style={{ display: 'block', marginBottom: 4 }}>To:</Typography.Text>
              <Typography.Text type="secondary">{feedbackDetailData?.feedback.email}</Typography.Text>
            </div>
            <div>
              <Typography.Text strong style={{ display: 'block', marginBottom: 4 }}>Subject:</Typography.Text>
              <Input value={feedbackEmailSubject} onChange={e => setFeedbackEmailSubject(e.target.value)} />
            </div>
            <div>
              <Typography.Text strong style={{ display: 'block', marginBottom: 4 }}>Message:</Typography.Text>
              <Input.TextArea
                rows={8}
                value={feedbackEmailBody}
                onChange={e => setFeedbackEmailBody(e.target.value)}
              />
            </div>
          </Space>
        </Modal>

      </Layout>
    </ConfigProvider>
  )
}

export default AdminApp
