const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const Database = require('better-sqlite3');

const root = path.resolve(__dirname, '..');
function write(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value));
}
function run(data, all = true, semester = '2026WS') {
  return spawnSync(process.execPath, ['server/scripts/sync-db.cjs', ...(all ? ['--all'] : [])], {
    cwd: root, env: { ...process.env, HEIVIEW_DATA_DIR: data, HEIVIEW_SEMESTER: semester }, encoding: 'utf8',
  });
}
function success(result) { assert.equal(result.status, 0, result.stdout + result.stderr); }
function query(data, semester, sql) {
  const db = new Database(path.join(data, `${semester}.db`), { readonly: true });
  try { return db.prepare(sql).all(); } finally { db.close(); }
}
function catalog(data) { return JSON.parse(fs.readFileSync(path.join(data, 'building-catalog.json'), 'utf8')); }
function fixture(t) {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'heiview-all-sync-'));
  t.after(() => fs.rmSync(data, { recursive: true, force: true }));
  const known = (id, street, roomNames) => ({ id, street, campusId: 'altstadt', floors: [], aliases: [],
    rooms: roomNames.map((name, index) => ({ id: `${id}-room-${index}`, name, floors: [], features: {} })) });
  const other = (id, street) => ({ ...known(id, street, [street]), campusId: 'other' });
  write(path.join(data, 'building-catalog.json'), {
    campuses: [{ id: 'altstadt', name: 'Altstadt' }, { id: 'other', name: 'Other' },
      { id: 'im-neuenheimer-feld', name: 'Im Neuenheimer Feld' }],
    buildings: [
      known('known', 'Albert-Ueberle-Straße 3-5', ['Unique Seminar Room', 'Seminarraum (8020.01.160)', 'Common Room']),
      known('second', 'Second Building', ['Common Room']),
      known('empty-known', 'Empty Known Building', []),
      known('reviewed-slash', 'Reviewed/Building', []),
      other('legacy-hyphen', 'Reviewed-Building'),
      { ...known('inf', 'Im Neuenheimer Feld 123', ['HS']), campusId: 'im-neuenheimer-feld' },
      other('stale', 'Unused Other Building'),
      other('summer-only', 'Summer Only Location'),
      other('legacy-inf', 'INF 123 HS'),
      other('legacy-explicit', 'Legacy Other Building'),
      other('legacy-room', 'Unique Seminar Room'),
      other('ambiguous', 'Common Room'),
      other('legacy-structured', 'Seminar, Second Building, 2nd floor'),
    ],
  });
  for (const semester of ['2026SS', '2026WS']) {
    const date = semester === '2026SS' ? '2026-04-06' : '2026-10-05';
    const course = (id, room, building = null) => ({ id, title: id, weeks: [{ day_of_week: 1,
      start_date: date, end_date: date, start_time: '10:00', end_time: '11:00', room, building }] });
    const courses = [course('rule', 'INF 123 HS'), course('room', 'Unique Seminar Room'),
      course('code', '8020.01.160', 'Legacy Other Building'),
      course('explicit-other', 'Unique Seminar Room', 'Legacy Other Building'),
      course('ambiguous', 'Common Room'), course('unmatched', 'Unmatched Location'),
      course('explicit-known', 'Unique Seminar Room', 'Second Building'),
      course('structured', 'Seminar, Second Building, 2nd floor')];
    if (semester === '2026SS') courses.push(course('summer-only', 'Summer Only Location'));
    for (const payload of courses) write(path.join(data, semester, `course-${payload.id}.json`), payload);
  }
  return data;
}

test('Other matching runs after rules and unique reviewed rooms during full and single-course sync', t => {
  const data = fixture(t);
  success(run(data, false));
  const check = () => {
    const actual = Object.fromEntries(query(data, '2026WS',
      'SELECT course_id, building_name FROM occurrences').map(row => [row.course_id, row.building_name]));
    assert.deepEqual(actual, { rule: 'Im Neuenheimer Feld 123', room: 'Albert-Ueberle-Straße 3-5',
      code: 'Albert-Ueberle-Straße 3-5', 'explicit-other': 'Albert-Ueberle-Straße 3-5',
      ambiguous: 'Common Room', unmatched: 'Unmatched Location', 'explicit-known': 'Second Building', structured: 'Second Building' });
  };
  check();
  const result = spawnSync(process.execPath, ['-e', `
    const {syncSingleCourse} = require('./server/scripts/build-sqlite-db.cjs');
    for (const id of ['rule', 'room', 'code', 'explicit-other', 'ambiguous', 'unmatched', 'explicit-known', 'structured']) syncSingleCourse(id);
  `], { cwd: root, env: { ...process.env, HEIVIEW_DATA_DIR: data, HEIVIEW_SEMESTER: '2026WS' }, encoding: 'utf8' });
  success(result);
  check();
  assert.ok(catalog(data).buildings.some(building => building.id === 'stale'), 'single-semester sync must not prune shared Other entries');
});

test('all-semester sync prunes only Other buildings unused across every semester and updates every database', t => {
  const data = fixture(t);
  success(run(data));
  const current = catalog(data);
  for (const id of ['stale', 'legacy-inf', 'legacy-explicit', 'legacy-room', 'legacy-structured', 'legacy-hyphen']) {
    assert.ok(!current.buildings.some(building => building.id === id), `remove ${id}`);
  }
  for (const id of ['summer-only', 'empty-known', 'ambiguous', 'reviewed-slash']) {
    assert.ok(current.buildings.some(building => building.id === id), `keep ${id}`);
  }
  for (const semester of ['2026SS', '2026WS']) {
    const names = query(data, semester, 'SELECT name FROM buildings_meta').map(row => row.name).sort();
    assert.deepEqual(names, current.buildings.map(building => building.street).sort());
    assert.ok(!query(data, semester, 'SELECT building_name FROM occurrences').some(row => row.building_name === 'Unused Other Building'));
  }
  const firstCatalog = fs.readFileSync(path.join(data, 'building-catalog.json'), 'utf8');
  success(run(data));
  assert.equal(fs.readFileSync(path.join(data, 'building-catalog.json'), 'utf8'), firstCatalog);
});

test('missing source data prevents all-semester pruning and preserves published databases', t => {
  const data = fixture(t);
  success(run(data));
  const original = fs.readFileSync(path.join(data, '2026WS.db'));
  const originalCatalog = fs.readFileSync(path.join(data, 'building-catalog.json'));
  fs.renameSync(path.join(data, '2026SS'), path.join(data, 'saved-ss'));
  const result = run(data);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Course directory not found/);
  assert.deepEqual(fs.readFileSync(path.join(data, '2026WS.db')), original);
  assert.deepEqual(fs.readFileSync(path.join(data, 'building-catalog.json')), originalCatalog);
});

test('failed metadata import restores the catalog and leaves all published databases intact', t => {
  const data = fixture(t);
  success(run(data));
  const original = new Map(['2026SS', '2026WS'].map(semester => [semester, fs.readFileSync(path.join(data, `${semester}.db`))]));
  const broken = catalog(data);
  broken.buildings.find(building => building.id === 'known').rooms.push({ id: 'duplicate-room', name: 'Unique Seminar Room', floors: [], features: {} });
  broken.buildings.push({ id: 'new-stale', street: 'New Unused Location', campusId: 'other', aliases: [], rooms: [], floors: [] });
  write(path.join(data, 'building-catalog.json'), broken);
  const originalCatalog = fs.readFileSync(path.join(data, 'building-catalog.json'));
  const result = run(data);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /UNIQUE constraint failed/);
  assert.deepEqual(fs.readFileSync(path.join(data, 'building-catalog.json')), originalCatalog);
  for (const [semester, bytes] of original) assert.deepEqual(fs.readFileSync(path.join(data, `${semester}.db`)), bytes);
  assert.ok(!fs.readdirSync(data).some(name => name.endsWith('.lock') || name.startsWith('.2026')));
});
