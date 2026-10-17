const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createBuildingAliasMap, findBuildingAlias, findBuildingRoom, findOrganisationBuildingRoom } = require('../server/building-aliases.cjs');
const { parseDirectRoomCode, extractRoomCode, splitOgFloor, parseInf440Station,
  ensureInf440StationRoom } = require('../server/location-rules.cjs');

test('reviewed aliases take priority over Other streets regardless of catalog order', () => {
  const museum = { street: 'Hauptstraße 235', campusId: 'altstadt',
    aliases: ['Hauptstr. 235', 'Völkerkundemuseum', 'Hauptstr. 235 / Völkerkundemuseum'] };
  const fallback = { street: 'Hauptstr. 235 / Völkerkundemuseum', campusId: 'other' };
  for (const buildings of [[museum, fallback], [fallback, museum]]) {
    const aliases = createBuildingAliasMap(buildings);
    for (const name of [museum.street, ...museum.aliases, '  Hauptstr. 235 /  Völkerkundemuseum ']) {
      assert.equal(findBuildingAlias(name, aliases), museum.street);
    }
    assert.equal(findBuildingAlias('Unrelated Museum', aliases), null);
  }
});

test('formal buildings win room matching over Other fallbacks', () => {
  const formal = { street: 'Known Building', campusId: 'altstadt', rooms: [{ name: 'Room 12' }] };
  const fallback = { street: 'Unknown Location', campusId: 'other', rooms: [{ name: 'Room 12' }] };
  assert.equal(findBuildingRoom([fallback, formal], 'Room 12').building.street, 'Known Building');
  assert.equal(findBuildingRoom([formal, fallback], 'Room 12').building.street, 'Known Building');
  assert.equal(findBuildingRoom([formal], 'Room 12', 'Known Building'), null);
});

test('organisation names and aliases disambiguate existing rooms only within matching known buildings', () => {
  const room = { name: 'Seminarraum 2', displayName: 'Seminar Room Two' };
  const school = { street: 'Landfriedstraße 12', displayName: 'Hochschule für Jüdische Studien Heidelberg',
    campusId: 'heidelberg', aliases: ['HfJS'], rooms: [room, { name: 'Seminarraum 3' }] };
  const otherSchool = { street: 'Different School', campusId: 'altstadt', rooms: [{ name: 'Seminarraum 2' }] };
  const fallback = { street: 'Seminarraum 2', displayName: school.displayName, campusId: 'other', rooms: [room] };
  const buildings = [fallback, otherSchool, school];
  const match = (org, rooms, preferred) => findOrganisationBuildingRoom(buildings, org, rooms, preferred);
  assert.equal(findBuildingRoom(buildings, room.name), null);
  for (const org of [school.street, school.displayName, ' hfjs ']) {
    for (const rooms of [[room.name], ['Unhelpful room', '  seminarraum   2 '], ['Seminar Room Two']]) {
      assert.deepEqual(match(org, rooms, fallback.street), { building: school, room });
    }
  }
  for (const org of [null, '', 'Unrelated School', `${school.displayName} annex`, 'prefix HfJS suffix']) {
    assert.equal(match(org, [room.name]), null);
  }
  assert.equal(match('HfJS', ['Seminarraum 99']), null);
  assert.equal(match('HfJS', [room.name, 'Seminarraum 3']), null);
  assert.equal(match('HfJS', [room.name], otherSchool.street), null);
  assert.equal(match('HfJS', [room.name], school.street), null);
  // Display names are institution hints, not canonical assignments from the
  // location alias map; an Other entry with that label must still be resolved.
  assert.deepEqual(match('HfJS', [room.name], school.displayName), { building: school, room });
  const sharedOrganisation = { ...otherSchool, aliases: ['HfJS'] };
  assert.equal(findOrganisationBuildingRoom([school, sharedOrganisation], 'HfJS', [room.name]), null);
  const duplicateRoomLabel = { ...school, rooms: [room, { name: 'Another Room', displayName: room.name }] };
  assert.equal(findOrganisationBuildingRoom([duplicateRoomLabel], 'HfJS', [room.name]), null);
  const hcch = { street: 'Marstallstraße. 6', displayName: 'Marstallstraße. 6', campusId: 'altstadt',
    aliases: ['HCCH', 'Heidelberg Center for Cultural Heritage'],
    rooms: [{ name: 'Hörsaal 413 (HS 413)' }] };
  assert.deepEqual(findOrganisationBuildingRoom([hcch], 'Heidelberg Center for Cultural Heritage', ['HS 413']), {
    building: hcch, room: hcch.rooms[0],
  });
  assert.deepEqual(findOrganisationBuildingRoom([hcch], 'HCCH', ['HS 413']), {
    building: hcch, room: hcch.rooms[0],
  });
  const orgLookup = new Map([['heidelberg zentrum kulturelles erbe (hcch)',
    new Set(['heidelberg center for cultural heritage', 'hcch'])]]);
  assert.deepEqual(findOrganisationBuildingRoom([hcch], 'Heidelberg Zentrum kulturelles Erbe (HCCH)',
    ['HS 413'], null, orgLookup), {
    building: hcch, room: hcch.rooms[0],
  });
  assert.equal(findOrganisationBuildingRoom([hcch], 'Heidelberg Center for Cultural Heritage', ['HS 41']), null);
});

test('compact nine-digit room codes normalize to dotted room codes', () => {
  assert.deepEqual(parseDirectRoomCode('440002212'), {
    code: '4400.02.212', buildingCode: '4400', floorCode: '02',
    roomCode: '212', floorLabel: '2nd floor',
  });
  assert.equal(parseDirectRoomCode('Raum 440002212 (CATS)').code, '4400.02.212');
  assert.equal(extractRoomCode('Raum 440002212 (CATS)'), '4400.02.212');
});

test('institution-scoped partial room matches require complete tokens and a unique result', () => {
  const room = { name: 'Hörsaal 413 (HS 413)' };
  const building = { street: 'Marstallstraße. 6', campusId: 'altstadt', aliases: ['HCCH'], rooms: [room] };
  const match = (names, buildings = [building], organisation = 'HCCH', preferred = null) =>
    findOrganisationBuildingRoom(buildings, organisation, names, preferred);
  for (const value of ['HS 413', '  hs   413 ', 'Hörsaal 413']) {
    assert.deepEqual(match([value]), { building, room });
  }
  for (const value of ['HS 41', 'HS 4130', 'HS', '413', 'Hörsaal 41']) assert.equal(match([value]), null);
  assert.equal(match(['HS 413'], [building], null), null);
  assert.equal(match(['HS 413'], [building], 'Unrelated Institute'), null);
  assert.equal(match(['HS 413'], [building], 'HCCH', building.street), null);
  const ambiguous = { ...building, rooms: [room, { name: 'Seminar Room (HS 413)' }] };
  assert.equal(match(['HS 413'], [ambiguous]), null);
  const exact = { name: 'HS 413' };
  const withExact = { ...building, rooms: [room, exact] };
  assert.deepEqual(match(['HS 413'], [withExact]), { building: withExact, room: exact });
  const elsewhere = { street: 'Another Building', campusId: 'altstadt', rooms: [room] };
  assert.deepEqual(match(['HS 413'], [elsewhere, building]), { building, room });
});

test('compact room parsing rejects longer numbers and multiple distinct codes', () => {
  for (const value of ['44000221', '4400022120', '1440002212', '440002212.5', '440002212 / 440003009']) {
    assert.equal(parseDirectRoomCode(value), null, value);
  }
  assert.equal(parseDirectRoomCode('Room 440002212 (code 440002212)').code, '4400.02.212');
  assert.equal(parseDirectRoomCode('000100007').code, '0001.00.007');
});

test('OG floor markers are extracted from any part of a room description', () => {
  for (const [text, room, floorLabel] of [
    ['Wartebereich 2.OG', 'Wartebereich', '2nd floor'],
    ['Wartebereich, 3.OG', 'Wartebereich', '3rd floor'],
    [' 21. og , Wartebereich ', 'Wartebereich', '21st floor'],
    ['Wartebereich 0.OG', 'Wartebereich', 'Ground floor'],
    ['Room 202, 12.OG, West Wing', 'Room 202, West Wing', '12th floor'],
    ['9.OG', '', '9th floor'],
  ]) assert.deepEqual(splitOgFloor(text), { room, floorLabel });
  for (const text of ['8020.01.160', 'Biologie', 'Room 2.OGB', 'Room 2.OG / 3.OG']) {
    assert.deepEqual(splitOgFloor(text), { room: text, floorLabel: null });
  }
});

test('INF 440 station rules split building, room and floor across source fields', () => {
  for (const fields of [
    ['Wartebereich 2.OG, Station Geburtshilfe'],
    ['Wartebereich 2.OG', null, 'Station Geburtshilfe'],
    [null, 'Station Geburtshilfe, Wartebereich 2.OG'],
    ['Wartebereich', 'Wartebereich 2.OG, Station Geburtshilfe'],
    ['Wartebereich 2.OG, Station Geburtshilfe, INF 440'],
  ]) assert.deepEqual(parseInf440Station(...fields), {
    buildingName: 'Im Neuenheimer Feld 440', room: 'Wartebereich', floorLabel: '2nd floor',
  });
  assert.deepEqual(parseInf440Station('  wartebereich  3. og , station gynäkologie '), {
    buildingName: 'Im Neuenheimer Feld 440', room: 'wartebereich', floorLabel: '3rd floor',
  });
  assert.equal(parseInf440Station('Wartebereich 2.OG, Station Geburtshilfe-West'), null);
  assert.equal(parseInf440Station('Wartebereich 3.OG, Unrelated Station'), null);
  assert.equal(parseInf440Station('Room 1', null, 'INF 440'), null);
  assert.deepEqual(parseInf440Station('Wartebereich 2.OG', null, 'INF 440'), {
    buildingName: 'Im Neuenheimer Feld 440', room: 'Wartebereich', floorLabel: '2nd floor',
  });
});

test('INF 440 room registration reuses names and display names and adds missing rooms and floors once', () => {
  const existing = { id: 'reviewed', name: 'Waiting Area', displayName: 'Wartebereich',
    floors: ['2nd floor'], features: { hasProjector: true }, notes: 'Reviewed room' };
  const building = { id: 'inf-440', street: 'Im Neuenheimer Feld 440', campusId: 'im-neuenheimer-feld',
    aliases: ['INF 440'], floors: ['2nd floor'], rooms: [existing] };
  const catalog = { buildings: [building] };
  const parsed = parseInf440Station('Wartebereich 3.OG, Station Gynäkologie');
  const result = ensureInf440StationRoom(catalog, parsed);
  assert.equal(result.room, existing);
  assert.equal(existing.id, 'reviewed');
  assert.equal(existing.features.hasProjector, true);
  assert.equal(existing.notes, 'Reviewed room');
  assert.deepEqual(existing.floors, ['2nd floor', '3rd floor']);
  assert.ok(building.aliases.includes('Station Gynäkologie'));
  assert.equal(ensureInf440StationRoom(catalog, parsed).changed, false);
  const added = parseInf440Station('Besprechung 11.OG, Station Geburtshilfe');
  ensureInf440StationRoom(catalog, added);
  ensureInf440StationRoom(catalog, added);
  assert.equal(building.rooms.filter(room => room.name === 'Besprechung').length, 1);
  assert.ok(building.floors.includes('11th floor'));
});
