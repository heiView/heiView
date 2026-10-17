const { normalizeBuildingKey } = require('./building-aliases.cjs');

function splitOgFloor(value) {
  const text = String(value || '').trim();
  const pattern = /(?<![\d.])(\d+)\s*\.\s*OG\b\.?/gi;
  const floors = [...text.matchAll(pattern)].map(match => Number(match[1]));
  // Conflicting floor markers cannot identify a single occurrence's floor.
  if (!floors.length || new Set(floors).size !== 1) return { room: text, floorLabel: null };
  const room = text.replace(pattern, ' ').split(',').map(part => part.replace(/\s+/g, ' ').trim())
    .filter(Boolean).join(', ');
  return { room, floorLabel: ordinalFloorLabel(floors[0]) };
}

const INF_440 = 'Im Neuenheimer Feld 440';
const INF_440_STATIONS = ['Station Geburtshilfe', 'Station Gynäkologie'];
const isInf440Station = value => /^Station\s+(?:Geburtshilfe|Gyn(?:ä|ae)kologie)$/i.test(value);
const isInf440Address = value => /^(?:INF\s*440|Im\s+Neuenheimer\s+Feld\s+440)$/i.test(value);

function parseInf440Station(room, location, building) {
  const fields = [room, location, building].map(splitOgFloor);
  const hasStation = fields.some(field => field.room.split(',').some(part => isInf440Station(part.trim())));
  const hasAddressWithFloor = fields.some(field => field.room.split(',').some(part => isInf440Address(part.trim())))
    && fields.some(field => field.floorLabel);
  if (!hasStation && !hasAddressWithFloor) return null;
  const remaining = fields.map(field => field.room.split(',').map(part => part.trim())
    .filter(part => part && !isInf440Station(part)
      && !isInf440Address(part)).join(', '));
  return { buildingName: INF_440, room: remaining.find(Boolean) || 'Unbekannter Raum',
    floorLabel: fields.find(field => field.floorLabel)?.floorLabel || null };
}

function ensureInf440StationRoom(catalog, parsed) {
  if (!parsed) return null;
  let changed = false;
  const ids = new Set((catalog.buildings || []).flatMap(building =>
    [building.id, ...(building.rooms || []).map(room => room.id)]));
  const uniqueId = base => {
    let id = base;
    for (let suffix = 2; ids.has(id); suffix++) id = `${base}-${suffix}`;
    ids.add(id);
    return id;
  };
  let building = catalog.buildings.find(item => normalizeBuildingKey(item.street) === normalizeBuildingKey(INF_440));
  if (!building) {
    building = { id: uniqueId('bld-im-neuenheimer-feld-440'), street: INF_440,
      displayName: 'INF 440', campusId: 'im-neuenheimer-feld', aliases: [], floors: [], rooms: [] };
    catalog.buildings.push(building);
    changed = true;
  }
  if (building.campusId !== 'im-neuenheimer-feld') {
    building.campusId = 'im-neuenheimer-feld';
    changed = true;
  }
  if (!Array.isArray(building.aliases)) building.aliases = [];
  for (const alias of ['INF 440', ...INF_440_STATIONS]) {
    if (!building.aliases.some(name => normalizeBuildingKey(name) === normalizeBuildingKey(alias))) {
      building.aliases.push(alias);
      changed = true;
    }
  }
  if (!Array.isArray(building.rooms)) building.rooms = [];
  const key = normalizeBuildingKey(parsed.room);
  let room = building.rooms.find(item => [item.name, item.displayName]
    .some(name => name && normalizeBuildingKey(name) === key));
  if (!room) {
    const slug = parsed.room.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    room = { id: uniqueId(`${building.id}::rm-${slug || 'unbekannt'}`), name: parsed.room,
      floors: [], features: {}, notes: '' };
    building.rooms.push(room);
    changed = true;
  }
  if (!room.features) room.features = {};
  for (const item of [building, room]) {
    if (!Array.isArray(item.floors)) item.floors = [];
    if (parsed.floorLabel && !item.floors.includes(parsed.floorLabel)) {
      item.floors.push(parsed.floorLabel);
      changed = true;
    }
  }
  return { building, room, changed };
}

// The number in parentheses is source metadata, not part of the room name.
// Keep the leading room number as a string so rooms such as "002" retain zeros.
function parseHausZumRiesen(value) {
  const match = String(value || '').trim().match(/^(\d+)\s+Haus\s+zum\s+Riesen(?:\s*\([^)]*\))?$/i);
  if (!match) return null;
  return { buildingName: 'Hauptstraße 52', room: match[1], floorLabel: null };
}

function parseBgLudwigshafen(value) {
  const match = String(value || '').trim().match(/^BG\s+Ludwigshafen\s*,\s*(.+)$/i);
  if (!match) return null;
  const parts = match[1].split(',').map(part => part.trim().replace(/\s+/g, ' '));
  if (parts.some(part => !part)) return null;

  const floor = parts[parts.length - 1].match(/^(\d+)\s*\.?\s*og\.?$/i);
  let floorLabel = null;
  if (floor) {
    floorLabel = ordinalFloorLabel(Number(floor[1]));
    parts.pop();
  }
  if (!parts.length) return null;
  return { buildingName: 'Ludwig-Guttmann-Straße 13', room: parts.join(', '), floorLabel };
}

function ordinalFloorLabel(value) {
  const number = Number(value);
  if (!Number.isInteger(number)) return null;
  if (number === 0) return 'Ground floor';
  const suffix = number % 100 >= 11 && number % 100 <= 13 ? 'th'
    : ({ 1: 'st', 2: 'nd', 3: 'rd' }[number % 10] || 'th');
  return `${number}${suffix} floor`;
}

function parseDirectRoomCode(value) {
  const text = String(value || '').trim();
  let match = text.match(/^(\d{4})\.(\d{2})\.(\d{3})$/);
  if (!match) {
    // Compact codes use the same 4/2/3 parts. Ignore longer numbers and do not
    // choose arbitrarily when a location names more than one room code.
    const compact = [...text.matchAll(/(?<![\d.])(\d{4})(\d{2})(\d{3})(?![\d.])/g)];
    if (new Set(compact.map(item => item[0])).size !== 1) return null;
    match = compact[0];
  }
  if (!match) return null;
  return {
    code: `${match[1]}.${match[2]}.${match[3]}`,
    buildingCode: match[1],
    floorCode: match[2],
    roomCode: match[3],
    floorLabel: ordinalFloorLabel(Number(match[2])),
  };
}

function parseLocationRoomCode(room, location) {
  return parseDirectRoomCode(room) || parseDirectRoomCode(location);
}

function extractRoomCode(value) {
  const match = String(value || '').match(/(?<![a-z0-9])(\d{4})\.(\d{2}|EG|U\d)\.(\d{3}[a-z]?)(?![a-z0-9])/i);
  return match ? match[0] : parseDirectRoomCode(value)?.code || null;
}

function createRoomCodeIndex(buildings) {
  const byCode = new Map();
  const byBuildingCode = new Map();
  const ids = new Set();
  for (const building of buildings || []) {
    ids.add(building.id);
    for (const room of building.rooms || []) ids.add(room.id);
  }
  for (const building of buildings || []) {
    // Auto-generated Other entries must not become evidence for an address.
    if (building.campusId === 'other') continue;
    for (const room of building.rooms || []) {
      const code = extractRoomCode(room.name);
      if (!code) continue;
      const key = code.toUpperCase().replace('.EG.', '.00.');
      const matches = byCode.get(key) || [];
      matches.push({ building, room });
      byCode.set(key, matches);
      const buildingCode = code.slice(0, 4);
      const candidates = byBuildingCode.get(buildingCode) || new Set();
      candidates.add(building);
      byBuildingCode.set(buildingCode, candidates);
    }
  }
  return { byCode, byBuildingCode, ids };
}

function resolveRoomCode(index, parsedCode) {
  if (!parsedCode) return null;
  const exact = index.byCode.get(parsedCode.code) || [];
  if (exact.length) {
    if (new Set(exact.map(item => item.building)).size !== 1) return null;
    // Prefer a descriptive catalog name over a duplicate bare code.
    return exact.find(item => ![parsedCode.code, parsedCode.code.replace(/\./g, '')].includes(item.room.name.trim())) || exact[0];
  }
  const candidates = [...(index.byBuildingCode.get(parsedCode.buildingCode) || [])];
  if (candidates.length !== 1) return null;
  const building = candidates[0];
  const room = (building.rooms || []).find(item => item.name === parsedCode.roomCode
    && (item.floors || []).includes(parsedCode.floorLabel)) || null;
  return { building, room };
}

function ensureRoomCodeRoom(index, parsedCode) {
  const match = resolveRoomCode(index, parsedCode);
  if (!match) return null;
  const { building } = match;
  let { room } = match;
  let changed = false;
  if (!room) {
    const baseId = `${building.id}::rm-${parsedCode.code.replace(/\./g, '-')}`;
    let id = baseId;
    for (let suffix = 2; index.ids.has(id); suffix++) id = `${baseId}-${suffix}`;
    index.ids.add(id);
    room = { id,
      name: parsedCode.code, floors: [], features: {}, notes: '' };
    building.rooms.push(room);
    index.byCode.set(parsedCode.code, [{ building, room }]);
    changed = true;
  }
  for (const item of [building, room]) {
    if (!Array.isArray(item.floors)) item.floors = [];
    if (!item.floors.includes(parsedCode.floorLabel)) {
      item.floors.push(parsedCode.floorLabel);
      changed = true;
    }
  }
  return { building, room, changed };
}

module.exports = {
  splitOgFloor,
  parseInf440Station,
  ensureInf440StationRoom,
  parseHausZumRiesen,
  parseBgLudwigshafen,
  ordinalFloorLabel,
  parseDirectRoomCode,
  parseLocationRoomCode,
  extractRoomCode,
  createRoomCodeIndex,
  resolveRoomCode,
  ensureRoomCodeRoom,
};
