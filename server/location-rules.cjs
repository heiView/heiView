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
