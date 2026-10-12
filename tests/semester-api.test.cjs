const assert = require('node:assert/strict');
const { test, before, after } = require('node:test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'heiview-semesters-test-'));
process.env.HEIVIEW_DATA_DIR = temporary;
process.env.ADMIN_USER = 'test-admin';
process.env.ADMIN_PASS = 'test-password';
const Database = require('better-sqlite3');
const { semesterForDate, pathsFor, withPaths, getPaths } = require('../server/semesters.cjs');
const { createApp } = require('../server/index.cjs');
let server, base, token;

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data));
}

function sample(semester, title = semester) {
  const date = semester === '2026SS' ? '2026-04-06' : '2026-10-05';
  return { id: 'shared', title, lecturers: ['Test, Lecturer'], detail_link: 'https://example.com/course',
    start_date: date, end_date: date, weeks: [{ day_of_week: 1, start_date: date, end_date: date,
      start_time: '10:00', end_time: '11:00', room: 'Room 1', building: 'Test Building' }] };
}

function sync(semester) {
  const result = spawnSync('npm', ['run', 'db:sync'], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, HEIVIEW_SEMESTER: semester }, encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
}

async function request(url, options) {
  const response = await fetch(base + url, options);
  return { response, data: await response.json() };
}

function findCourse(schedule) {
  return Object.values(schedule.rooms).flat().flatMap(room => room.courses).find(course => course.id === 'shared');
}

before(async () => {
  writeJson(path.join(temporary, 'building-catalog.json'), {
    campuses: [{ id: 'altstadt', name: 'Altstadt' }],
    buildings: [{ id: 'test-building', street: 'Test Building', campusId: 'altstadt', aliases: [], floors: [],
      rooms: [{ id: 'test-room', name: 'Room 1', floors: [], features: {} }] }],
  });
  for (const semester of ['2026SS', '2026WS']) {
    const paths = pathsFor(semester);
    writeJson(path.join(paths.courseDir, 'course-shared.json'), sample(semester));
    writeJson(paths.syncMetaPath, { currentSeason: semester, lastSyncTime: `${semester}-sync`, courseCount: 1 });
    sync(semester);
  }
  server = createApp().listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  base = `http://127.0.0.1:${server.address().port}`;
  const login = await request('/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'test-admin', password: 'test-password' }) });
  token = login.data.token;
  assert.ok(token);
});

after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  fs.rmSync(temporary, { recursive: true, force: true });
});

test('calendar boundaries and invalid calendar dates', () => {
  for (const [date, semester] of Object.entries({
    '2026-03-31': '2025WS', '2026-04-01': '2026SS', '2026-09-30': '2026SS',
    '2026-10-01': '2026WS', '2027-01-01': '2026WS', '2027-03-31': '2026WS',
    '2027-04-01': '2027SS',
  })) assert.equal(semesterForDate(date), semester);
  for (const date of ['2026-02-30', '2026-13-01', '2026-1-1', 'garbage']) {
    assert.throws(() => semesterForDate(date));
  }
});

test('request contexts stay independent across async work', async () => {
  const results = await Promise.all(['2026SS', '2026WS'].map(semester =>
    withPaths(pathsFor(semester), async () => {
      await new Promise(resolve => setImmediate(resolve));
      return getPaths().semester;
    })));
  assert.deepEqual(results, ['2026SS', '2026WS']);
});

test('schedule loads only selected semester and date, including identical course IDs', async () => {
  const [summer, winter] = await Promise.all([
    request('/api/schedule?date=2026-04-06'), request('/api/schedule?date=2026-10-05'),
  ]);
  assert.equal(summer.response.status, 200);
  assert.equal(winter.response.status, 200);
  assert.equal(summer.data.semester, '2026SS');
  assert.equal(winter.data.semester, '2026WS');
  assert.equal(findCourse(summer.data).name, '2026SS');
  assert.equal(findCourse(winter.data).name, '2026WS');
  assert.equal(findCourse(winter.data).semester, '2026WS');
  assert.equal(summer.data.lastSyncTime, '2026SS-sync');
  assert.equal(winter.data.lastSyncTime, '2026WS-sync');
  const empty = await request('/api/schedule?date=2026-10-06');
  assert.equal(empty.response.status, 200);
  assert.equal(findCourse(empty.data), undefined);
});

test('invalid date and missing semester data are distinct', async () => {
  const invalid = await request('/api/schedule?date=2026-02-30');
  assert.equal(invalid.response.status, 400);
  const missing = await request('/api/schedule?date=2025-10-01');
  assert.equal(missing.response.status, 503);
  assert.equal(missing.data.code, 'SEMESTER_NOT_READY');
  assert.equal(missing.data.semester, '2025WS');
  const mismatch = await request('/api/schedule?date=2026-10-05&semester=2026SS');
  assert.equal(mismatch.response.status, 400);
});

test('search and course slots carry the selected semester', async () => {
  for (const semester of ['2026SS', '2026WS']) {
    const search = await request(`/api/search?q=${semester}&semester=${semester}`);
    assert.equal(search.response.status, 200);
    assert.equal(search.data[0].course.semester, semester);
    const slots = await request(`/api/course/shared/slots?semester=${semester}`);
    assert.equal(slots.response.status, 200);
    assert.ok(slots.data[0].first_date.startsWith(semester === '2026SS' ? '2026-04' : '2026-10'));
  }
  const missing = await request('/api/course/shared/slots');
  assert.equal(missing.response.status, 400);
});

test('database sync replaces only its semester and cached responses see new content', async () => {
  for (const semester of ['2026SS', '2026WS']) {
    assert.ok(fs.existsSync(path.join(temporary, `${semester}.db`)));
    assert.ok(!fs.readdirSync(pathsFor(semester).courseDir).some(file => file.endsWith('.db')));
  }
  await request('/api/schedule?date=2026-10-05');
  const otherBefore = fs.readFileSync(pathsFor('2026SS').dbPath);
  writeJson(path.join(pathsFor('2026WS').courseDir, 'course-shared.json'), sample('2026WS', 'Winter Updated'));
  sync('2026WS');
  assert.deepEqual(fs.readFileSync(pathsFor('2026SS').dbPath), otherBefore);
  const fresh = await request('/api/schedule?date=2026-10-05');
  assert.equal(findCourse(fresh.data).name, 'Winter Updated');
  assert.notEqual(fresh.response.headers.get('X-Cache'), 'HIT');
});

test('failed import preserves published database', () => {
  const paths = pathsFor('2026WS');
  const before = fs.readFileSync(paths.dbPath);
  writeJson(path.join(paths.courseDir, 'course-shared.json'), { id: 'shared' });
  const result = spawnSync('npm', ['run', 'db:sync'], {
    cwd: path.resolve(__dirname, '..'), env: { ...process.env, HEIVIEW_SEMESTER: '2026WS' }, encoding: 'utf8',
  });
  assert.notEqual(result.status, 0);
  assert.deepEqual(fs.readFileSync(paths.dbPath), before);
  writeJson(path.join(paths.courseDir, 'course-shared.json'), sample('2026WS', 'Winter Updated'));
});

test('admin edits and feedback target explicit semesters', async () => {
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const missing = await request('/api/admin/course-file/shared', { headers });
  assert.equal(missing.response.status, 400);
  const summer = await request('/api/admin/course-file/shared?semester=2026SS', { headers });
  assert.equal(summer.data.title, '2026SS');
  const building = await request('/api/admin/building/test-building?semester=2026SS', { headers });
  assert.equal(building.response.status, 200);
  assert.equal(building.data.rooms.length, 1);
  const changed = await request('/api/admin/course-file/shared?semester=2026SS', {
    method: 'PUT', headers, body: JSON.stringify(sample('2026SS', 'Summer Override')),
  });
  assert.equal(changed.response.status, 200);
  assert.ok(fs.existsSync(path.join(pathsFor('2026SS').overridesDir, 'course-shared.json')));
  assert.ok(!fs.existsSync(path.join(pathsFor('2026WS').overridesDir, 'course-shared.json')));
  const form = new FormData();
  form.set('courseId', 'shared'); form.set('courseTitle', 'Winter Updated'); form.set('message', 'Test report');
  const report = await request('/api/feedback?semester=2026WS', { method: 'POST', body: form });
  assert.equal(report.response.status, 200);
  const saved = JSON.parse(fs.readFileSync(path.join(pathsFor('2026WS').feedbackDir, `${report.data.id}.json`)));
  assert.equal(saved.semester, '2026WS');
  assert.ok(!fs.existsSync(pathsFor('2026SS').feedbackDir));
});

test('legacy database is a read fallback only for 2026SS', async () => {
  const summer = pathsFor('2026SS');
  fs.copyFileSync(summer.dbPath, path.join(temporary, 'heiview.db'));
  fs.renameSync(summer.dbPath, summer.dbPath + '.saved');
  try {
    const result = await request('/api/schedule?date=2026-04-06');
    assert.equal(result.response.status, 200);
    assert.equal(result.data.semester, '2026SS');
    const missing = await request('/api/schedule?date=2027-04-01');
    assert.equal(missing.response.status, 503);
  } finally { fs.renameSync(summer.dbPath + '.saved', summer.dbPath); }
});

test('first admin write migrates legacy SS without modifying the legacy database', async () => {
  const summer = pathsFor('2026SS');
  const legacyFile = path.join(temporary, 'heiview.db');
  fs.copyFileSync(summer.dbPath, legacyFile);
  fs.renameSync(summer.dbPath, summer.dbPath + '.saved');
  const before = fs.readFileSync(legacyFile);
  try {
    const result = await request('/api/admin/course-file/shared?semester=2026SS', {
      method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(sample('2026SS', 'Migrated Summer Override')),
    });
    assert.equal(result.response.status, 200, JSON.stringify(result.data));
    assert.ok(fs.existsSync(summer.dbPath));
    assert.deepEqual(fs.readFileSync(legacyFile), before);
    const db = new Database(summer.dbPath, { readonly: true });
    try { assert.equal(db.prepare('SELECT title FROM courses WHERE id = ?').get('shared').title, 'Migrated Summer Override'); }
    finally { db.close(); }
  } finally {
    fs.rmSync(summer.dbPath, { force: true });
    fs.renameSync(summer.dbPath + '.saved', summer.dbPath);
  }
});

test('legacy further-information skip list is preserved for SS and isolated from WS', async () => {
  const legacy = path.join(temporary, 'further-info-skip.json');
  writeJson(legacy, ['legacy-skipped']);
  const headers = { Authorization: `Bearer ${token}` };
  const ss = await request('/api/admin/further-info-skip?semester=2026SS', { headers });
  const ws = await request('/api/admin/further-info-skip?semester=2026WS', { headers });
  assert.deepEqual(ss.data, ['legacy-skipped']);
  assert.deepEqual(ws.data, []);
  const saved = await request('/api/admin/further-info-skip/new-skipped?semester=2026SS', { method: 'POST', headers });
  assert.equal(saved.response.status, 200);
  assert.deepEqual(JSON.parse(fs.readFileSync(pathsFor('2026SS').furtherInfoSkipPath)), ['legacy-skipped', 'new-skipped']);
  assert.deepEqual(JSON.parse(fs.readFileSync(legacy)), ['legacy-skipped']);
});

test('database sync imports semester custom, override and skip files consistently', async () => {
  const paths = pathsFor('2026WS');
  writeJson(path.join(paths.customDir, 'course-custom.json'), { ...sample('2026WS', 'Custom Winter'), id: 'custom' });
  writeJson(path.join(paths.overridesDir, 'course-shared.json'), sample('2026WS', 'Winter Override'));
  writeJson(paths.skipListPath, ['custom']);
  sync('2026WS');
  const db = new Database(paths.dbPath, { readonly: true });
  try {
    assert.equal(db.prepare('SELECT title FROM courses WHERE id = ?').get('shared').title, 'Winter Override');
    assert.equal(db.prepare('SELECT id FROM courses WHERE id = ?').get('custom'), undefined);
    assert.equal(db.prepare('SELECT value FROM meta WHERE key = ?').get('semester').value, '2026WS');
  } finally { db.close(); }
});

test('admin writes fail clearly during database construction', async () => {
  const lock = path.join(pathsFor('2026WS').courseDir, '.db-sync.lock');
  fs.writeFileSync(lock, String(process.pid));
  try {
    const result = await request('/api/admin/skip?semester=2026WS', {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ courseId: 'shared' }),
    });
    assert.equal(result.response.status, 409);
  } finally { fs.rmSync(lock); }
});
