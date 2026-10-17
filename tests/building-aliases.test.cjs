const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createBuildingAliasMap, findBuildingAlias, findBuildingRoom } = require('../server/building-aliases.cjs');
const { parseDirectRoomCode, extractRoomCode } = require('../server/location-rules.cjs');

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

test('compact nine-digit room codes normalize to dotted room codes', () => {
  assert.deepEqual(parseDirectRoomCode('440002212'), {
    code: '4400.02.212', buildingCode: '4400', floorCode: '02',
    roomCode: '212', floorLabel: '2nd floor',
  });
  assert.equal(parseDirectRoomCode('Raum 440002212 (CATS)').code, '4400.02.212');
  assert.equal(extractRoomCode('Raum 440002212 (CATS)'), '4400.02.212');
});

test('compact room parsing rejects longer numbers and multiple distinct codes', () => {
  for (const value of ['44000221', '4400022120', '1440002212', '440002212.5', '440002212 / 440003009']) {
    assert.equal(parseDirectRoomCode(value), null, value);
  }
  assert.equal(parseDirectRoomCode('Room 440002212 (code 440002212)').code, '4400.02.212');
  assert.equal(parseDirectRoomCode('000100007').code, '0001.00.007');
});
