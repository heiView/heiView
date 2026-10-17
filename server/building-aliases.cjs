const { normalizeOrganisation } = require('./organisation-map.cjs');

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

function findOrganisationBuildingRoom(buildings, organisation, roomNames, preferredBuildingName = null, orgLookup = new Map()) {
  const organisationKey = normalizeBuildingKey(normalizeOrganisation(organisation));
  if (!organisationKey) return null;
  const knownBuildings = (buildings || []).filter(building => building.campusId && building.campusId !== 'other');
  const buildingNames = building => [building.street, building.displayName, ...(building.aliases || [])];
  const preferredKey = normalizeBuildingKey(preferredBuildingName);
  // This is an Other fallback only; a location rule or explicit known building wins.
  if (preferredKey && knownBuildings.some(building => [building.street, ...(building.aliases || [])]
    .some(name => name && normalizeBuildingKey(name) === preferredKey))) return null;

  const roomKeys = new Set((roomNames || []).map(normalizeBuildingKey).filter(Boolean));
  if (!roomKeys.size) return null;
  const organisationKeys = new Set([organisationKey,
    ...[...(orgLookup.get(normalizeOrganisation(organisation)) || [])].map(normalizeBuildingKey)]);
  const roomMatches = (catalogName, inputKey) => {
    const catalogKey = normalizeBuildingKey(catalogName);
    if (!catalogKey || !inputKey) return false;
    if (catalogKey === inputKey) return true;
    // Institution-scoped matching may use a short source label such as
    // "HS 413" for a catalog name like "Hörsaal 413 (HS 413)".
    if (inputKey.length < 4) return false;
    const escaped = inputKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}($|[^\\p{L}\\p{N}])`, 'u').test(catalogKey);
  };
  const exactCandidates = [];
  const partialCandidates = [];
  for (const building of knownBuildings) {
    if (!buildingNames(building).some(name => name
      && organisationKeys.has(normalizeBuildingKey(normalizeOrganisation(name))))) continue;
    for (const room of building.rooms || []) {
      const names = [room.name, room.displayName].filter(Boolean);
      if (names.some(name => roomKeys.has(normalizeBuildingKey(name)))) {
        exactCandidates.push({ building, room });
      } else if (names.some(name => name
        && [...roomKeys].some(inputKey => roomMatches(name, inputKey)))) {
        partialCandidates.push({ building, room });
      }
    }
  }
  // Neither a shared institution name nor conflicting room/location values may
  // select an arbitrary building or room. Reuse existing catalog objects only.
  const candidates = exactCandidates.length ? exactCandidates : partialCandidates;
  return candidates.length === 1 ? candidates[0] : null;
}

module.exports = { normalizeBuildingKey, createBuildingAliasMap, findBuildingAlias, findBuildingRoom,
  findOrganisationBuildingRoom, isOtherBuilding };
