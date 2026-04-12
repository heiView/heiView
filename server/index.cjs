const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const Database = require('better-sqlite3');
const { importBuildingCatalog } = require('./scripts/import-building-catalog.cjs');
const { syncSingleCourse } = require('./scripts/build-sqlite-db.cjs');

const ROOT = path.resolve(__dirname, '..');
const DB_PATH = path.join(ROOT, 'data', 'heitable.db');
const PORT = Number.parseInt(process.env.PORT || '3001', 10);

// ── Admin auth ──────────────────────────────────────────────────────────────
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'changeme';
const ADMIN_SECRET = process.env.ADMIN_SECRET || 'dev-secret-change-in-production';
const SEASON = '2026SS';
const COURSE_DIR = path.join(ROOT, 'data', SEASON);
const OVERRIDES_DIR = path.join(COURSE_DIR, 'overrides');
const CUSTOM_DIR = path.join(COURSE_DIR, 'custom');
const SKIP_LIST_PATH = path.join(COURSE_DIR, 'skip', 'skip.json');
const CATALOG_PATH = path.join(ROOT, 'data', 'building-catalog.json');

function readCatalog() {
  try { return JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8')); } catch (_) { return { buildings: [] }; }
}

function writeCatalog(catalog) {
  fs.writeFileSync(CATALOG_PATH, JSON.stringify(catalog, null, 2), 'utf8');
  try {
    importBuildingCatalog();
  } catch (e) {
    console.error('[writeCatalog] SQLite sync failed:', e.message);
  }
}

function makeAdminToken(username) {
  const payload = JSON.stringify({ user: username, exp: Date.now() + 7 * 24 * 3600 * 1000 });
  const b64 = Buffer.from(payload).toString('base64url');
  const sig = crypto.createHmac('sha256', ADMIN_SECRET).update(b64).digest('base64url');
  return `${b64}.${sig}`;
}

function verifyAdminToken(token) {
  if (!token || typeof token !== 'string') return null;
  const dot = token.lastIndexOf('.');
  if (dot < 1) return null;
  const b64 = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = crypto.createHmac('sha256', ADMIN_SECRET).update(b64).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) return null;
  try {
    const payload = JSON.parse(Buffer.from(b64, 'base64url').toString());
    if (!payload.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch (_) {
    return null;
  }
}

function requireAdmin(req, res, next) {
  const auth = req.headers['authorization'] || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!verifyAdminToken(token)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
}

function readSkipList() {
  try { return JSON.parse(fs.readFileSync(SKIP_LIST_PATH, 'utf8')); } catch (_) { return []; }
}

function writeSkipList(list) {
  fs.writeFileSync(SKIP_LIST_PATH, JSON.stringify(list, null, 2), 'utf8');
}
// ────────────────────────────────────────────────────────────────────────────

function openDb() {
  if (!fs.existsSync(DB_PATH)) {
    throw new Error(
      `SQLite database not found at ${DB_PATH}. Run \"npm run db:build\" first.`
    );
  }
  return new Database(DB_PATH, { readonly: true });
}

function makeCourseLabel(title, courseId) {
  return title || courseId || 'Unnamed Course';
}

function makeTimeRange(startTime, endTime) {
  if (startTime && endTime) {
    return `${startTime}-${endTime}`;
  }
  if (startTime) {
    return `${startTime}-`;
  }
  if (endTime) {
    return `-${endTime}`;
  }
  return '';
}

function toNullableBoolean(value) {
  if (value === null || value === undefined) return null;
  return Number(value) === 1;
}

function parseJsonArray(value) {
  if (!value || typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_err) {
    return [];
  }
}

function campusLabelFromId(value) {
  const key = String(value || '').trim().toLowerCase();
  if (key === 'altstadt' || key === 'alterstadt') return 'Altstadt';
  if (key === 'bergheim') return 'Bergheim';
  if (key === 'im-neuenheimer-feld') return 'Im Neuenheimer Feld';
  if (key === 'mannheim-and-ludwigshafen') return 'Mannheim & Ludwigshafen';
  if (key === 'other') return 'Other';
  return null;
}

function createApp() {
  const app = express();
  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  // ── Admin endpoints ─────────────────────────────────────────────────────
  app.post('/api/admin/login', (req, res) => {
    const { username, password } = req.body || {};
    if (username !== ADMIN_USER || password !== ADMIN_PASS) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }
    res.json({ token: makeAdminToken(username) });
  });

  app.get('/api/admin/skip', requireAdmin, (_req, res) => {
    res.json({ skip: readSkipList() });
  });

  app.post('/api/admin/skip', requireAdmin, (req, res) => {
    const { courseId } = req.body || {};
    if (!courseId || typeof courseId !== 'string') {
      res.status(400).json({ error: 'courseId required' });
      return;
    }
    const list = readSkipList();
    if (!list.includes(courseId)) {
      list.push(courseId);
      writeSkipList(list);
    }
    res.json({ ok: true, skip: list });
  });

  app.delete('/api/admin/skip/:courseId', requireAdmin, (req, res) => {
    const courseId = req.params.courseId;
    const list = readSkipList().filter(id => id !== courseId);
    writeSkipList(list);
    res.json({ ok: true, skip: list });
  });

  app.get('/api/admin/course-file/:courseId', requireAdmin, (req, res) => {
    const { courseId } = req.params;
    if (!/^[\w\-\.]+$/.test(courseId)) { res.status(400).json({ error: 'Invalid course ID' }); return; }
    const filename = `course-${courseId}.json`;
    const overridePath = path.join(OVERRIDES_DIR, filename);
    const originalPath = path.join(COURSE_DIR, filename);
    try {
      if (fs.existsSync(overridePath)) {
        res.json(JSON.parse(fs.readFileSync(overridePath, 'utf8')));
      } else if (fs.existsSync(originalPath)) {
        res.json(JSON.parse(fs.readFileSync(originalPath, 'utf8')));
      } else {
        res.status(404).json({ error: 'Course file not found' });
      }
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.put('/api/admin/course-file/:courseId', requireAdmin, (req, res) => {
    const { courseId } = req.params;
    if (!/^[\w\-\.]+$/.test(courseId)) { res.status(400).json({ error: 'Invalid course ID' }); return; }
    const filename = `course-${courseId}.json`;
    const overridePath = path.join(OVERRIDES_DIR, filename);
    try {
      if (!fs.existsSync(OVERRIDES_DIR)) fs.mkdirSync(OVERRIDES_DIR, { recursive: true });
      fs.writeFileSync(overridePath, JSON.stringify(req.body, null, 2), 'utf8');
      try { syncSingleCourse(courseId); } catch (e) { console.error('[PUT course-file] SQLite sync failed:', e.message); }
      // Auto-upsert rooms into catalog so they appear on days with no courses
      try {
        const catalog = readCatalog();
        const DE_MAP = { ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss', Ä: 'ae', Ö: 'oe', Ü: 'ue' };
        let catalogChanged = false;
        for (const week of (Array.isArray(req.body.weeks) ? req.body.weeks : [])) {
          const roomName = (week.room || '').trim();
          if (!roomName || roomName.toLowerCase() === 'online') continue;
          const buildingRaw = (week.building || '').trim();
          if (!buildingRaw) continue;
          let bldIdx = findBuilding(catalog.buildings, buildingRaw);
          if (bldIdx === -1) {
            const lastComma = buildingRaw.lastIndexOf(',');
            if (lastComma > 0) bldIdx = findBuilding(catalog.buildings, buildingRaw.slice(0, lastComma).trim());
          }
          if (bldIdx === -1) continue;
          const building = catalog.buildings[bldIdx];
          const rooms = Array.isArray(building.rooms) ? building.rooms : [];
          if (rooms.some(r => r.name === roomName)) continue;
          const slug = roomName.replace(/[äöüßÄÖÜ]/g, c => DE_MAP[c] || c).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
          const lastComma = buildingRaw.lastIndexOf(',');
          const floor = lastComma > 0 ? buildingRaw.slice(lastComma + 1).trim() : '';
          rooms.push({ id: `${building.id}::rm-${slug}`, name: roomName, floors: floor ? [floor] : [], features: { hasAirConditioning: null, hasAccessControl: null }, notes: '' });
          building.rooms = rooms;
          catalogChanged = true;
        }
        if (catalogChanged) writeCatalog(catalog);
      } catch (e) { console.error('[PUT course-file] Room upsert failed:', e.message); }
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
  // ────────────────────────────────────────────────────────────────────────

  // ── Create new custom event ───────────────────────────────────────────────
  app.post('/api/admin/course-file', requireAdmin, (req, res) => {
    const body = req.body || {};
    if (!body.title) { res.status(400).json({ error: 'title required' }); return; }

    // Generate a unique ID: custom-<timestamp><random>
    const ts = Date.now().toString(36);
    const rand = Math.random().toString(36).slice(2, 6);
    const courseId = `custom-${ts}${rand}`;

    const payload = {
      id: courseId,
      title: body.title,
      type: body.type || '',
      ects_credits: body.ects_credits || '',
      course_languages: body.course_languages || '',
      lecturers: Array.isArray(body.lecturers) ? body.lecturers : [],
      start_date: body.start_date || null,
      end_date: body.end_date || null,
      detail_link: body.detail_link || null,
      weeks: Array.isArray(body.weeks) ? body.weeks : [],
    };

    try {
      if (!fs.existsSync(CUSTOM_DIR)) fs.mkdirSync(CUSTOM_DIR, { recursive: true });
      const filePath = path.join(CUSTOM_DIR, `course-${courseId}.json`);
      fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
      try { syncSingleCourse(courseId); } catch (e) { console.error('[POST course-file] SQLite sync failed:', e.message); }
      res.json({ ok: true, courseId });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
  // ────────────────────────────────────────────────────────────────────────

  // ── Batch edit helpers ────────────────────────────────────────────────────
  function resolveCoursePath(courseId) {
    const fileName = `course-${courseId}.json`;
    const overridePath = path.join(OVERRIDES_DIR, fileName);
    if (fs.existsSync(overridePath)) return overridePath;
    const customPath = path.join(CUSTOM_DIR, fileName);
    if (fs.existsSync(customPath)) return customPath;
    const originalPath = path.join(COURSE_DIR, fileName);
    if (fs.existsSync(originalPath)) return originalPath;
    return null;
  }

  function getAllCourseIds() {
    const ids = new Set();
    try { for (const f of fs.readdirSync(COURSE_DIR)) { const m = f.match(/^course-(.+)\.json$/); if (m) ids.add(m[1]); } } catch (_) {}
    try { for (const f of fs.readdirSync(OVERRIDES_DIR)) { const m = f.match(/^course-(.+)\.json$/); if (m) ids.add(m[1]); } } catch (_) {}
    try { for (const f of fs.readdirSync(CUSTOM_DIR)) { const m = f.match(/^course-(.+)\.json$/); if (m) ids.add(m[1]); } } catch (_) {}
    return [...ids];
  }

  // GET /api/admin/courses/with-room?room=X&building=Y
  // Preview: how many courses/weeks match originalRoom + originalBuilding
  app.get('/api/admin/courses/with-room', requireAdmin, (req, res) => {
    const originalRoom = (req.query.room || '') || null;
    const rawBuilding = req.query.building;
    const originalBuilding = (!rawBuilding || rawBuilding === 'null') ? null : rawBuilding;
    if (!originalRoom) { res.json({ matches: [], totalWeeks: 0 }); return; }

    const courseIds = getAllCourseIds();
    const matches = [];
    for (const courseId of courseIds) {
      const p = resolveCoursePath(courseId);
      if (!p) continue;
      let data;
      try { data = JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) { continue; }
      const weeks = Array.isArray(data.weeks) ? data.weeks : [];
      const matchingWeeks = [];
      for (let i = 0; i < weeks.length; i++) {
        const w = weeks[i];
        if ((w.room || null) === originalRoom && (w.building || null) === originalBuilding) {
          matchingWeeks.push({ weekIndex: i, day_of_week: w.day_of_week, start_time: w.start_time });
        }
      }
      if (matchingWeeks.length > 0) {
        matches.push({ courseId, title: data.title || '', weeks: matchingWeeks });
      }
    }
    res.json({ matches, totalWeeks: matches.reduce((s, m) => s + m.weeks.length, 0) });
  });

  // POST /api/admin/batch-edit-room
  // Apply room/building change to all matching weeks across all courses
  app.post('/api/admin/batch-edit-room', requireAdmin, (req, res) => {
    const { originalRoom, originalBuilding, newRoom, newBuilding } = req.body;
    if (originalRoom === undefined) { res.status(400).json({ error: 'originalRoom required' }); return; }
    const origRoom = originalRoom || null;
    const origBuilding = (originalBuilding === 'null' ? null : originalBuilding) || null;

    const courseIds = getAllCourseIds();
    const updatedCourseIds = [];

    for (const courseId of courseIds) {
      const p = resolveCoursePath(courseId);
      if (!p) continue;
      let data;
      try { data = JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) { continue; }
      const weeks = Array.isArray(data.weeks) ? data.weeks : [];
      let changed = false;
      const newWeeks = weeks.map(w => {
        if ((w.room || null) === origRoom && (w.building || null) === origBuilding) {
          changed = true;
          return { ...w, room: newRoom || null, building: newBuilding || null };
        }
        return w;
      });
      if (!changed) continue;

      const overridePath = path.join(OVERRIDES_DIR, `course-${courseId}.json`);
      try {
        if (!fs.existsSync(OVERRIDES_DIR)) fs.mkdirSync(OVERRIDES_DIR, { recursive: true });
        fs.writeFileSync(overridePath, JSON.stringify({ ...data, weeks: newWeeks }, null, 2), 'utf8');
        try { syncSingleCourse(courseId); } catch (e) { console.error(`[batch] sync failed for ${courseId}:`, e.message); }
        updatedCourseIds.push(courseId);
      } catch (e) { console.error(`[batch] write failed for ${courseId}:`, e.message); }
    }

    res.json({ ok: true, updatedCourses: updatedCourseIds.length, courseIds: updatedCourseIds });
  });
  // ────────────────────────────────────────────────────────────────────────

  // ── Admin building endpoints ──────────────────────────────────────────────
  // Helper: find building by catalog id, street, or any alias (priority: id > street > alias)
  function findBuilding(buildings, key) {
    const bs = buildings || [];
    // 1. exact id match
    let idx = bs.findIndex(b => b.id === key);
    if (idx !== -1) return idx;
    // 2. street match (exact canonical name)
    idx = bs.findIndex(b => b.street === key);
    if (idx !== -1) return idx;
    // 3. alias match (fallback)
    idx = bs.findIndex(b => Array.isArray(b.aliases) && b.aliases.includes(key));
    return idx;
  }

  // Helper: get all canonical name variants (street + aliases) for a building
  function buildingNames(building) {
    const names = [];
    if (building.street) names.push(building.street.trim());
    for (const a of (building.aliases || [])) { if (a) names.push(a.trim()); }
    return names;
  }

  // Helper: query distinct course_ids in occurrences for given building name variants
  function coursesOnBuilding(building) {
    if (!fs.existsSync(DB_PATH)) return [];
    const db = new Database(DB_PATH, { readonly: true });
    try {
      const names = buildingNames(building);
      if (names.length === 0) return [];
      const placeholders = names.map(() => '?').join(', ');
      return db.prepare(
        `SELECT DISTINCT course_id FROM occurrences WHERE building_name IN (${placeholders})`
      ).all(...names).map(r => r.course_id);
    } finally { db.close(); }
  }

  // Helper: query distinct course_ids in occurrences for a specific room in a building
  function coursesOnRoom(building, roomName) {
    if (!fs.existsSync(DB_PATH)) return [];
    const db = new Database(DB_PATH, { readonly: true });
    try {
      const names = buildingNames(building);
      if (names.length === 0) return [];
      const placeholders = names.map(() => '?').join(', ');
      return db.prepare(
        `SELECT DISTINCT course_id FROM occurrences WHERE building_name IN (${placeholders}) AND room = ?`
      ).all(...names, roomName).map(r => r.course_id);
    } finally { db.close(); }
  }

  app.get('/api/admin/building/:buildingId', requireAdmin, (req, res) => {
    const { buildingId } = req.params;
    const catalog = readCatalog();
    const idx = findBuilding(catalog.buildings, buildingId);
    if (idx === -1) { res.status(404).json({ error: 'Building not found' }); return; }
    res.json(catalog.buildings[idx]);
  });

  app.put('/api/admin/building/:buildingId', requireAdmin, (req, res) => {
    const { buildingId } = req.params;
    const catalog = readCatalog();
    const idx = findBuilding(catalog.buildings, buildingId);
    if (idx === -1) { res.status(404).json({ error: 'Building not found' }); return; }
    // Preserve the real catalog id — never overwrite with the lookup key
    const realId = catalog.buildings[idx].id;
    catalog.buildings[idx] = { ...catalog.buildings[idx], ...req.body, id: realId };
    try { writeCatalog(catalog); res.json({ ok: true }); } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // List all buildings (for merge target selection)
  app.get('/api/admin/buildings', requireAdmin, (req, res) => {
    const catalog = readCatalog();
    const list = (catalog.buildings || []).map(b => ({
      id: b.id,
      street: b.street || '',
      displayName: b.displayName || '',
      campusId: b.campusId || '',
    }));
    res.json(list);
  });

  // Merge building A into building B:
  //   - A.street + A.aliases become B.aliases
  //   - A.rooms (re-prefixed) + A.floors are merged into B
  //   - A is removed from the catalog
  app.post('/api/admin/building/:buildingId/merge-into/:targetId', requireAdmin, (req, res) => {
    const { buildingId, targetId } = req.params;
    if (buildingId === targetId) { res.status(400).json({ error: 'Cannot merge a building into itself' }); return; }

    const catalog = readCatalog();
    const buildings = catalog.buildings || [];

    const srcIdx = findBuilding(buildings, buildingId);
    const tgtIdx = findBuilding(buildings, targetId);
    if (srcIdx === -1) { res.status(404).json({ error: 'Source building not found' }); return; }
    if (tgtIdx === -1) { res.status(404).json({ error: 'Target building not found' }); return; }

    const src = buildings[srcIdx];
    const tgt = buildings[tgtIdx];

    // Merge aliases: tgt.street and existing aliases are the "taken" set
    const takenByTarget = new Set([tgt.street, ...(tgt.aliases || [])]);
    const mergedAliases = new Set(tgt.aliases || []);
    // Add src.street as alias of target
    const srcStreet = (src.street || '').trim();
    if (srcStreet && !takenByTarget.has(srcStreet)) mergedAliases.add(srcStreet);
    // Add src.aliases into target
    for (const alias of (src.aliases || [])) {
      const a = (alias || '').trim();
      if (a && !takenByTarget.has(a)) mergedAliases.add(a);
    }
    tgt.aliases = [...mergedAliases];

    // Merge floors (dedup)
    const floorSet = new Set(tgt.floors || []);
    for (const f of (src.floors || [])) floorSet.add(f);
    tgt.floors = [...floorSet];

    // Merge rooms (re-prefix IDs, skip duplicates by room name)
    const tgtRooms = tgt.rooms || [];
    const existingRoomNames = new Set(tgtRooms.map(r => r.name));
    for (const room of (src.rooms || [])) {
      if (!room || !room.id || !room.name) continue;
      if (existingRoomNames.has(room.name)) continue;
      // Replace src.id:: prefix with tgt.id::
      const suffix = room.id.startsWith(src.id + '::') ? room.id.slice(src.id.length + 2) : room.id;
      tgtRooms.push({ ...room, id: `${tgt.id}::${suffix}` });
      existingRoomNames.add(room.name);
    }
    tgt.rooms = tgtRooms;

    // Remove source building
    catalog.buildings = buildings.filter(b => b.id !== buildingId);

    try {
      writeCatalog(catalog);
      res.json({ ok: true, targetId: tgt.id });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/admin/building', requireAdmin, (req, res) => {
    const catalog = readCatalog();
    const body = req.body || {};
    if (!body.street || !body.campusId) { res.status(400).json({ error: 'street and campusId required' }); return; }
    const DE_MAP = { ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss', Ä: 'ae', Ö: 'oe', Ü: 'ue' };
    const slug = body.street
      .replace(/[äöüßÄÖÜ]/g, c => DE_MAP[c])
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    const id = `bld-${slug}`;
    if ((catalog.buildings || []).some(b => b.id === id)) { res.status(409).json({ error: 'Building already exists', id }); return; }
    const newBuilding = {
      id,
      street: body.street,
      displayName: body.displayName || '',
      campusId: body.campusId,
      aliases: Array.isArray(body.aliases) ? body.aliases : [],
      floors: Array.isArray(body.floors) ? body.floors : [],
      rooms: Array.isArray(body.rooms) ? body.rooms : [],
      notes: body.notes || '',
    };
    if (!catalog.buildings) catalog.buildings = [];
    catalog.buildings.push(newBuilding);
    try { writeCatalog(catalog); res.json({ ok: true, id }); } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Add a new room to a building
  app.post('/api/admin/building/:buildingId/room', requireAdmin, (req, res) => {
    const { buildingId } = req.params;
    const catalog = readCatalog();
    const bldIdx = findBuilding(catalog.buildings, buildingId);
    if (bldIdx === -1) { res.status(404).json({ error: 'Building not found' }); return; }
    const building = catalog.buildings[bldIdx];
    const rooms = Array.isArray(building.rooms) ? building.rooms : [];
    const roomName = (req.body.name || '').trim();
    if (!roomName) { res.status(400).json({ error: 'name required' }); return; }
    if (rooms.some(r => r.name === roomName)) { res.status(409).json({ error: 'Room already exists' }); return; }
    const DE_MAP = { ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss', Ä: 'ae', Ö: 'oe', Ü: 'ue' };
    const slug = roomName.replace(/[äöüßÄÖÜ]/g, c => DE_MAP[c] || c).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    const newRoom = {
      id: `${building.id}::rm-${slug}`,
      name: roomName,
      floors: Array.isArray(req.body.floors) ? req.body.floors : [],
      features: { hasAirConditioning: null, hasAccessControl: null },
      notes: req.body.notes || '',
    };
    rooms.push(newRoom);
    building.rooms = rooms;
    try { writeCatalog(catalog); res.json({ ok: true, id: newRoom.id }); } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Delete a building — fails if any courses are still mounted on it
  app.delete('/api/admin/building/:buildingId', requireAdmin, (req, res) => {
    const { buildingId } = req.params;
    const catalog = readCatalog();
    const idx = findBuilding(catalog.buildings, buildingId);
    if (idx === -1) { res.status(404).json({ error: 'Building not found' }); return; }
    const building = catalog.buildings[idx];
    const occupied = coursesOnBuilding(building);
    if (occupied.length > 0) {
      res.status(409).json({ error: 'Building has courses', courseIds: occupied });
      return;
    }
    catalog.buildings.splice(idx, 1);
    try { writeCatalog(catalog); res.json({ ok: true }); } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Delete a room from a building — fails if any courses are mounted on it
  app.delete('/api/admin/building/:buildingId/room/:roomId', requireAdmin, (req, res) => {
    const { buildingId, roomId } = req.params;
    const catalog = readCatalog();
    const bldIdx = findBuilding(catalog.buildings, buildingId);
    if (bldIdx === -1) { res.status(404).json({ error: 'Building not found' }); return; }
    const building = catalog.buildings[bldIdx];
    const rooms = Array.isArray(building.rooms) ? building.rooms : [];
    const decodedRoomId = decodeURIComponent(roomId);
    const roomIdx = rooms.findIndex(r => r.id === decodedRoomId);
    if (roomIdx === -1) { res.status(404).json({ error: 'Room not found' }); return; }
    const room = rooms[roomIdx];
    const occupied = coursesOnRoom(building, room.name);
    if (occupied.length > 0) {
      res.status(409).json({ error: 'Room has courses', courseIds: occupied });
      return;
    }
    rooms.splice(roomIdx, 1);
    building.rooms = rooms;
    try { writeCatalog(catalog); res.json({ ok: true }); } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Update a room in a building
  app.put('/api/admin/building/:buildingId/room/:roomId', requireAdmin, (req, res) => {
    const { buildingId, roomId } = req.params;
    const catalog = readCatalog();
    const bldIdx = findBuilding(catalog.buildings, buildingId);
    if (bldIdx === -1) { res.status(404).json({ error: 'Building not found' }); return; }
    const building = catalog.buildings[bldIdx];
    const rooms = Array.isArray(building.rooms) ? building.rooms : [];
    const decodedRoomId = decodeURIComponent(roomId);
    const roomIdx = rooms.findIndex(r => r.id === decodedRoomId);
    if (roomIdx === -1) { res.status(404).json({ error: 'Room not found' }); return; }
    const realId = rooms[roomIdx].id;
    rooms[roomIdx] = { ...rooms[roomIdx], ...req.body, id: realId };
    building.rooms = rooms;
    try { writeCatalog(catalog); res.json({ ok: true }); } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ────────────────────────────────────────────────────────────────────────

  app.get('/api/schedule', (req, res) => {
    const date = typeof req.query.date === 'string' ? req.query.date.trim() : '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      res.status(400).json({ error: 'date query must be YYYY-MM-DD' });
      return;
    }

    const isAdmin = !!verifyAdminToken(
      ((req.headers['authorization'] || '').startsWith('Bearer ')
        ? req.headers['authorization'].slice(7)
        : '')
    );
    const skipSet = isAdmin ? new Set() : new Set(readSkipList().map(String));

    const buildingFilter =
      typeof req.query.building === 'string' && req.query.building.trim()
        ? req.query.building.trim()
        : null;

    res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=120');

    let db;
    try {
      db = openDb();

      const buildingCampusMap = new Map();
      const buildingDisplayNameMap = new Map();
      
      try {
        const buildingRows = db
          .prepare(
            `
              SELECT
                name,
                campus_id,
                display_name
              FROM buildings_meta
            `
          )
          .all();

        for (const buildingRow of buildingRows) {
          const buildingName = (buildingRow.name || '').trim();
          if (!buildingName) continue;
          buildingCampusMap.set(buildingName, campusLabelFromId(buildingRow.campus_id));
          const displayName = (buildingRow.display_name || '').trim();
          if (displayName) {
            buildingDisplayNameMap.set(buildingName, displayName);
          }
        }
      } catch (e) {
        console.warn('Could not load buildings_meta', e.message);
      }

      const buildingsSet = new Set();
      const rooms = {};

      function ensureBuilding(buildingName) {
        const normalized = (buildingName || '').trim() || 'Unknown';
        if (buildingFilter && normalized !== buildingFilter) {
          return null;
        }

        buildingsSet.add(normalized);
        if (!rooms[normalized]) {
          rooms[normalized] = [];
        }
        return normalized;
      }

      function ensureRoomEntry(buildingName, roomName, floorLabel, features) {
        const resolvedBuilding = ensureBuilding(buildingName);
        if (!resolvedBuilding) return null;

        const room = (roomName || 'Unknown').trim();
        const floor = floorLabel || null;
        let roomEntry = rooms[resolvedBuilding].find(
          (item) => item.room === room && (item.floor || null) === floor
        );
        if (!roomEntry) {
          // If no exact (room + floor) match, try to adopt a ghost pre-seeded entry
          // with the same room name but no courses yet and a different floor.
          // This prevents duplicate rows when occurrences have inconsistent floor_label history.
          const ghostIdx = rooms[resolvedBuilding].findIndex(
            (item) => item.room === room && item.courses.length === 0
          );
          if (ghostIdx !== -1) {
            rooms[resolvedBuilding][ghostIdx].floor = floor;
            roomEntry = rooms[resolvedBuilding][ghostIdx];
          } else {
            roomEntry = {
              room,
              floor,
              features: features || null,
              courses: [],
            };
            rooms[resolvedBuilding].push(roomEntry);
          }
        }
        if (features) {
          roomEntry.features = {
            hasAirConditioning: features.hasAirConditioning ?? roomEntry.features?.hasAirConditioning ?? null,
            hasAccessControl: features.hasAccessControl ?? roomEntry.features?.hasAccessControl ?? null,
            hasProjector: features.hasProjector ?? roomEntry.features?.hasProjector ?? null,
            hasMicrophone: features.hasMicrophone ?? roomEntry.features?.hasMicrophone ?? null,
          };
        }
        return roomEntry;
      }

      try {
        const buildingRows = db
          .prepare(
            `
              SELECT name
              FROM buildings_meta
            `
          )
          .all();

        for (const buildingRow of buildingRows) {
          ensureBuilding(buildingRow.name);
        }
      } catch(e) {}

      try {
        const roomRows = db
          .prepare(
            `
              SELECT
                b.name AS building_name,
                r.name AS room_name,
                r.floors_json,
                r.has_air_conditioning,
                r.has_access_control,
                r.has_projector,
                r.has_microphone
              FROM rooms_meta r
              JOIN buildings_meta b ON b.id = r.building_id
            `
          )
          .all();

        for (const roomRow of roomRows) {
          const features = {
            hasAirConditioning: toNullableBoolean(roomRow.has_air_conditioning),
            hasAccessControl: toNullableBoolean(roomRow.has_access_control),
            hasProjector: toNullableBoolean(roomRow.has_projector),
            hasMicrophone: toNullableBoolean(roomRow.has_microphone),
          };

          const floors = parseJsonArray(roomRow.floors_json).map((value) =>
            value === null || value === undefined ? null : String(value)
          );
          const targetFloors = floors.length > 0 ? floors : [null];

          for (const floorLabel of targetFloors) {
            ensureRoomEntry(roomRow.building_name, roomRow.room_name, floorLabel, features);
          }
        }
      } catch(e) {}

      // Pre-seed all rooms that have ever appeared in occurrences for "other" and
      // "mannheim-and-ludwigshafen" campus buildings, so they show up even on days
      // with no courses (mirrors behaviour of the main campuses).
      try {
        const otherRoomRows = db
          .prepare(
            `
              SELECT o.building_name, o.room, MAX(o.floor_label) AS floor_label
              FROM occurrences o
              JOIN buildings_meta b ON TRIM(b.name) = TRIM(o.building_name)
              WHERE b.campus_id IN ('other', 'mannheim-and-ludwigshafen')
                AND o.room IS NOT NULL
                AND o.building_name IS NOT NULL
              GROUP BY o.building_name, o.room
            `
          )
          .all();
        for (const row of otherRoomRows) {
          ensureRoomEntry(row.building_name, row.room, row.floor_label || null, null);
        }
      } catch(e) {}

      let rows;
      if (buildingFilter) {
        rows = db
          .prepare(
            `
              SELECT
                o.building_name,
                o.floor_label,
                o.room,
                o.start_time,
                o.end_time,
                o.note,
                c.title,
                c.id AS course_id,
                c.detail_link,
                c.lecturers_json
              FROM occurrences o
              JOIN courses c ON c.id = o.course_id
              WHERE o.date = ? 
                AND (
                  TRIM(o.building_name) = ?
                  OR LOWER(o.building_name) = 'online'
                  OR LOWER(o.room) = 'online'
                )
              ORDER BY o.building_name, o.room, o.start_time, c.title
            `
          )
          .all(date, buildingFilter);
      } else {
        rows = db
          .prepare(
            `
              SELECT
                o.building_name,
                o.floor_label,
                o.room,
                o.start_time,
                o.end_time,
                o.note,
                c.title,
                c.id AS course_id,
                c.detail_link,
                c.lecturers_json
              FROM occurrences o
              JOIN courses c ON c.id = o.course_id
              WHERE o.date = ?
              ORDER BY o.building_name, o.room, o.start_time, c.title
            `
          )
          .all(date);
      }

      for (const row of rows) {
        let building = (row.building_name || 'Unknown').trim();
        let roomLabel = row.room || 'Unknown';
        
        if (building.toLowerCase() === 'online' || roomLabel.toLowerCase() === 'online') {
          building = 'Online';
          roomLabel = 'Online';
        }

        const floor = row.floor_label || null;
        let roomEntry = ensureRoomEntry(building, roomLabel, floor, null);
        if (!roomEntry) continue;

        let lecturers = [];
        if (row.lecturers_json) {
          try {
            lecturers = JSON.parse(row.lecturers_json);
          } catch (_err) {
            lecturers = [];
          }
        }

        const newCourse = {
          id: row.course_id || undefined,
          time: makeTimeRange(row.start_time, row.end_time),
          name: makeCourseLabel(row.title, row.course_id),
          note: row.note || null,
          prof: Array.isArray(lecturers)
            ? lecturers.map(l => {
                if (typeof l === 'string') {
                  let name = l.trim();
                  
                  const nnMatch = name.match(/<N\.N\.>\(([^)]+)\)/);
                  if (nnMatch) {
                    name = nnMatch[1].trim();
                  } else {
                    name = name.replace(/,\s*\d+\.\d+$/, '').trim();
                  }
                  const parts = name.split(',');
                  if (parts.length === 2) return `${parts[1].trim()} ${parts[0].trim()}`;
                  return name;
                }
                return l;
              }).join(', ')
            : '',
          link: row.detail_link || undefined,
        };

        if (skipSet.has(String(row.course_id))) continue;

        const lastCourse = roomEntry.courses[roomEntry.courses.length - 1];
        const isDuplicate = lastCourse && lastCourse.time === newCourse.time && lastCourse.name === newCourse.name;

        if (!isDuplicate) {
          roomEntry.courses.push(newCourse);
        }
      }

      
      // Inject No Information
      const noInfoBuilding = 'No Information';
      
      // Always add the building to the list so it appears in the UI
      buildingsSet.add(noInfoBuilding);
      buildingCampusMap.set(noInfoBuilding, 'Other');
      buildingDisplayNameMap.set(noInfoBuilding, 'No Information');
      
      // ONLY fetch and parse the thousands of unscheduled courses if explicitly selected
      if (buildingFilter === noInfoBuilding) {
        const unscheduled = db.prepare(`
          SELECT c.id AS course_id, c.title, c.detail_link, c.lecturers_json
          FROM courses c
          WHERE c.id NOT IN (SELECT course_id FROM occurrences)
        `).all();
        
        if (unscheduled.length > 0) {
          const noInfoCourses = unscheduled.map(c => {
            let lecturers = [];
            if (c.lecturers_json) {
              try { lecturers = JSON.parse(c.lecturers_json); } catch(err) {}
            }
            
            let profStr = '—';
            if (Array.isArray(lecturers) && lecturers.length > 0) {
              profStr = lecturers.map(l => {
                if (typeof l === 'string') {
                  let name = l.trim();
                  const nnMatch = name.match(/<N\.N\.>\(([^)]+)\)/);
                  if (nnMatch) {
                    name = nnMatch[1].trim();
                  } else {
                    name = name.replace(/,\s*\d+\.\d+$/, '').trim();
                  }
                  const parts = name.split(',').map(s => s.trim());
                  if (parts.length === 2) {
                    return `${parts[1]} ${parts[0]}`;
                  }
                  return name;
                }
                return l;
              }).join(', ');
            }
            
            return {
              time: '',
              name: {
                zh: c.title,
                en: c.title,
                de: c.title,
              },
              note: null,
              prof: {
                zh: profStr,
                en: profStr,
                de: profStr,
              },
              link: c.detail_link || null
            };
          });
          
          if (!rooms[noInfoBuilding]) rooms[noInfoBuilding] = [];
          rooms[noInfoBuilding].push({
            room: 'No Room',
            floor: null,
            features: {},
            courses: noInfoCourses,
          });
        }
      }

      const buildings = Array.from(buildingsSet)
        .sort((left, right) => left.localeCompare(right))
        .map((id) => ({
          id,
          street: id,
          displayName: buildingDisplayNameMap.get(id) || id,
          campus: buildingCampusMap.get(id) || null,
        }));

      res.json({
        buildings,
        rooms,
      });
    } catch (err) {
      res.status(500).json({ error: err.message || String(err) });
    } finally {
      if (db) db.close();
    }
  });

  return app;
}

const app = createApp();
app.listen(PORT, () => {
  console.log(`SQLite API listening on http://localhost:${PORT}`);
});
