const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const ROOT = path.resolve(__dirname, '..', '..');
const COURSE_DIR = path.join(ROOT, 'data', '2026SS');
const OVERRIDES_DIR = path.join(COURSE_DIR, 'overrides');
const CUSTOM_DIR = path.join(COURSE_DIR, 'custom');
const SKIP_LIST_PATH = path.join(COURSE_DIR, 'skip', 'skip.json');
const DB_DIR = path.join(ROOT, 'data');
const DB_PATH = path.join(DB_DIR, 'heiview.db');
const CATALOG_PATH = path.join(ROOT, 'data', 'building-catalog.json');

function loadSkipSet() {
  if (!fs.existsSync(SKIP_LIST_PATH)) return new Set();
  try {
    const data = JSON.parse(fs.readFileSync(SKIP_LIST_PATH, 'utf8'));
    return new Set(Array.isArray(data) ? data.map(String) : []);
  } catch (e) {
    console.warn('[skip] Failed to load skip list:', e.message);
    return new Set();
  }
}

function resolveCoursePath(fileName) {
  const overridePath = path.join(OVERRIDES_DIR, fileName);
  if (fs.existsSync(overridePath)) return overridePath;
  const customPath = path.join(CUSTOM_DIR, fileName);
  if (fs.existsSync(customPath)) return customPath;
  return path.join(COURSE_DIR, fileName);
}

function buildAliasMap() {
  const aliasMap = new Map();
  if (!fs.existsSync(CATALOG_PATH)) return aliasMap;
  try {
    const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
    for (const b of (catalog.buildings || [])) {
      const canonical = b.street;
      if (!canonical) continue;
      aliasMap.set(canonical.trim().toLowerCase(), canonical);
      for (const alias of (b.aliases || [])) {
        if (alias) aliasMap.set(alias.trim().toLowerCase(), canonical);
      }
      const dashName = canonical.replace(/\//g, '-');
      if (dashName !== canonical) {
        aliasMap.set(dashName.trim().toLowerCase(), canonical);
      }
    }
  } catch (e) {
    console.warn('[alias] Failed to load building-catalog.json:', e.message);
  }
  return aliasMap;
}

function resolveCanonicalBuildingName(name, aliasMap) {
  if (!name) return name;
  return aliasMap.get(name.trim().toLowerCase()) || name;
}

function parseIsoDate(value) {
  const [y, m, d] = value.split('-').map((part) => Number.parseInt(part, 10));
  return new Date(Date.UTC(y, m - 1, d));
}

function toIsoDate(date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function addDays(date, days) {
  const clone = new Date(date.getTime());
  clone.setUTCDate(clone.getUTCDate() + days);
  return clone;
}

function collectMeetingDates(startDate, endDate, isoWeekday) {
  const dates = [];
  if (!startDate || !endDate || !isoWeekday || isoWeekday < 1 || isoWeekday > 7) {
    return dates;
  }

  let cursor = parseIsoDate(startDate);
  const end = parseIsoDate(endDate);
  while (cursor <= end) {
    const jsWeekday = cursor.getUTCDay();
    const normalizedIsoWeekday = jsWeekday === 0 ? 7 : jsWeekday;
    if (normalizedIsoWeekday === isoWeekday) {
      dates.push(toIsoDate(cursor));
    }
    cursor = addDays(cursor, 1);
  }
  return dates;
}

function safeReadJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    console.warn(`[skip] Failed to parse ${path.basename(filePath)}: ${err.message}`);
    return null;
  }
}


function parseInfRoom(rawRoom) {
  const match = (rawRoom || '').trim().match(/^(INF\s+\d+[a-zA-Z]?)[-\s\/]*(.*)$/i);
  if (!match) return null;
  const infId = match[1].toUpperCase().replace(/\s+/, ' ');
  const buildingName = infId.replace('INF', 'Im Neuenheimer Feld').trim();
  const rest = (match[2] || '').trim();
  let room = '';
  let floorLabel = null;
  if (rest) {
    const split = splitBuildingAndFloor(rest);
    room = split.buildingName || rest;
    floorLabel = split.floorLabel;
  }
  return { buildingName, room, floorLabel, original: infId };
}


function normalizeFloorLabel(label) {
  if (!label) return null;
  const lower = label.trim().toLowerCase();
  if (lower === 'eg' || lower === 'erdgeschoss' || /^ground[\s\-]*floor$/.test(lower)) return 'Ground floor';
  if (/^1\.?\s*[oO][gG]$/.test(lower) || /^1(?:st)?\s*floor$/.test(lower)) return '1st floor';
  if (/^2\.?\s*[oO][gG]$/.test(lower) || /^2(?:nd)?\s*floor$/.test(lower)) return '2nd floor';
  if (/^3\.?\s*[oO][gG]$/.test(lower) || /^3(?:rd)?\s*floor$/.test(lower)) return '3rd floor';
  if (/^4\.?\s*[oO][gG]$/.test(lower) || /^4(?:th)?\s*floor$/.test(lower)) return '4th floor';
  if (/^5\.?\s*[oO][gG]$/.test(lower) || /^5(?:th)?\s*floor$/.test(lower)) return '5th floor';
  if (/^6\.?\s*[oO][gG]$/.test(lower) || /^6(?:th)?\s*floor$/.test(lower)) return '6th floor';
  if (/^7\.?\s*[oO][gG]$/.test(lower) || /^7(?:th)?\s*floor$/.test(lower)) return '7th floor';
  if (/^8\.?\s*[oO][gG]$/.test(lower) || /^8(?:th)?\s*floor$/.test(lower)) return '8th floor';
  if (/^1\.?\s*[uU][gG]$/.test(lower) || /^lower\s+level\s*1$/.test(lower) || lower === 'ug' || lower === 'untergeschoss') return 'Lower level 1';
  if (/^2\.?\s*[uU][gG]$/.test(lower) || /^lower\s+level\s*2$/.test(lower)) return 'Lower level 2';
  return label.trim() || null;
}

function splitBuildingAndFloor(value) {

  if (!value || typeof value !== 'string') {
    return { buildingName: null, floorLabel: null };
  }

  const text = value.trim();
  if (!text) {
    return { buildingName: null, floorLabel: null };
  }

  const parts = text.split(',').map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) {
    return { buildingName: null, floorLabel: null };
  }

  const isLikelyFloorLabel = (segment) => {
    const normalized = segment.toLowerCase();
    if (!normalized) return false;
    if (/\b(floor|geschoss|eg|og|untergeschoss|keller|mezzanine|level|ground|lower level|upper level|attic|dach)\b/.test(normalized)) {
      return true;
    }
    if (/\b\d+\s*(st|nd|rd|th)\s*floor\b/.test(normalized)) {
      return true;
    }
    return /^u\d+$/.test(normalized);
  };

  const hasFloorLabel = parts.length >= 2 && isLikelyFloorLabel(parts[parts.length - 1]);
  const floorLabel = hasFloorLabel ? parts[parts.length - 1] : null;
  const coreParts = hasFloorLabel ? parts.slice(0, -1) : parts;

  if (coreParts.length === 0) {
    return { buildingName: null, floorLabel: normalizeFloorLabel(floorLabel) };
  }

  const buildingName = coreParts.length >= 2 ? coreParts[coreParts.length - 1] : coreParts[0];
  return { buildingName: buildingName || null, floorLabel: normalizeFloorLabel(floorLabel) };
}

function ensureOccurrencesSplitColumns(db) {
  const columns = db.prepare('PRAGMA table_info(occurrences);').all();
  const names = new Set(columns.map((column) => column.name));

  if (!names.has('building_name')) {
    db.exec('ALTER TABLE occurrences ADD COLUMN building_name TEXT;');
  }
  if (!names.has('floor_label')) {
    db.exec('ALTER TABLE occurrences ADD COLUMN floor_label TEXT;');
  }
  if (!names.has('slot_start_date')) {
    db.exec('ALTER TABLE occurrences ADD COLUMN slot_start_date TEXT;');
  }
  if (!names.has('slot_end_date')) {
    db.exec('ALTER TABLE occurrences ADD COLUMN slot_end_date TEXT;');
  }
}

function ensureSchema(db) {
  // First-version reset: remove catalog tables so import script always recreates latest schema.
  // Drop building_aliases first since it has a FK to buildings_meta.
  db.exec(`
    DROP TABLE IF EXISTS building_aliases;
    DROP TABLE IF EXISTS rooms_meta;
    DROP TABLE IF EXISTS buildings_meta;
    DROP TABLE IF EXISTS campuses;
  `);

  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;

    CREATE TABLE IF NOT EXISTS courses (
      id TEXT PRIMARY KEY,
      title TEXT,
      type TEXT,
      ects_credits TEXT,
      course_languages TEXT,
      lecturers_json TEXT,
      detail_link TEXT,
      start_date TEXT,
      end_date TEXT
    );

    CREATE TABLE IF NOT EXISTS occurrences (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      course_id TEXT NOT NULL,
      date TEXT NOT NULL,
      building TEXT,
      building_name TEXT,
      floor_label TEXT,
      room TEXT,
      start_time TEXT,
      end_time TEXT,
      note TEXT,
      slot_start_date TEXT,
      slot_end_date TEXT,
      FOREIGN KEY (course_id) REFERENCES courses(id)
    );

    CREATE INDEX IF NOT EXISTS idx_occurrences_date_building_start
      ON occurrences(date, building, start_time);

    CREATE INDEX IF NOT EXISTS idx_occurrences_course_date
      ON occurrences(course_id, date);

    CREATE INDEX IF NOT EXISTS idx_occurrences_building_name
      ON occurrences(building_name);

    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  ensureOccurrencesSplitColumns(db);
}

function main() {
  if (!fs.existsSync(COURSE_DIR)) {
    throw new Error(`Course directory not found: ${COURSE_DIR}`);
  }

  fs.mkdirSync(DB_DIR, { recursive: true });

  const db = new Database(DB_PATH);
  ensureSchema(db);

  db.exec('BEGIN');
  try {
    db.exec('DELETE FROM occurrences;');
    db.exec('DELETE FROM courses;');

    const aliasMap = buildAliasMap();
    const skipSet = loadSkipSet();

    if (skipSet.size > 0) {
      console.log(`[skip] Loaded ${skipSet.size} course ID(s) to skip.`);
    }

    const insertCourse = db.prepare(`
      INSERT INTO courses (
        id, title, type, ects_credits, course_languages,
        lecturers_json, detail_link, start_date, end_date
      ) VALUES (
        @id, @title, @type, @ects_credits, @course_languages,
        @lecturers_json, @detail_link, @start_date, @end_date
      );
    `);

    const insertOccurrence = db.prepare(`
      INSERT INTO occurrences (
        course_id, date, building, building_name, floor_label, room, start_time, end_time, note, slot_start_date, slot_end_date
      ) VALUES (
        @course_id, @date, @building, @building_name, @floor_label, @room, @start_time, @end_time, @note, @slot_start_date, @slot_end_date
      );
    `);

    const files = [
      ...fs.readdirSync(COURSE_DIR).filter((name) => name.startsWith('course-') && name.endsWith('.json')),
      ...(fs.existsSync(CUSTOM_DIR) ? fs.readdirSync(CUSTOM_DIR).filter((name) => name.startsWith('course-') && name.endsWith('.json')) : []),
    ];
    // Deduplicate (override or custom may shadow original)
    const seenIds = new Set();
    const uniqueFiles = files.filter((name) => {
      if (seenIds.has(name)) return false;
      seenIds.add(name);
      return true;
    });

    let courseCount = 0;
    let occurrenceCount = 0;

    for (const fileName of uniqueFiles) {
      const coursePath = resolveCoursePath(fileName);
      const isOverride = coursePath !== path.join(COURSE_DIR, fileName);
      const payload = safeReadJson(coursePath);
      if (!payload || !payload.id) {
        continue;
      }

      if (skipSet.has(String(payload.id))) {
        console.log(`[skip] Skipping course: ${payload.id}`);
        continue;
      }

      if (isOverride) {
        console.log(`[override] Using override for: ${fileName}`);
      }

      insertCourse.run({
        id: String(payload.id),
        title: payload.title || null,
        type: payload.type || null,
        ects_credits: payload.ects_credits || null,
        course_languages: payload.course_languages || null,
        lecturers_json: JSON.stringify(Array.isArray(payload.lecturers) ? payload.lecturers : []),
        detail_link: payload.detail_link || null,
        start_date: payload.start_date || null,
        end_date: payload.end_date || null,
      });
      courseCount += 1;

      const weeks = Array.isArray(payload.weeks) ? payload.weeks : [];
      for (const week of weeks) {
        const dayOfWeek = Number.parseInt(String(week.day_of_week || ''), 10);
        const slotStart = week.start_date || payload.start_date;
        const slotEnd = week.end_date || payload.end_date;
        const meetingDates = collectMeetingDates(slotStart, slotEnd, dayOfWeek);
        const rawRoom = (week.room || week.location || '').trim() || null;
        let split = splitBuildingAndFloor(week.building || null);
        let currentRoom = rawRoom;
        
        if (!split.buildingName && rawRoom) {
          const inf = parseInfRoom(rawRoom);
          if (inf) {
            split.buildingName = inf.buildingName;
            split.floorLabel = inf.floorLabel;
            currentRoom = inf.room || inf.original;
          } else if (/peterskirche/i.test(rawRoom)) {
            split.buildingName = 'Peterskirche';
            split.floorLabel = null;
            currentRoom = 'Peterskirche';
          } else {
            const akadMatch = rawRoom?.match(/^(.*)\s*\/\s*(Akademiestra(?:ss|ß)e\s*4)$/i);
            if (akadMatch) {
              split.buildingName = 'Akademiestraße 4';
              split.floorLabel = null;
              currentRoom = akadMatch[1].trim(); 
            } else {
              const schlierbacherMatch = rawRoom?.match(/^Schlierbacher\s+Landstr(?:a(?:ss|ß)e|\.)?\s*200A\s*-\s*(.*)$/i);
              if (schlierbacherMatch) {
                split.buildingName = 'Schlierbacher Landstraße 200A';
                split.floorLabel = null;
                currentRoom = schlierbacherMatch[1].trim();
              } else {
                const zslMatch = rawRoom?.match(/^ZSL,?\s*Raum\s*(\d+)$/i);
                if (zslMatch) {
                  const roomNumber = zslMatch[1];
                  const floorDigit = roomNumber.substring(0, 1);
                  let floorLabel = '';
                  if (floorDigit === '0') floorLabel = 'Ground floor';
                  else if (floorDigit === '1') floorLabel = '1st floor';
                  else if (floorDigit === '2') floorLabel = '2nd floor';
                  else if (floorDigit === '3') floorLabel = '3rd floor';
                  else floorLabel = `${floorDigit}th floor`;

                  split.buildingName = 'Plöck 79-81';
                  split.floorLabel = floorLabel;
                  currentRoom = `Übungsraum (3120.0${floorDigit}.${roomNumber})`;
                } else {
                  const poliMatch = rawRoom?.match(/^Poliklinik(?:,?\s*(.*))?$/i);
                  if (poliMatch) {
                    const suffix = poliMatch[1]?.trim() || '';
                    let floorLabel = null;
                    if (/1\.\s*[oO][gG]/.test(suffix)) floorLabel = '1st floor';
                    else if (/2\.\s*[oO][gG]/.test(suffix)) floorLabel = '2nd floor';
                    else if (/3\.\s*[oO][gG]/.test(suffix)) floorLabel = '3rd floor';
                    else if (/EG/i.test(suffix)) floorLabel = 'Ground floor';
                    
                    split.buildingName = 'Im Neuenheimer Feld 400';
                    split.floorLabel = floorLabel;
                    currentRoom = 'Unbekannt';
                  } else {
                    // Generic fallback: extract building name from rawRoom (e.g. "Room, Building, Floor")
                    // mirror the same fallback used in patch-catalog.cjs
                    const fallback = splitBuildingAndFloor(rawRoom);
                    if (fallback.buildingName) {
                      split.buildingName = fallback.buildingName;
                      split.floorLabel = fallback.floorLabel;
                      // currentRoom stays as rawRoom (full string) for display
                    }
                  }
                }
              }
            }
          }
        }
        
        if (split.buildingName === 'Voßstraße 2' || /vo(?:ss|ß)stra(?:ss|ß)e\s*2/i.test(week.building || '') || /vo(?:ss|ß)stra(?:ss|ß)e\s*2/i.test(week.note || '') || /vo(?:ss|ß)stra(?:ss|ß)e\s*2/i.test(rawRoom || '')) {
          const combo = [week.building, rawRoom, week.note].join(' ');
          const codeMatch = combo.match(/\b(4\d{3})\b/);
          if (codeMatch) {
            split.buildingName = `Voßstraße 2 - ${codeMatch[1]}`;
            if (/^geb(?:ä|a)ude\s*\d+\s*\(/i.test(rawRoom?.trim())) {
              currentRoom = 'Unbekannter Raum';
            }
          } else {
            split.buildingName = `Voßstraße 2`;
          }
        }

        for (const date of meetingDates) {
          insertOccurrence.run({
            course_id: String(payload.id),
            date,
            building: week.building || null,
            building_name: resolveCanonicalBuildingName(split.buildingName, aliasMap),
            floor_label: split.floorLabel,
            room: currentRoom,
            start_time: week.start_time || null,
            end_time: week.end_time || null,
            note: week.note || null,
            slot_start_date: slotStart || null,
            slot_end_date: slotEnd || null,
          });
          occurrenceCount += 1;
        }
      }
    }

    // Import sync metadata (last crawl timestamp)
    const SYNC_META_PATH = path.join(COURSE_DIR, 'sync-meta.json');
    if (fs.existsSync(SYNC_META_PATH)) {
      try {
        const syncMeta = JSON.parse(fs.readFileSync(SYNC_META_PATH, 'utf8'));
        const upsertMeta = db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (@key, @value)');
        if (syncMeta.lastSyncTime) {
          upsertMeta.run({ key: 'lastSyncTime', value: syncMeta.lastSyncTime });
        }
        if (syncMeta.courseCount !== undefined) {
          upsertMeta.run({ key: 'syncCourseCount', value: String(syncMeta.courseCount) });
        }
        console.log(`Imported sync metadata: lastSyncTime=${syncMeta.lastSyncTime}`);
      } catch (e) {
        console.warn('[meta] Failed to import sync-meta.json:', e.message);
      }
    }

    db.exec('COMMIT');
    console.log(`SQLite build complete: ${DB_PATH}`);
    console.log(`Courses: ${courseCount}`);
    console.log(`Occurrences: ${occurrenceCount}`);
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  } finally {
    db.close();
  }
}

/**
 * Sync a single course's occurrences in SQLite from its (override) JSON file.
 * Much faster than a full db:sync — deletes then reinserts only this course.
 */
function syncSingleCourse(courseId) {
  if (!fs.existsSync(DB_PATH)) {
    console.warn('[syncSingleCourse] DB not found, skipping. Run db:sync first.');
    return;
  }
  const fileName = `course-${courseId}.json`;
  const coursePath = resolveCoursePath(fileName);
  if (!fs.existsSync(coursePath)) {
    console.warn(`[syncSingleCourse] No file found for course ${courseId}`);
    return;
  }
  const payload = safeReadJson(coursePath);
  if (!payload || !payload.id) return;

  const db = new Database(DB_PATH);
  ensureOccurrencesSplitColumns(db);
  const aliasMap = buildAliasMap();
  const skipSet = loadSkipSet();

  const insertCourse = db.prepare(`
    INSERT OR REPLACE INTO courses (
      id, title, type, ects_credits, course_languages,
      lecturers_json, detail_link, start_date, end_date
    ) VALUES (
      @id, @title, @type, @ects_credits, @course_languages,
      @lecturers_json, @detail_link, @start_date, @end_date
    )
  `);
  const insertOccurrence = db.prepare(`
    INSERT INTO occurrences (
      course_id, date, building, building_name, floor_label, room, start_time, end_time, note, slot_start_date, slot_end_date
    ) VALUES (
      @course_id, @date, @building, @building_name, @floor_label, @room, @start_time, @end_time, @note, @slot_start_date, @slot_end_date
    )
  `);

  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM occurrences WHERE course_id = ?').run(String(payload.id));
    db.prepare('DELETE FROM courses WHERE id = ?').run(String(payload.id));

    if (skipSet.has(String(payload.id))) {
      console.log(`[syncSingleCourse] Course ${courseId} is in skip list, cleared from DB.`);
      db.exec('COMMIT');
      return;
    }

    insertCourse.run({
      id: String(payload.id),
      title: payload.title || null,
      type: payload.type || null,
      ects_credits: payload.ects_credits || null,
      course_languages: payload.course_languages || null,
      lecturers_json: JSON.stringify(Array.isArray(payload.lecturers) ? payload.lecturers : []),
      detail_link: payload.detail_link || null,
      start_date: payload.start_date || null,
      end_date: payload.end_date || null,
    });

    const weeks = Array.isArray(payload.weeks) ? payload.weeks : [];
    for (const week of weeks) {
      const dayOfWeek = Number.parseInt(String(week.day_of_week || ''), 10);
      const slotStart = week.start_date || payload.start_date;
      const slotEnd = week.end_date || payload.end_date;
      const meetingDates = collectMeetingDates(slotStart, slotEnd, dayOfWeek);
      const rawRoom = week.room || week.location || null;
      let split = splitBuildingAndFloor(week.building || null);
      let currentRoom = rawRoom;

      if (!split.buildingName && rawRoom) {
        const inf = parseInfRoom(rawRoom);
        if (inf) {
          split.buildingName = inf.buildingName;
          split.floorLabel = inf.floorLabel;
          currentRoom = inf.room || inf.original;
        } else if (/peterskirche/i.test(rawRoom)) {
          split.buildingName = 'Peterskirche';
          split.floorLabel = null;
          currentRoom = 'Peterskirche';
        } else {
          const akadMatch = rawRoom?.match(/^(.*)\s*\/\s*(Akademiestra(?:ss|ß)e\s*4)$/i);
          if (akadMatch) {
            split.buildingName = 'Akademiestraße 4';
            split.floorLabel = null;
            currentRoom = akadMatch[1].trim();
          } else {
            const schlierbacherMatch = rawRoom?.match(/^Schlierbacher\s+Landstr(?:a(?:ss|ß)e|\.)?\s*200A\s*-\s*(.*)$/i);
            if (schlierbacherMatch) {
              split.buildingName = 'Schlierbacher Landstraße 200A';
              split.floorLabel = null;
              currentRoom = schlierbacherMatch[1].trim();
            } else {
              const zslMatch = rawRoom?.match(/^ZSL,?\s*Raum\s*(\d+)$/i);
              if (zslMatch) {
                const roomNumber = zslMatch[1];
                const floorDigit = roomNumber.substring(0, 1);
                let floorLabel = '';
                if (floorDigit === '0') floorLabel = 'Ground floor';
                else if (floorDigit === '1') floorLabel = '1st floor';
                else if (floorDigit === '2') floorLabel = '2nd floor';
                else if (floorDigit === '3') floorLabel = '3rd floor';
                else floorLabel = `${floorDigit}th floor`;
                split.buildingName = 'Plöck 79-81';
                split.floorLabel = floorLabel;
                currentRoom = `Übungsraum (3120.0${floorDigit}.${roomNumber})`;
              } else {
                const poliMatch = rawRoom?.match(/^Poliklinik(?:,?\s*(.*))?$/i);
                if (poliMatch) {
                  const suffix = poliMatch[1]?.trim() || '';
                  let floorLabel = null;
                  if (/1\.\s*[oO][gG]/.test(suffix)) floorLabel = '1st floor';
                  else if (/2\.\s*[oO][gG]/.test(suffix)) floorLabel = '2nd floor';
                  else if (/3\.\s*[oO][gG]/.test(suffix)) floorLabel = '3rd floor';
                  else if (/EG/i.test(suffix)) floorLabel = 'Ground floor';
                  split.buildingName = 'Im Neuenheimer Feld 400';
                  split.floorLabel = floorLabel;
                  currentRoom = 'Unbekannt';
                } else {
                  const fallback = splitBuildingAndFloor(rawRoom);
                  if (fallback.buildingName) {
                    split.buildingName = fallback.buildingName;
                    split.floorLabel = fallback.floorLabel;
                  }
                }
              }
            }
          }
        }
      }

      if (split.buildingName === 'Voßstraße 2' || /vo(?:ss|ß)stra(?:ss|ß)e\s*2/i.test(week.building || '') || /vo(?:ss|ß)stra(?:ss|ß)e\s*2/i.test(week.note || '') || /vo(?:ss|ß)stra(?:ss|ß)e\s*2/i.test(rawRoom || '')) {
        const combo = [week.building, rawRoom, week.note].join(' ');
        const codeMatch = combo.match(/\b(4\d{3})\b/);
        if (codeMatch) {
          split.buildingName = `Voßstraße 2 - ${codeMatch[1]}`;
          if (/^geb(?:ä|a)ude\s*\d+\s*\(/i.test(rawRoom?.trim())) {
            currentRoom = 'Unbekannter Raum';
          }
        } else {
          split.buildingName = `Voßstraße 2`;
        }
      }

      for (const date of meetingDates) {
        insertOccurrence.run({
          course_id: String(payload.id),
          date,
          building: week.building || null,
          building_name: resolveCanonicalBuildingName(split.buildingName, aliasMap),
          floor_label: split.floorLabel,
          room: currentRoom,
          start_time: week.start_time || null,
          end_time: week.end_time || null,
          note: week.note || null,
          slot_start_date: slotStart || null,
          slot_end_date: slotEnd || null,
        });
      }
    }

    db.exec('COMMIT');
    console.log(`[syncSingleCourse] Synced course ${courseId}`);
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  } finally {
    db.close();
  }
}

module.exports = { syncSingleCourse };
if (require.main === module) { main(); }
