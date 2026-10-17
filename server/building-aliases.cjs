function normalizeBuildingKey(value) {
  return String(value || '')
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/\s*[-–—]\s*/g, '-')
    .replace(/\s*\/\s*/g, '/')
    .replace(/\s*,\s*/g, ', ');
}

function createBuildingAliasMap(buildings, { includeOther = true } = {}) {
  const aliases = new Map();
  // Reviewed campus assignments must win over automatically generated Other
  // buildings, even when a fallback's street is itself a reviewed alias.
  const reviewed = building => Boolean(building.campusId && building.campusId !== 'other');
  const ordered = [...buildings.filter(building => !reviewed(building)), ...buildings.filter(reviewed)];
  for (const building of ordered) {
    if (!includeOther && !reviewed(building)) continue;
    if (!building.street) continue;
    const names = [building.street, building.street.replace(/\//g, '-'), ...(building.aliases || [])];
    for (const name of names) {
      const key = normalizeBuildingKey(name);
      if (key) aliases.set(key, building.street);
    }
  }
  return aliases;
}

function isOtherBuilding(value, buildings, aliases) {
  const street = findBuildingAlias(value, aliases) || value;
  const key = normalizeBuildingKey(street);
  return Boolean(key) && (buildings || []).some(building =>
    building.campusId === 'other' && normalizeBuildingKey(building.street) === key);
}

function findBuildingAlias(value, aliases) {
  return aliases?.get(normalizeBuildingKey(value)) || null;
}

function findBuildingRoom(buildings, roomName, preferredBuildingName = null) {
  const roomKey = normalizeBuildingKey(roomName);
  if (!roomKey) return null;
  if (preferredBuildingName) {
    const preferredKey = normalizeBuildingKey(preferredBuildingName);
    const knownBuilding = (buildings || []).find(building =>
      normalizeBuildingKey(building.street) === preferredKey);
    if (knownBuilding && knownBuilding.campusId !== 'other') return null;
  }
  const candidates = [];
  for (const building of buildings || []) {
    if (!building || building.campusId === 'other') continue;
    for (const room of building.rooms || []) {
      const names = [room.name, room.displayName].filter(Boolean);
      if (names.some(name => normalizeBuildingKey(name) === roomKey)) {
        candidates.push({ building, room });
        break;
      }
    }
  }
  // Shared labels such as "Room 1" cannot identify a building on their own.
  return candidates.length === 1 ? candidates[0] : null;
}

module.exports = { normalizeBuildingKey, createBuildingAliasMap, findBuildingAlias, findBuildingRoom, isOtherBuilding };
