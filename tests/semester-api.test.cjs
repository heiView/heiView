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
const { syncSingleCourse } = require('../server/scripts/build-sqlite-db.cjs');
let server, base, token;

const organisationMap = {
  mapping: { en: 'Faculty of Mapping & Astronomy', de: 'Fakultät für Zuordnung und Astronomie',
    abbrev: 'FMA', synonyms: ['Mapping Faculty'] },
  physics: { en: 'Institute for Physics', de: 'Physikalisches Institut', abbrev: 'PI' },
};
const locationMap = { entries: [
  { notes: ['Shared scoped note'], room: 'Mapped Room', building: 'Mapped Building',
    organisation: organisationMap.mapping.en },
  { notes: ['Shared open note'], room: 'Open Room', building: 'Mapped Building' },
  { notes: ['Institute note'], room: 'Institute Room', building: 'Mapped Building',
    organisation: organisationMap.physics.en },
] };

function mappingSamples(semester) {
  return [
    ['note-en', organisationMap.mapping.en, { note: 'Shared scoped note' }],
    ['location-de', organisationMap.mapping.de, { room: 'Shared scoped note', location: 'Shared scoped note' }],
    ['info-abbrev', 'FMA', {}, 'Shared scoped note'],
    ['missing-org', null, { note: 'Shared scoped note' }],
    ['unrelated-org', 'Department of Unrelated Studies', { note: 'Shared scoped note' }],
    ['open', null, { note: 'Shared open note' }],
    ['explicit', 'FMA', { room: 'Room 1', building: 'Test Building', note: 'Shared scoped note' }],
    ['short-substring', 'Tropical Studies', { note: 'Institute note' }],
    ['short-abbrev', 'PI', { note: 'Institute note' }],
  ].map(([id, organisation, week, further_info]) => {
    const course = sample(semester, `Mapping check ${id}`);
    return { ...course, id: `mapping-${id}`, organisation, further_info,
      weeks: [{ ...course.weeks[0], room: 'Siehe Anmerkung', building: null, ...week }] };
  });
}

function buildingAliasSamples(semester) {
  return [
    ['raw', { room: 'ZLS, Plöck 79 - 81', location: 'ZLS, Plöck 79 - 81' }],
    ['formatted', { room: ' ZLS , Plöck 79 – 81 ' }],
    ['address', { room: 'Plöck 79 - 81' }],
    ['comma-alias', { room: 'Language Centre, Main Site' }],
    ['alias-floor', { room: 'Language Centre, Main Site, 2nd floor' }, '2nd floor'],
    ['explicit-alias', { room: 'Room 105', building: 'Language Centre, Main Site, 1st floor' }, '1st floor'],
    ['explicit-building', { room: 'ZLS, Plöck 79 - 81', building: 'Test Building' }],
    ['unrelated', { room: 'Language Centre, Main Site annex' }],
  ].map(([id, week, floor = null]) => {
    const course = sample(semester, `Building alias check ${id}`);
    return { ...course, id: `building-alias-${id}`, weeks: [{ ...course.weeks[0], building: null, ...week }],
      expectedFloor: floor };
  });
}

function riesenSamples(semester) {
  return [
    ['106', { room: '106 Haus zum Riesen (10)' }, '106'],
    ['204', { room: '204 Haus zum Riesen (45)' }, '204'],
    ['zeros', { room: '002 Haus zum Riesen (40)' }, '002'],
    ['without-capacity', { room: '210 Haus zum Riesen' }, '210'],
    ['formatted', { room: ' 205  haus zum  riesen(15) ' }, '205'],
    ['location', { room: null, location: '204 Haus zum Riesen (45)' }, '204'],
    ['known-building', { room: '106 Haus zum Riesen (10)', building: 'Hauptstraße 52, 1st floor' }, '106', '1st floor'],
    ['old-building', { room: '106 Haus zum Riesen (10)', building: '106 Haus zum Riesen (10)' }, '106'],
    ['explicit-other', { room: '106 Haus zum Riesen (10)', building: 'Test Building' }, '106 Haus zum Riesen (10)'],
    ['unrelated', { room: '106 Haus zum Riesenberg (10)' }, '106 Haus zum Riesenberg (10)'],
  ].map(([id, week, expectedRoom, expectedFloor = null]) => {
    const course = sample(semester, `Riesen location check ${id}`);
    return { ...course, id: `riesen-${id}`, weeks: [{ ...course.weeks[0], building: null, ...week }], expectedRoom, expectedFloor };
  });
}

function ludwigshafenSamples(semester) {
  const raw = 'BG Ludwigshafen, SR 1+2, Turm 1, 9.OG';
  return [
    ['raw', { room: raw }, 'SR 1+2, Turm 1', '9th floor'],
    ['formatted', { room: ' bg  ludwigshafen , SR 1+2 , Turm 1 , 9. og ' }, 'SR 1+2, Turm 1', '9th floor'],
    ['other-room', { room: 'BG Ludwigshafen, SR 3, Turm 2, 21.OG' }, 'SR 3, Turm 2', '21st floor'],
    ['ground', { room: 'BG Ludwigshafen, SR 4, 0.OG' }, 'SR 4', 'Ground floor'],
    ['without-floor', { room: 'BG Ludwigshafen, SR 1+2, Turm 1' }, 'SR 1+2, Turm 1', null],
    ['location', { room: null, location: raw }, 'SR 1+2, Turm 1', '9th floor'],
    ['known-building', { room: raw, building: 'Ludwig-Guttmann-Straße 13' }, 'SR 1+2, Turm 1', '9th floor'],
    ['hospital-alias', { room: raw, building: 'BG Ludwigshafen' }, 'SR 1+2, Turm 1', '9th floor'],
    ['old-building', { room: raw, building: raw }, 'SR 1+2, Turm 1', '9th floor'],
    ['explicit-other', { room: raw, building: 'Test Building' }, raw, null, 'Test Building'],
    ['unrelated', { room: 'BG Ludwigshafen-West, SR 1', building: 'Test Building' },
      'BG Ludwigshafen-West, SR 1', null, 'Test Building'],
  ].map(([id, week, room, floor_label, building_name = 'Ludwig-Guttmann-Straße 13']) => {
    const course = sample(semester, `Ludwigshafen location check ${id}`);
    return { ...course, id: `ludwigshafen-${id}`, weeks: [{ ...course.weeks[0], building: null, ...week }],
      expected: { building_name, room, floor_label } };
  });
}

function roomCodeSamples(semester) {
  const address = 'Albert-Ueberle-Straße 3-5';
  return [
    ['raw', { room: '8020.01.160' }, address, 'Seminarraum (8020.01.160)', '1st floor'],
    ['existing', { room: '8020.02.210' }, address, 'SR I (8020.02.210)', '2nd floor'],
    ['new-room', { room: '8020.04.007' }, address, '8020.04.007', '4th floor'],
    ['ground', { room: '8020.00.003' }, address, '8020.00.003', 'Ground floor'],
    ['location', { room: null, location: '8020.01.160' }, address, 'Seminarraum (8020.01.160)', '1st floor'],
    ['formatted', { room: ' 8020.02.210 ' }, address, 'SR I (8020.02.210)', '2nd floor'],
    ['explicit', { room: '8020.02.210', building: 'Albert-Ueberle-Str. 3-5' }, address, 'SR I (8020.02.210)', '2nd floor'],
    ['old-building', { room: '8020.01.160', building: '8020.01.160' }, address, 'Seminarraum (8020.01.160)', '1st floor'],
    ['explicit-other', { room: '8020.02.210', building: 'Test Building' }, 'Test Building', '8020.02.210', null],
    ['ground-seed', { room: '8022.01.006' }, 'Albert-Ueberle-Straße 7', '8022.01.006', '1st floor'],
    ['ground-existing', { room: '8022.00.005' }, 'Albert-Ueberle-Straße 7', 'Hörsaal (8022.EG.005)', 'Ground floor'],
    ['bare-room', { room: '8111.01.160' }, 'Numbered Room Building', '160', '1st floor'],
    ['unknown', { room: '9999.01.002' }, '9999.01.002', '9999.01.002', null],
    ['malformed', { room: '8020.1.160' }, '8020.1.160', '8020.1.160', null],
    ['ambiguous', { room: '8999.03.303' }, '8999.03.303', '8999.03.303', null],
    ['ambiguous-exact', { room: '8999.01.101' }, 'Shared Code Building A', 'Room A (8999.01.101)', '1st floor'],
  ].map(([id, week, building_name, room, floor_label]) => {
    const course = sample(semester, `Room code check ${id}`);
    return { ...course, id: `room-code-${id}`, weeks: [{ ...course.weeks[0], building: null, ...week }],
      expected: { building_name, room, floor_label } };
  });
}

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
  writeJson(path.join(temporary, 'org-name-map.json'), organisationMap);
  writeJson(path.join(temporary, 'note-location-map.json'), locationMap);
  writeJson(path.join(temporary, 'building-catalog.json'), {
    campuses: [{ id: 'altstadt', name: 'Altstadt' }, { id: 'other', name: 'Other' },
      { id: 'mannheim-and-ludwigshafen', name: 'Mannheim & Ludwigshafen' }],
    buildings: [
      { id: 'test-building', street: 'Test Building', campusId: 'altstadt', aliases: [], floors: [],
        rooms: [{ id: 'test-room', name: 'Room 1', floors: [], features: {} }] },
      { id: 'old-location-fallback', street: 'Plöck 79 - 81', campusId: 'other', floors: [],
        aliases: ['Old Location Alias'],
        rooms: [{ id: 'old-location-room', name: 'ZLS, Plöck 79 - 81', floors: [], features: {} }] },
      { id: 'language-centre', street: 'Plöck 79-81', campusId: 'altstadt', floors: [], rooms: [],
        aliases: ['ZLS, Plöck 79 - 81', 'Language Centre, Main Site'] },
      { id: 'riesen', street: 'Hauptstraße 52', campusId: 'altstadt', floors: [],
        aliases: ['Haus zum Riesen'],
        rooms: [{ id: 'riesen-106', name: '106', floors: [], features: { hasAirConditioning: true } }] },
      { id: 'old-riesen', street: '106 Haus zum Riesen (10)', campusId: 'other', floors: [],
        rooms: [{ id: 'old-riesen-106', name: '106 Haus zum Riesen (10)', floors: [], features: {} }] },
      { id: 'ludwigshafen', street: 'Ludwig-Guttmann-Straße 13', campusId: 'mannheim-and-ludwigshafen',
        aliases: [], floors: [], rooms: [] },
      { id: 'old-tower', street: 'Turm 1', campusId: 'other', floors: ['9.OG'],
        rooms: [{ id: 'old-ludwigshafen-room', name: 'BG Ludwigshafen, SR 1+2, Turm 1, 9.OG',
          floors: ['9.OG'], features: { hasAirConditioning: true }, notes: 'Reviewed room details' }] },
      { id: 'mixed-tower', street: 'Turm 2', campusId: 'other', floors: [],
        rooms: [{ id: 'old-ludwigshafen-room-2', name: 'BG Ludwigshafen, SR 3, Turm 2, 21.OG',
          floors: ['21.OG'], features: {} },
        { id: 'unrelated-tower-room', name: 'Unrelated Room', floors: [], features: {} }] },
      { id: 'albert', street: 'Albert-Ueberle-Straße 3-5', campusId: 'altstadt', floors: ['2nd floor'],
        aliases: ['Albert-Ueberle-Str. 3-5'], rooms: [
          { id: 'albert-160', name: 'Seminarraum (8020.01.160)', floors: [], features: { hasProjector: true }, notes: 'Reviewed room' },
          { id: 'albert-210', name: 'SR I (8020.02.210)', floors: ['2nd floor'], features: {} },
        ] },
      { id: 'old-albert-code', street: '8020.01.160', campusId: 'other', floors: [],
        rooms: [{ id: 'old-albert-code-room', name: '8020.01.160', floors: [], features: { hasAirConditioning: true },
          notes: 'Auto-generated fallback from unparsed location. Needs manual review.' }] },
      { id: 'albert-7', street: 'Albert-Ueberle-Straße 7', campusId: 'altstadt', floors: [],
        rooms: [{ id: 'albert-7-seed', name: 'Hörsaal (8022.EG.005)', floors: ['Ground floor'], features: {} }] },
      { id: 'numbered-room-building', street: 'Numbered Room Building', campusId: 'altstadt', floors: [], rooms: [
        { id: 'numbered-seed', name: 'Room (8111.02.200)', floors: ['2nd floor'], features: {} },
        { id: 'numbered-room-160', name: '160', floors: ['1st floor'], features: { hasAccessControl: true } },
      ] },
      { id: 'shared-code-a', street: 'Shared Code Building A', campusId: 'altstadt', floors: [],
        rooms: [{ id: 'shared-room-a', name: 'Room A (8999.01.101)', floors: [], features: {} }] },
      { id: 'shared-code-b', street: 'Shared Code Building B', campusId: 'altstadt', floors: [],
        rooms: [{ id: 'shared-room-b', name: 'Room B (8999.02.202)', floors: [], features: {} }] },
    ],
  });
  for (const semester of ['2026SS', '2026WS']) {
    const paths = pathsFor(semester);
    writeJson(path.join(paths.courseDir, 'course-shared.json'), sample(semester));
    for (const course of mappingSamples(semester)) {
      writeJson(path.join(paths.courseDir, `course-${course.id}.json`), course);
    }
    for (const course of buildingAliasSamples(semester)) {
      writeJson(path.join(paths.courseDir, `course-${course.id}.json`), course);
    }
    for (const course of riesenSamples(semester)) {
      writeJson(path.join(paths.courseDir, `course-${course.id}.json`), course);
    }
    for (const course of ludwigshafenSamples(semester)) {
      writeJson(path.join(paths.courseDir, `course-${course.id}.json`), course);
    }
    for (const course of roomCodeSamples(semester)) {
      writeJson(path.join(paths.courseDir, `course-${course.id}.json`), course);
    }
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

test('shared location and organisation maps apply to full builds of both semesters', () => {
  for (const semester of ['2026SS', '2026WS']) {
    const db = new Database(pathsFor(semester).dbPath, { readonly: true });
    try {
      const occurrence = id => db.prepare('SELECT room, building_name FROM occurrences WHERE course_id = ?').get(`mapping-${id}`);
      for (const id of ['note-en', 'location-de', 'info-abbrev']) {
        assert.deepEqual(occurrence(id), { room: 'Mapped Room', building_name: 'Mapped Building' });
      }
      for (const id of ['missing-org', 'unrelated-org', 'short-substring']) {
        assert.notEqual(occurrence(id).building_name, 'Mapped Building');
      }
      assert.deepEqual(occurrence('open'), { room: 'Open Room', building_name: 'Mapped Building' });
      assert.deepEqual(occurrence('short-abbrev'), { room: 'Institute Room', building_name: 'Mapped Building' });
      assert.deepEqual(occurrence('explicit'), { room: 'Room 1', building_name: 'Test Building' });
    } finally { db.close(); }
  }
});

test('building aliases resolve complete locations, formatting and floors in both semesters', async () => {
  for (const semester of ['2026SS', '2026WS']) {
    const db = new Database(pathsFor(semester).dbPath, { readonly: true });
    try {
      for (const course of buildingAliasSamples(semester)) {
        const actual = db.prepare('SELECT building_name, room, floor_label FROM occurrences WHERE course_id = ?').get(course.id);
        if (course.id.endsWith('unrelated')) {
          assert.notEqual(actual.building_name, 'Plöck 79-81');
        } else {
          const expectedBuilding = course.id.endsWith('explicit-building') ? 'Test Building' : 'Plöck 79-81';
          assert.deepEqual(actual, { building_name: expectedBuilding, room: course.weeks[0].room.trim(),
            floor_label: course.expectedFloor });
        }
      }
      assert.deepEqual(db.prepare("SELECT name, campus_id FROM buildings_meta WHERE name LIKE 'Plöck 79%'").all(),
        [{ name: 'Plöck 79-81', campus_id: 'altstadt' }]);
    } finally { db.close(); }
    const date = semester === '2026SS' ? '2026-04-06' : '2026-10-05';
    const result = await request(`/api/schedule?date=${date}`);
    const building = result.data.buildings.find(item => item.id === 'Plöck 79-81');
    assert.equal(building.campus, 'Altstadt');
    const ids = result.data.rooms['Plöck 79-81'].flatMap(room => room.courses.map(course => course.id));
    assert.ok(ids.includes('building-alias-raw'));
    assert.ok(!ids.includes('building-alias-explicit-building'));
  }
  const catalog = JSON.parse(fs.readFileSync(path.join(temporary, 'building-catalog.json'), 'utf8'));
  const building = catalog.buildings.find(item => item.street === 'Plöck 79-81');
  assert.ok(building.aliases.includes('Old Location Alias'));
  assert.ok(building.aliases.includes('Plöck 79 - 81'));
  assert.ok(building.rooms.some(room => room.name === 'ZLS, Plöck 79 - 81'));
  for (const name of ['Plöck 79 - 81', 'Main Site', 'ZLS']) {
    assert.ok(!catalog.buildings.some(item => item.street === name));
  }
});

test('single-course updates apply building aliases and preserve explicit buildings', () => {
  for (const semester of ['2026SS', '2026WS']) {
    for (const course of buildingAliasSamples(semester).filter(item => !item.id.endsWith('unrelated'))) {
      withPaths(pathsFor(semester), () => syncSingleCourse(course.id));
      const db = new Database(pathsFor(semester).dbPath, { readonly: true });
      try {
        const actual = db.prepare('SELECT building_name, floor_label FROM occurrences WHERE course_id = ?').get(course.id);
        assert.deepEqual(actual, {
          building_name: course.id.endsWith('explicit-building') ? 'Test Building' : 'Plöck 79-81',
          floor_label: course.expectedFloor,
        });
      } finally { db.close(); }
    }
  }
});

test('Haus zum Riesen locations use Hauptstraße 52 and numeric room names in every semester', async () => {
  for (const semester of ['2026SS', '2026WS']) {
    const db = new Database(pathsFor(semester).dbPath, { readonly: true });
    try {
      for (const course of riesenSamples(semester)) {
        const actual = db.prepare('SELECT building_name, room, floor_label FROM occurrences WHERE course_id = ?').get(course.id);
        const expectedBuilding = course.id.endsWith('explicit-other') ? 'Test Building'
          : course.id.endsWith('unrelated') ? course.expectedRoom : 'Hauptstraße 52';
        assert.deepEqual(actual, { building_name: expectedBuilding, room: course.expectedRoom, floor_label: course.expectedFloor });
      }
      assert.equal(db.prepare("SELECT count(*) AS n FROM buildings_meta WHERE name='106 Haus zum Riesen (10)'").get().n, 0);
      assert.equal(db.prepare("SELECT count(*) AS n FROM rooms_meta r JOIN buildings_meta b ON b.id=r.building_id WHERE b.name='Hauptstraße 52' AND r.name='106'").get().n, 1);
    } finally { db.close(); }
    const date = semester === '2026SS' ? '2026-04-06' : '2026-10-05';
    const { data } = await request(`/api/schedule?date=${date}`);
    assert.equal(data.buildings.find(building => building.id === 'Hauptstraße 52').campus, 'Altstadt');
    const rooms = data.rooms['Hauptstraße 52'];
    for (const room of ['106', '204', '002', '205', '210']) assert.ok(rooms.some(item => item.room === room));
    assert.ok(rooms.find(room => room.room === '106').features.hasAirConditioning);
    assert.ok(!rooms.some(room => /Haus zum Riesen/.test(room.room)));
    const source = JSON.parse(fs.readFileSync(path.join(pathsFor(semester).courseDir, 'course-riesen-106.json')));
    assert.equal(source.weeks[0].room, '106 Haus zum Riesen (10)');
  }
});

test('single-course sync applies the same Haus zum Riesen rule', () => {
  for (const semester of ['2026SS', '2026WS']) {
    for (const course of riesenSamples(semester)) {
      withPaths(pathsFor(semester), () => syncSingleCourse(course.id));
      const db = new Database(pathsFor(semester).dbPath, { readonly: true });
      try {
        const actual = db.prepare('SELECT building_name, room, floor_label FROM occurrences WHERE course_id = ?').get(course.id);
        const expectedBuilding = course.id.endsWith('explicit-other') ? 'Test Building'
          : course.id.endsWith('unrelated') ? course.expectedRoom : 'Hauptstraße 52';
        assert.deepEqual(actual, { building_name: expectedBuilding, room: course.expectedRoom, floor_label: course.expectedFloor });
      } finally { db.close(); }
    }
  }
});

test('BG Ludwigshafen locations split building, room and floor without overrides in both semesters', async () => {
  for (const semester of ['2026SS', '2026WS']) {
    const db = new Database(pathsFor(semester).dbPath, { readonly: true });
    try {
      for (const course of ludwigshafenSamples(semester)) {
        assert.deepEqual(db.prepare('SELECT building_name, room, floor_label FROM occurrences WHERE course_id = ?')
          .get(course.id), course.expected);
        assert.ok(!fs.existsSync(path.join(pathsFor(semester).overridesDir, `course-${course.id}.json`)));
      }
      assert.equal(db.prepare("SELECT count(*) AS n FROM buildings_meta WHERE name='Turm 1'").get().n, 0);
      assert.equal(db.prepare("SELECT count(*) AS n FROM rooms_meta WHERE name LIKE 'BG Ludwigshafen,%'").get().n, 0);
      assert.equal(db.prepare("SELECT notes FROM rooms_meta WHERE id='old-ludwigshafen-room'").get().notes, 'Reviewed room details');
      assert.equal(db.prepare("SELECT count(*) AS n FROM rooms_meta r JOIN buildings_meta b ON b.id=r.building_id WHERE b.name='Turm 2' AND r.name='Unrelated Room'").get().n, 1);
    } finally { db.close(); }
    const date = semester === '2026SS' ? '2026-04-06' : '2026-10-05';
    const { data } = await request(`/api/schedule?date=${date}`);
    assert.equal(data.buildings.find(building => building.id === 'Ludwig-Guttmann-Straße 13').campus,
      'Mannheim & Ludwigshafen');
    const room = data.rooms['Ludwig-Guttmann-Straße 13'].find(item => item.room === 'SR 1+2, Turm 1');
    assert.ok(room.features.hasAirConditioning);
    assert.ok(room.courses.some(course => course.id === 'ludwigshafen-raw'));
    const source = JSON.parse(fs.readFileSync(path.join(pathsFor(semester).courseDir, 'course-ludwigshafen-raw.json')));
    assert.equal(source.weeks[0].room, 'BG Ludwigshafen, SR 1+2, Turm 1, 9.OG');
  }
});

test('single-course sync also splits BG Ludwigshafen locations', () => {
  for (const semester of ['2026SS', '2026WS']) {
    for (const course of ludwigshafenSamples(semester)) {
      withPaths(pathsFor(semester), () => syncSingleCourse(course.id));
      const db = new Database(pathsFor(semester).dbPath, { readonly: true });
      try {
        assert.deepEqual(db.prepare('SELECT building_name, room, floor_label FROM occurrences WHERE course_id = ?')
          .get(course.id), course.expected);
      } finally { db.close(); }
    }
  }
});

test('direct room codes reuse catalog rooms or add floors and rooms in both semesters', async () => {
  for (const semester of ['2026SS', '2026WS']) {
    const db = new Database(pathsFor(semester).dbPath, { readonly: true });
    try {
      for (const course of roomCodeSamples(semester)) {
        assert.deepEqual(db.prepare('SELECT building_name, room, floor_label FROM occurrences WHERE course_id = ?')
          .get(course.id), course.expected, course.id);
      }
      assert.equal(db.prepare("SELECT count(*) n FROM buildings_meta WHERE name='8020.01.160'").get().n, 0);
      assert.equal(db.prepare("SELECT count(*) n FROM rooms_meta WHERE building_id='albert' AND name LIKE '%8020.01.160%'").get().n, 1);
      assert.deepEqual(db.prepare("SELECT has_air_conditioning, has_projector, notes FROM rooms_meta WHERE id='albert-160'").get(),
        { has_air_conditioning: 1, has_projector: 1, notes: 'Reviewed room' });
      assert.equal(db.prepare("SELECT count(*) n FROM rooms_meta WHERE building_id='numbered-room-building' AND name='8111.01.160'").get().n, 0);
      assert.ok(JSON.parse(db.prepare("SELECT floors_json FROM buildings_meta WHERE id='albert'").get().floors_json).includes('4th floor'));
      assert.deepEqual(JSON.parse(db.prepare("SELECT floors_json FROM rooms_meta WHERE building_id='albert' AND name='8020.04.007'").get().floors_json), ['4th floor']);
    } finally { db.close(); }
    const date = semester === '2026SS' ? '2026-04-06' : '2026-10-05';
    const { data } = await request(`/api/schedule?date=${date}`);
    const rooms = data.rooms['Albert-Ueberle-Straße 3-5'];
    assert.ok(rooms.find(room => room.room === 'Seminarraum (8020.01.160)').courses.some(course => course.id === 'room-code-raw'));
    assert.ok(rooms.find(room => room.room === 'SR I (8020.02.210)').courses.some(course => course.id === 'room-code-existing'));
  }
});

test('single-course room code sync creates catalog and database metadata without duplicates', () => {
  for (const semester of ['2026SS', '2026WS']) {
    const paths = pathsFor(semester);
    for (const course of roomCodeSamples(semester)) {
      withPaths(paths, () => syncSingleCourse(course.id));
      const db = new Database(paths.dbPath, { readonly: true });
      try {
        assert.deepEqual(db.prepare('SELECT building_name, room, floor_label FROM occurrences WHERE course_id = ?')
          .get(course.id), course.expected, course.id);
      } finally { db.close(); }
    }
    const course = sample(semester, 'New coded room after full build');
    course.id = 'room-code-new-single';
    course.weeks = [{ ...course.weeks[0], building: null, room: '8020.05.999' }];
    const file = path.join(paths.courseDir, `course-${course.id}.json`);
    writeJson(file, course);
    const source = fs.readFileSync(file, 'utf8');
    withPaths(paths, () => syncSingleCourse(course.id));
    const firstCatalog = fs.readFileSync(path.join(temporary, 'building-catalog.json'), 'utf8');
    withPaths(paths, () => syncSingleCourse(course.id));
    assert.equal(fs.readFileSync(path.join(temporary, 'building-catalog.json'), 'utf8'), firstCatalog);
    assert.equal(fs.readFileSync(file, 'utf8'), source);
    const catalog = JSON.parse(firstCatalog);
    const building = catalog.buildings.find(building => building.id === 'albert');
    assert.equal(building.rooms.filter(room => room.name === '8020.05.999').length, 1);
    assert.ok(building.floors.includes('5th floor'));
    const db = new Database(paths.dbPath, { readonly: true });
    try {
      assert.deepEqual(db.prepare('SELECT building_name, room, floor_label FROM occurrences WHERE course_id=?').get(course.id),
        { building_name: 'Albert-Ueberle-Straße 3-5', room: '8020.05.999', floor_label: '5th floor' });
      assert.equal(db.prepare("SELECT count(*) n FROM rooms_meta WHERE building_id='albert' AND name='8020.05.999'").get().n, 1);
      assert.deepEqual(JSON.parse(db.prepare("SELECT floors_json FROM rooms_meta WHERE building_id='albert' AND name='8020.05.999'").get().floors_json), ['5th floor']);
    } finally { db.close(); }
  }
});

test('organisation searches use shared English, German and abbreviation variants in every semester', async () => {
  for (const semester of ['2026SS', '2026WS']) {
    for (const name of [organisationMap.mapping.en, organisationMap.mapping.de, 'FMA']) {
      const result = await request(`/api/search?semester=${semester}&q=${encodeURIComponent(name)}`);
      assert.equal(result.response.status, 200);
      const ids = result.data.map(item => item.course.id);
      for (const id of ['mapping-note-en', 'mapping-location-de', 'mapping-info-abbrev']) assert.ok(ids.includes(id));
      assert.ok(result.data.every(item => item.course.semester === semester));
    }
  }
});

test('shared organisation map edits refresh search without restarting the server', async () => {
  const updated = structuredClone(organisationMap);
  updated.mapping.synonyms.push('New Shared Organisation Alias');
  writeJson(path.join(temporary, 'org-name-map.json'), updated);
  try {
    for (const semester of ['2026SS', '2026WS']) {
      const result = await request(`/api/search?semester=${semester}&q=New%20Shared%20Organisation%20Alias`);
      assert.equal(result.response.status, 200);
      assert.ok(result.data.some(item => item.course.id === 'mapping-location-de'));
    }
  } finally { writeJson(path.join(temporary, 'org-name-map.json'), organisationMap); }
});

test('single-course updates reuse root mappings while remaining isolated by semester', async () => {
  const updated = structuredClone(locationMap);
  updated.entries[0].room = 'Updated Shared Room';
  writeJson(path.join(temporary, 'note-location-map.json'), updated);
  try {
    for (const semester of ['2026SS', '2026WS']) {
      const course = mappingSamples(semester).find(item => item.id === 'mapping-note-en');
      const result = await request(`/api/admin/course-file/${course.id}?semester=${semester}`, {
        method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(course),
      });
      assert.equal(result.response.status, 200);
      for (const target of ['2026SS', '2026WS']) {
        const db = new Database(pathsFor(target).dbPath, { readonly: true });
        try {
          const room = db.prepare('SELECT room FROM occurrences WHERE course_id = ?').get(course.id).room;
          assert.equal(room, target === '2026WS' && semester === '2026SS' ? 'Mapped Room' : 'Updated Shared Room');
        } finally { db.close(); }
      }
    }
  } finally { writeJson(path.join(temporary, 'note-location-map.json'), locationMap); }
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
