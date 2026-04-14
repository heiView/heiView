const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');

// Load .env manually so the server works when started via pm2/systemd without --env-file
(function loadDotEnv() {
  const envPath = path.resolve(__dirname, '..', '.env');
  try {
    const lines = fs.readFileSync(envPath, 'utf8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx < 1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
      if (!(key in process.env)) process.env[key] = val;
    }
  } catch (_) { /* .env not found — rely on actual environment variables */ }
})();
const Database = require('better-sqlite3');
const { importBuildingCatalog } = require('./scripts/import-building-catalog.cjs');
const { syncSingleCourse } = require('./scripts/build-sqlite-db.cjs');

const ROOT = path.resolve(__dirname, '..');
const DB_PATH = path.join(ROOT, 'data', 'heiview.db');
const PORT = Number.parseInt(process.env.PORT || '3001', 10);

// ── Admin auth ──────────────────────────────────────────────────────────────
const ADMIN_SECRET = process.env.ADMIN_SECRET || 'dev-secret-change-in-production';
const ADMIN_ACCOUNTS_PATH = path.join(ROOT, 'data', 'admin-accounts.json');
const AUDIT_LOG_PATH = path.join(ROOT, 'data', 'admin-audit.json');
const MAX_AUDIT_ENTRIES = 2000;

// Superadmin from env — always exists, cannot be deleted via UI
const ENV_SUPERADMIN = {
  username: process.env.ADMIN_USER || 'admin',
  password: process.env.ADMIN_PASS || 'changeme',
  role: 'superadmin',
};

function readAccounts() {
  try { return JSON.parse(fs.readFileSync(ADMIN_ACCOUNTS_PATH, 'utf8')); } catch (_) { return []; }
}
function writeAccounts(accounts) {
  fs.writeFileSync(ADMIN_ACCOUNTS_PATH, JSON.stringify(accounts, null, 2), 'utf8');
}
function getAllAccounts() {
  // env superadmin always first; dynamic accounts cannot shadow it
  const dynamic = readAccounts().filter(a => a.username !== ENV_SUPERADMIN.username);
  return [ENV_SUPERADMIN, ...dynamic];
}
function findAccount(username) {
  return getAllAccounts().find(a => a.username === username) || null;
}

function readAuditLog() {
  try { return JSON.parse(fs.readFileSync(AUDIT_LOG_PATH, 'utf8')); } catch (_) { return []; }
}
function appendAuditEntry(entry) {
  let log = readAuditLog();
  log.unshift({ id: crypto.randomBytes(8).toString('hex'), ...entry });
  if (log.length > MAX_AUDIT_ENTRIES) log = log.slice(0, MAX_AUDIT_ENTRIES);
  try { fs.writeFileSync(AUDIT_LOG_PATH, JSON.stringify(log, null, 2), 'utf8'); } catch (_) {}
}
function audit(req, action, target, summary, snapshot) {
  if (req.adminRole === 'superadmin') return;
  appendAuditEntry({
    ts: new Date().toISOString(),
    username: req.adminUser || 'unknown',
    action,
    target: target || null,
    summary: summary || null,
    snapshot: snapshot || null,
  });
}
const SEASON = '2026SS';
const COURSE_DIR = path.join(ROOT, 'data', SEASON);
const OVERRIDES_DIR = path.join(COURSE_DIR, 'overrides');
const CUSTOM_DIR = path.join(COURSE_DIR, 'custom');
const SKIP_LIST_PATH = path.join(COURSE_DIR, 'skip', 'skip.json');
const CATALOG_PATH = path.join(ROOT, 'data', 'building-catalog.json');

const scheduleCache = new Map(); // key -> { data, ts } — module-level so writeCatalog can clear it

function readCatalog() {
  try { return JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8')); } catch (_) { return { buildings: [] }; }
}

function writeCatalog(catalog) {
  catalog.updatedAt = new Date().toISOString();
  fs.writeFileSync(CATALOG_PATH, JSON.stringify(catalog, null, 2), 'utf8');
  try {
    importBuildingCatalog();
  } catch (e) {
    console.error('[writeCatalog] SQLite sync failed:', e.message);
  }
  scheduleCache.clear();
}

function makeAdminToken(username, role) {
  const payload = JSON.stringify({ user: username, role, exp: Date.now() + 7 * 24 * 3600 * 1000 });
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
  const payload = verifyAdminToken(token);
  if (!payload) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  req.adminUser = payload.user || 'unknown';
  // Backward-compat: old tokens without role field — env superadmin → superadmin, else editor
  req.adminRole = payload.role || (req.adminUser === ENV_SUPERADMIN.username ? 'superadmin' : 'editor');
  next();
}

function requireSuperAdmin(req, res, next) {
  requireAdmin(req, res, () => {
    if (req.adminRole !== 'superadmin') {
      res.status(403).json({ error: 'Superadmin required' });
      return;
    }
    next();
  });
}

function readSkipList() {
  try { return JSON.parse(fs.readFileSync(SKIP_LIST_PATH, 'utf8')); } catch (_) { return []; }
}

function writeSkipList(list) {
  fs.writeFileSync(SKIP_LIST_PATH, JSON.stringify(list, null, 2), 'utf8');
}

function withLastUpdated(data) {
  return { ...data, last_updated: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z') };
}

function getLastUpdatedMs(filePath) {
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (data.last_updated) return new Date(data.last_updated).getTime();
  } catch (_) {}
  return fs.statSync(filePath).mtimeMs;
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

  app.get('/api/search', (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (!q) { res.json([]); return; }
    if (q.length > 200) { res.status(400).json({ error: 'query too long' }); return; }

    const qLower = q.toLowerCase();
    const pattern = `%${qLower}%`;

    // If query looks like "First Last", also try "Last, First" for lecturers_json matching.
    // E.g. "richard wombacher" → also match "wombacher, richard".
    let lecturerPattern = pattern;
    const words = qLower.trim().split(/\s+/);
    if (words.length === 2) {
      lecturerPattern = `%${words[1]}, ${words[0]}%`;
    }

    const skipSet = new Set(readSkipList().map(String));

    let db;
    try {
      db = openDb();

      // For each matching course, return one row per (building_name, room) combination.
      const rows = db.prepare(`
        SELECT
          c.id AS course_id,
          c.title,
          c.lecturers_json,
          c.detail_link,
          c.start_date,
          c.end_date,
          o.building_name,
          o.room,
          o.start_time,
          o.end_time,
          o.note,
          o.next_date,
          o.last_date
        FROM courses c
        LEFT JOIN (
          SELECT course_id, building_name, room,
                 start_time, end_time, note,
                 MIN(CASE WHEN date >= date('now') THEN date END) AS next_date,
                 MAX(date) AS last_date
          FROM occurrences
          GROUP BY course_id, building_name, room
        ) o ON o.course_id = c.id
        WHERE
          LOWER(c.title) LIKE @p OR
          LOWER(c.lecturers_json) LIKE @p OR
          LOWER(c.lecturers_json) LIKE @lp OR
          LOWER(COALESCE(o.note, '')) LIKE @p
        ORDER BY c.title
        LIMIT 300
      `).all({ p: pattern, lp: lecturerPattern });

      // Also search building/room names
      const roomRows = db.prepare(`
        SELECT
          c.id AS course_id,
          c.title,
          c.lecturers_json,
          c.detail_link,
          c.start_date,
          c.end_date,
          o.building_name,
          o.room,
          o.start_time,
          o.end_time,
          o.note,
          o.next_date,
          o.last_date
        FROM (
          SELECT course_id, building_name, room,
                 MIN(start_time) AS start_time, MIN(end_time) AS end_time,
                 MIN(note) AS note,
                 MIN(CASE WHEN date >= date('now') THEN date END) AS next_date,
                 MAX(date) AS last_date
          FROM occurrences
          GROUP BY course_id, building_name, room
        ) o
        JOIN courses c ON c.id = o.course_id
        WHERE
          LOWER(COALESCE(o.building_name, '')) LIKE @p OR
          LOWER(COALESCE(o.room, '')) LIKE @p
        LIMIT 300
      `).all({ p: pattern });

      // Merge and deduplicate by (course_id, building_name, room)
      const seen = new Set();
      const merged = [];
      for (const row of [...rows, ...roomRows]) {
        const key = `${row.course_id}|${row.building_name || ''}|${row.room || ''}`;
        if (!seen.has(key)) { seen.add(key); merged.push(row); }
      }

      const results = [];
      for (const row of merged) {
        if (skipSet.has(String(row.course_id))) continue;

        let lecturers = [];
        try { lecturers = JSON.parse(row.lecturers_json || '[]'); } catch (_) {}
        const profStr = Array.isArray(lecturers)
          ? lecturers.map(l => {
              if (typeof l !== 'string') return l;
              let name = l.trim();
              const nnMatch = name.match(/<N\.N\.>\(([^)]+)\)/);
              if (nnMatch) name = nnMatch[1].trim();
              else name = name.replace(/,\s*\d+\.\d+$/, '').trim();
              const parts = name.split(',');
              if (parts.length === 2) return `${parts[1].trim()} ${parts[0].trim()}`;
              return name;
            }).join(', ')
          : '';

        const buildingId = (row.building_name || 'Unknown').trim();

        results.push({
          course: {
            id: String(row.course_id),
            time: makeTimeRange(row.start_time, row.end_time),
            name: makeCourseLabel(row.title, row.course_id),
            prof: profStr,
            link: row.detail_link || null,
            note: row.note || null,
            start_date: row.start_date || null,
            end_date: row.end_date || null,
          },
          room: row.room || 'Unknown',
          roomDisplayName: row.room || 'Unknown',
          buildingId,
          buildingLabel: buildingId,
          startMinutes: row.start_time ? (() => { const [h, m] = row.start_time.split(':').map(Number); return h * 60 + m; })() : 0,
          endMinutes: row.end_time ? (() => { const [h, m] = row.end_time.split(':').map(Number); return h * 60 + m; })() : 0,
          hasValidTime: !!(row.start_time && row.end_time),
          targetDate: row.next_date || row.last_date || null,
        });
      }

      results.sort((a, b) => a.startMinutes - b.startMinutes);
      res.setHeader('Cache-Control', 'no-store');
      res.json(results);
    } catch (err) {
      console.error('/api/search error:', err);
      res.status(500).json({ error: 'internal error' });
    } finally {
      if (db) db.close();
    }
  });


  app.post('/api/admin/login', (req, res) => {
    const { username, password } = req.body || {};
    const account = findAccount(username);
    if (!account || account.password !== password) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }
    res.json({ token: makeAdminToken(username, account.role) });
  });

  // ── Account management (superadmin only) ─────────────────────────────────
  app.get('/api/admin/accounts', requireSuperAdmin, (_req, res) => {
    const accounts = getAllAccounts().map(({ username, role }) => ({ username, role }));
    res.json(accounts);
  });

  app.post('/api/admin/accounts', requireSuperAdmin, (req, res) => {
    const { username, password, role } = req.body || {};
    if (!username || typeof username !== 'string' || !/^[a-zA-Z0-9_\-]{2,32}$/.test(username)) {
      res.status(400).json({ error: 'username must be 2-32 alphanumeric chars' }); return;
    }
    if (!password || typeof password !== 'string' || password.length < 6) {
      res.status(400).json({ error: 'password must be at least 6 characters' }); return;
    }
    if (!['superadmin', 'editor'].includes(role)) {
      res.status(400).json({ error: 'role must be superadmin or editor' }); return;
    }
    if (username === ENV_SUPERADMIN.username) {
      res.status(409).json({ error: 'Cannot create account with the same username as the system superadmin' }); return;
    }
    const accounts = readAccounts();
    if (accounts.some(a => a.username === username)) {
      res.status(409).json({ error: 'Username already exists' }); return;
    }
    accounts.push({ username, password, role });
    writeAccounts(accounts);
    audit(req, 'create_account', username, `Created account (role: ${role})`, { username });
    res.json({ ok: true });
  });

  app.delete('/api/admin/accounts/:username', requireSuperAdmin, (req, res) => {
    const { username } = req.params;
    if (username === ENV_SUPERADMIN.username) {
      res.status(409).json({ error: 'Cannot delete the system superadmin account' }); return;
    }
    if (username === req.adminUser) {
      res.status(409).json({ error: 'Cannot delete your own account' }); return;
    }
    const accounts = readAccounts();
    const deletedAccount = accounts.find(a => a.username === username);
    if (!deletedAccount) {
      res.status(404).json({ error: 'Account not found' }); return;
    }
    writeAccounts(accounts.filter(a => a.username !== username));
    audit(req, 'delete_account', username, 'Deleted account', { username: deletedAccount.username, password: deletedAccount.password, role: deletedAccount.role });
    res.json({ ok: true });
  });

  app.get('/api/admin/audit-log', requireSuperAdmin, (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 200, 1000);
    res.json(readAuditLog().slice(0, limit));
  });

  app.post('/api/admin/audit-log/:entryId/undo', requireSuperAdmin, (req, res) => {
    const { entryId } = req.params;
    const log = readAuditLog();
    const idx = log.findIndex(e => e.id === entryId);
    if (idx === -1) { res.status(404).json({ error: 'Log entry not found' }); return; }
    const entry = log[idx];
    if (entry.undone) { res.status(409).json({ error: 'Already undone' }); return; }
    const { action, snapshot } = entry;
    if (!snapshot) { res.status(400).json({ error: 'No snapshot — cannot undo this entry' }); return; }
    try {
      switch (action) {
        case 'hide_course': {
          const list = readSkipList().filter(id => id !== snapshot.courseId);
          writeSkipList(list); break;
        }
        case 'unhide_course': {
          const list = readSkipList();
          if (!list.includes(snapshot.courseId)) { list.push(snapshot.courseId); writeSkipList(list); } break;
        }
        case 'edit_course': {
          if (!snapshot.previousData) { res.status(400).json({ error: 'No previous data in snapshot' }); return; }
          const ovPath = path.join(OVERRIDES_DIR, `course-${snapshot.courseId}.json`);
          if (!fs.existsSync(OVERRIDES_DIR)) fs.mkdirSync(OVERRIDES_DIR, { recursive: true });
          fs.writeFileSync(ovPath, JSON.stringify(withLastUpdated(snapshot.previousData), null, 2), 'utf8');
          try { syncSingleCourse(snapshot.courseId); } catch (_) {} break;
        }
        case 'create_course': {
          const customFilePath = path.join(CUSTOM_DIR, `course-${snapshot.courseId}.json`);
          if (fs.existsSync(customFilePath)) fs.unlinkSync(customFilePath);
          if (fs.existsSync(DB_PATH)) {
            const db = new Database(DB_PATH);
            try {
              db.prepare('DELETE FROM occurrences WHERE course_id = ?').run(snapshot.courseId);
              db.prepare('DELETE FROM courses WHERE id = ?').run(snapshot.courseId);
            } finally { db.close(); }
          } break;
        }
        case 'batch_edit_room': {
          const { origRoom, origBuilding, newRoom: nr, newBuilding: nb, courseIds: affectedIds } = snapshot;
          for (const cid of (affectedIds || [])) {
            const p = resolveCoursePath(cid);
            if (!p) continue;
            let data; try { data = JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) { continue; }
            const weeks = (data.weeks || []).map(w => {
              if ((w.room || null) === (nr || null) && (w.building || null) === (nb || null))
                return { ...w, room: origRoom || null, building: origBuilding || null };
              return w;
            });
            const ovPath = path.join(OVERRIDES_DIR, `course-${cid}.json`);
            if (!fs.existsSync(OVERRIDES_DIR)) fs.mkdirSync(OVERRIDES_DIR, { recursive: true });
            fs.writeFileSync(ovPath, JSON.stringify(withLastUpdated({ ...data, weeks }), null, 2), 'utf8');
            try { syncSingleCourse(cid); } catch (_) {}
          } break;
        }
        case 'edit_building': {
          if (!snapshot.previousBuilding) { res.status(400).json({ error: 'No previous building in snapshot' }); return; }
          const catalog = readCatalog();
          const bldIdx = findBuilding(catalog.buildings, snapshot.buildingId);
          if (bldIdx !== -1) { catalog.buildings[bldIdx] = snapshot.previousBuilding; writeCatalog(catalog); } break;
        }
        case 'create_building': {
          const catalog = readCatalog();
          catalog.buildings = (catalog.buildings || []).filter(b => b.id !== snapshot.buildingId);
          writeCatalog(catalog); break;
        }
        case 'delete_building': {
          const catalog = readCatalog();
          if (!catalog.buildings) catalog.buildings = [];
          if (!catalog.buildings.some(b => b.id === snapshot.building.id)) {
            catalog.buildings.push(snapshot.building); writeCatalog(catalog); } break;
        }
        case 'merge_building': {
          const catalog = readCatalog();
          const tgtIdx = findBuilding(catalog.buildings, snapshot.previousTarget.id);
          if (tgtIdx !== -1) catalog.buildings[tgtIdx] = snapshot.previousTarget;
          if (!catalog.buildings.some(b => b.id === snapshot.sourceBuilding.id))
            catalog.buildings.push(snapshot.sourceBuilding);
          writeCatalog(catalog); break;
        }
        case 'create_room': {
          const catalog = readCatalog();
          const bldIdx = findBuilding(catalog.buildings, snapshot.buildingId);
          if (bldIdx !== -1) {
            catalog.buildings[bldIdx].rooms = (catalog.buildings[bldIdx].rooms || []).filter(r => r.id !== snapshot.roomId);
            writeCatalog(catalog); } break;
        }
        case 'delete_room': {
          const catalog = readCatalog();
          const bldIdx = findBuilding(catalog.buildings, snapshot.buildingId);
          if (bldIdx !== -1) {
            if (!catalog.buildings[bldIdx].rooms) catalog.buildings[bldIdx].rooms = [];
            if (!catalog.buildings[bldIdx].rooms.some(r => r.id === snapshot.room.id)) {
              catalog.buildings[bldIdx].rooms.push(snapshot.room); writeCatalog(catalog); } } break;
        }
        case 'edit_room': {
          if (!snapshot.previousRoom) { res.status(400).json({ error: 'No previous room in snapshot' }); return; }
          const catalog = readCatalog();
          const bldIdx = findBuilding(catalog.buildings, snapshot.buildingId);
          if (bldIdx !== -1) {
            const roomIdx = (catalog.buildings[bldIdx].rooms || []).findIndex(r => r.id === snapshot.previousRoom.id);
            if (roomIdx !== -1) { catalog.buildings[bldIdx].rooms[roomIdx] = snapshot.previousRoom; writeCatalog(catalog); }
          } break;
        }
        case 'create_account': {
          writeAccounts(readAccounts().filter(a => a.username !== snapshot.username)); break;
        }
        case 'delete_account': {
          const accs = readAccounts();
          if (!accs.some(a => a.username === snapshot.username) && snapshot.username !== ENV_SUPERADMIN.username)
            accs.push({ username: snapshot.username, password: snapshot.password, role: snapshot.role });
          writeAccounts(accs); break;
        }
        default:
          res.status(400).json({ error: `Undo not supported for action: ${action}` }); return;
      }
      // Mark entry as undone in log
      log[idx] = { ...entry, undone: true, undoneAt: new Date().toISOString(), undoneBy: req.adminUser };
      try { fs.writeFileSync(AUDIT_LOG_PATH, JSON.stringify(log, null, 2), 'utf8'); } catch (_) {}
      audit(req, `undo_${action}`, entry.target, `Undone: ${entry.summary || action} by ${entry.username}`);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
  // ─────────────────────────────────────────────────────────────────────────

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
    audit(req, 'hide_course', courseId, 'Hidden course from schedule', { courseId });
    res.json({ ok: true, skip: list });
  });

  app.delete('/api/admin/skip/:courseId', requireAdmin, (req, res) => {
    const courseId = req.params.courseId;
    const list = readSkipList().filter(id => id !== courseId);
    writeSkipList(list);
    audit(req, 'unhide_course', courseId, 'Unhidden course', { courseId });
    res.json({ ok: true, skip: list });
  });

  // GET /api/admin/stale-overrides
  // Returns override files whose source JSON in COURSE_DIR has been updated more recently,
  // excluding cases where the only changed field is last_updated (crawler timestamp noise).
  app.get('/api/admin/stale-overrides', requireAdmin, (req, res) => {
    // Fields that are irrelevant for staleness — changes to these alone are not reported.
    const IGNORED_FIELDS = new Set(['last_updated']);

    function hasMeaningfulChanges(srcObj, ovObj) {
      const allKeys = new Set([...Object.keys(srcObj), ...Object.keys(ovObj)]);
      for (const key of allKeys) {
        if (IGNORED_FIELDS.has(key)) continue;
        if (JSON.stringify(srcObj[key]) !== JSON.stringify(ovObj[key])) return true;
      }
      return false;
    }

    try {
      const stale = [];
      let files;
      try { files = fs.readdirSync(OVERRIDES_DIR); } catch (_) { files = []; }
      for (const file of files) {
        const m = file.match(/^course-(.+)\.json$/);
        if (!m) continue;
        const courseId = m[1];
        const ovPath = path.join(OVERRIDES_DIR, file);
        const srcPath = path.join(COURSE_DIR, file);
        if (!fs.existsSync(srcPath)) continue;
        const ovMtime = getLastUpdatedMs(ovPath);
        const srcMtime = getLastUpdatedMs(srcPath);
        if (srcMtime <= ovMtime) continue;
        // Source is newer — check if any meaningful fields actually changed
        try {
          const srcObj = JSON.parse(fs.readFileSync(srcPath, 'utf8'));
          const ovObj = JSON.parse(fs.readFileSync(ovPath, 'utf8'));
          if (!hasMeaningfulChanges(srcObj, ovObj)) continue;
        } catch (_) { /* if parse fails, treat as stale to be safe */ }
        stale.push({ courseId, srcMtime, ovMtime });
      }
      stale.sort((a, b) => b.srcMtime - a.srcMtime);
      res.json(stale);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/admin/course-file-both/:courseId
  // Returns both the source (COURSE_DIR) and override versions of a course file.
  app.get('/api/admin/course-file-both/:courseId', requireAdmin, (req, res) => {
    const { courseId } = req.params;
    if (!/^[\w\-\.]+$/.test(courseId)) { res.status(400).json({ error: 'Invalid course ID' }); return; }
    const filename = `course-${courseId}.json`;
    try {
      const srcPath = path.join(COURSE_DIR, filename);
      const ovPath = path.join(OVERRIDES_DIR, filename);
      const source = fs.existsSync(srcPath) ? JSON.parse(fs.readFileSync(srcPath, 'utf8')) : null;
      const override = fs.existsSync(ovPath) ? JSON.parse(fs.readFileSync(ovPath, 'utf8')) : null;
      const srcMtime = fs.existsSync(srcPath) ? getLastUpdatedMs(srcPath) : null;
      const ovMtime = fs.existsSync(ovPath) ? getLastUpdatedMs(ovPath) : null;
      res.json({ source, override, srcMtime, ovMtime });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/admin/stale-overrides/:courseId/dismiss
  // Updates override file mtime to mark it as reviewed (touch the file).
  app.post('/api/admin/stale-overrides/:courseId/dismiss', requireAdmin, (req, res) => {
    const { courseId } = req.params;
    if (!/^[\w\-\.]+$/.test(courseId)) { res.status(400).json({ error: 'Invalid course ID' }); return; }
    const ovPath = path.join(OVERRIDES_DIR, `course-${courseId}.json`);
    if (!fs.existsSync(ovPath)) { res.status(404).json({ error: 'Override not found' }); return; }
    try {
      const content = JSON.parse(fs.readFileSync(ovPath, 'utf8'));
      content.last_updated = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
      fs.writeFileSync(ovPath, JSON.stringify(content, null, 2), 'utf8');
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/admin/stale-overrides/:courseId/merge-weeks
  // Merges source weeks into override, preserving manually-set fields (building, note).
  // Match key: (day_of_week, start_time, end_time, room). For each source week:
  //   - If a matching override week exists, use source as base but keep override's building/note.
  //   - Otherwise use source week as-is.
  // Top-level fields (title, type, etc.) remain as in the current override.
  app.post('/api/admin/stale-overrides/:courseId/merge-weeks', requireAdmin, (req, res) => {
    const { courseId } = req.params;
    if (!/^[\w\-\.]+$/.test(courseId)) { res.status(400).json({ error: 'Invalid course ID' }); return; }
    const filename = `course-${courseId}.json`;
    const srcPath = path.join(COURSE_DIR, filename);
    const ovPath = path.join(OVERRIDES_DIR, filename);
    if (!fs.existsSync(srcPath)) { res.status(404).json({ error: 'Source file not found' }); return; }
    if (!fs.existsSync(ovPath)) { res.status(404).json({ error: 'Override not found' }); return; }
    try {
      const src = JSON.parse(fs.readFileSync(srcPath, 'utf8'));
      const ov = JSON.parse(fs.readFileSync(ovPath, 'utf8'));

      // Fields that are "manual" — preserve from override when a matching week is found.
      const MANUAL_WEEK_FIELDS = ['building', 'note'];

      // Build a lookup from override weeks: key -> week object
      function weekKey(w) {
        return [w.day_of_week, w.start_time, w.end_time, w.room || w.location].join('|');
      }
      const ovWeekMap = new Map();
      for (const w of (Array.isArray(ov.weeks) ? ov.weeks : [])) {
        ovWeekMap.set(weekKey(w), w);
      }

      const mergedWeeks = (Array.isArray(src.weeks) ? src.weeks : []).map(srcWeek => {
        const key = weekKey(srcWeek);
        const ovWeek = ovWeekMap.get(key);
        if (!ovWeek) return { ...srcWeek };
        const merged = { ...srcWeek };
        for (const field of MANUAL_WEEK_FIELDS) {
          if (ovWeek[field] != null) merged[field] = ovWeek[field];
        }
        return merged;
      });

      const updated = {
        ...ov,
        weeks: mergedWeeks,
        last_updated: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
      };
      fs.writeFileSync(ovPath, JSON.stringify(updated, null, 2), 'utf8');
      syncSingleCourse(courseId);
      res.json({ ok: true, mergedWeeks: mergedWeeks.length });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // DELETE /api/admin/overrides/:courseId
  // Deletes the override file so the course falls back to the source JSON.
  app.delete('/api/admin/overrides/:courseId', requireAdmin, (req, res) => {
    const { courseId } = req.params;
    if (!/^[\w\-\.]+$/.test(courseId)) { res.status(400).json({ error: 'Invalid course ID' }); return; }
    const ovPath = path.join(OVERRIDES_DIR, `course-${courseId}.json`);
    if (!fs.existsSync(ovPath)) { res.status(404).json({ error: 'Override not found' }); return; }
    try {
      fs.unlinkSync(ovPath);
      syncSingleCourse(courseId);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
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
      // Capture previous state before overwriting
      let previousData = null;
      try {
        const prevPath = fs.existsSync(overridePath) ? overridePath : path.join(COURSE_DIR, filename);
        if (fs.existsSync(prevPath)) previousData = JSON.parse(fs.readFileSync(prevPath, 'utf8'));
      } catch (_) {}
      if (!fs.existsSync(OVERRIDES_DIR)) fs.mkdirSync(OVERRIDES_DIR, { recursive: true });
      fs.writeFileSync(overridePath, JSON.stringify(withLastUpdated(req.body), null, 2), 'utf8');
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
      audit(req, 'edit_course', courseId, `Edited course file`, { courseId, previousData });
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
      audit(req, 'create_course', courseId, `Created custom event: ${payload.title}`, { courseId });
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
        fs.writeFileSync(overridePath, JSON.stringify(withLastUpdated({ ...data, weeks: newWeeks }), null, 2), 'utf8');
        try { syncSingleCourse(courseId); } catch (e) { console.error(`[batch] sync failed for ${courseId}:`, e.message); }
        updatedCourseIds.push(courseId);
      } catch (e) { console.error(`[batch] write failed for ${courseId}:`, e.message); }
    }

    audit(req, 'batch_edit_room', null, `Batch room change: "${origRoom}" → "${newRoom || ''}", updated ${updatedCourseIds.length} course(s)`, { origRoom, origBuilding, newRoom: newRoom || null, newBuilding: newBuilding || null, courseIds: updatedCourseIds });
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
    const previousBuilding = JSON.parse(JSON.stringify(catalog.buildings[idx]));
    catalog.buildings[idx] = { ...catalog.buildings[idx], ...req.body, id: realId };
    try { writeCatalog(catalog); audit(req, 'edit_building', buildingId, `Edited building`, { buildingId, previousBuilding }); res.json({ ok: true }); } catch (e) { res.status(500).json({ error: e.message }); }
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

  app.get('/api/admin/building/:buildingId/rooms', requireAdmin, (req, res) => {
    const catalog = readCatalog();
    const building = (catalog.buildings || []).find(b => b.id === req.params.buildingId);
    if (!building) { res.status(404).json({ error: 'Building not found' }); return; }
    const rooms = (building.rooms || []).map(r => ({ id: r.id, name: r.name, floors: r.floors || [] }));
    res.json(rooms);
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
    const snapshotSrc = JSON.parse(JSON.stringify(src));
    const snapshotTgt = JSON.parse(JSON.stringify(tgt));

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
      audit(req, 'merge_building', buildingId, `Merged into ${targetId}`, { sourceBuilding: snapshotSrc, previousTarget: snapshotTgt });
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
    try { writeCatalog(catalog); audit(req, 'create_building', id, `Created building: ${body.street}`, { buildingId: id }); res.json({ ok: true, id }); } catch (e) { res.status(500).json({ error: e.message }); }
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
      displayName: (req.body.displayName || '').trim(),
      floors: Array.isArray(req.body.floors) ? req.body.floors : [],
      features: { hasAirConditioning: null, hasAccessControl: null },
      notes: req.body.notes || '',
    };
    rooms.push(newRoom);
    building.rooms = rooms;
    try { writeCatalog(catalog); audit(req, 'create_room', buildingId, `Added room: ${roomName}`, { buildingId, roomId: newRoom.id }); res.json({ ok: true, id: newRoom.id }); } catch (e) { res.status(500).json({ error: e.message }); }
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
    try { writeCatalog(catalog); audit(req, 'delete_building', buildingId, `Deleted building: ${building.street}`, { building: JSON.parse(JSON.stringify(building)) }); res.json({ ok: true }); } catch (e) { res.status(500).json({ error: e.message }); }
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
    try { writeCatalog(catalog); audit(req, 'delete_room', `${buildingId}/${room.name}`, `Deleted room: ${room.name}`, { buildingId, room: JSON.parse(JSON.stringify(room)) }); res.json({ ok: true }); } catch (e) { res.status(500).json({ error: e.message }); }
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
    const previousRoom = JSON.parse(JSON.stringify(rooms[roomIdx]));
    rooms[roomIdx] = { ...rooms[roomIdx], ...req.body, id: realId };
    building.rooms = rooms;
    try { writeCatalog(catalog); audit(req, 'edit_room', `${buildingId}/${rooms[roomIdx].name}`, `Edited room: ${rooms[roomIdx].name}`, { buildingId, previousRoom }); res.json({ ok: true }); } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ────────────────────────────────────────────────────────────────────────

  // In-memory response cache for /api/schedule (TTL: 60s)
  // Note: scheduleCache is declared at module level so writeCatalog can clear it.
  const SCHEDULE_CACHE_TTL = 60_000;

  function getScheduleCache(key) {
    const entry = scheduleCache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.ts > SCHEDULE_CACHE_TTL) {
      scheduleCache.delete(key);
      return null;
    }
    return entry.data;
  }

  function setScheduleCache(key, data) {
    // Limit cache size to avoid unbounded growth
    if (scheduleCache.size > 200) {
      const oldest = scheduleCache.keys().next().value;
      scheduleCache.delete(oldest);
    }
    scheduleCache.set(key, { data, ts: Date.now() });
  }

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

    res.setHeader('Cache-Control', 'no-store');

    // Admin requests bypass cache (skip list excluded, may see hidden courses)
    const cacheKey = isAdmin ? null : `${date}|${buildingFilter || ''}`;
    if (cacheKey) {
      const cached = getScheduleCache(cacheKey);
      if (cached) {
        res.setHeader('X-Cache', 'HIT');
        res.json(cached);
        return;
      }
    }

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

      function ensureRoomEntry(buildingName, roomName, floorLabel, features, displayName) {
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
              displayName: displayName || null,
              floor,
              features: features || null,
              courses: [],
            };
            rooms[resolvedBuilding].push(roomEntry);
          }
        }
        if (displayName && !roomEntry.displayName) {
          roomEntry.displayName = displayName;
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
                r.display_name AS room_display_name,
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
            ensureRoomEntry(roomRow.building_name, roomRow.room_name, floorLabel, features, roomRow.room_display_name || null);
          }
        }
      } catch(e) {}

      // Pre-seed all rooms that have ever appeared in occurrences for "other" and
      // "mannheim-and-ludwigshafen" campus buildings, so they show up even on days
      // with no courses (mirrors behaviour of the main campuses).
      try {
        // First get the canonical building names for these campus types (small result set)
        const otherBuildingNames = db
          .prepare(
            `SELECT name FROM buildings_meta WHERE campus_id IN ('other', 'mannheim-and-ludwigshafen') AND name IS NOT NULL`
          )
          .all()
          .map(r => r.name.trim())
          .filter(Boolean);

        if (otherBuildingNames.length > 0) {
          const placeholders = otherBuildingNames.map(() => '?').join(',');
          const otherRoomRows = db
            .prepare(
              `SELECT building_name, room, MAX(floor_label) AS floor_label
               FROM occurrences
               WHERE building_name IN (${placeholders})
                 AND room IS NOT NULL
                 AND building_name IS NOT NULL
               GROUP BY building_name, room`
            )
            .all(...otherBuildingNames);
          for (const row of otherRoomRows) {
            ensureRoomEntry(row.building_name, row.room, row.floor_label || null, null);
          }
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
                c.lecturers_json,
                c.start_date,
                c.end_date
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
                c.lecturers_json,
                c.start_date,
                c.end_date
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
          start_date: row.start_date || null,
          end_date: row.end_date || null,
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

      const responseData = { buildings, rooms };
      if (cacheKey) setScheduleCache(cacheKey, responseData);
      res.json(responseData);
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
