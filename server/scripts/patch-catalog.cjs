const { DATA_DIR, getPaths } = require('../semesters.cjs');
const fs = require('fs');
const path = require('path');
const { normalizeBuildingKey, createBuildingAliasMap, findBuildingAlias, findBuildingRoom, findOrganisationBuildingRoom, isOtherBuilding } = require('../building-aliases.cjs');
const { loadOrgSynonymLookup } = require('../organisation-map.cjs');
const {
  parseHausZumRiesen, parseBgLudwigshafen,
  parseInf440Station, ensureInf440StationRoom, ordinalFloorLabel,
  parseDirectRoomCode, parseLocationRoomCode, createRoomCodeIndex, resolveRoomCode, ensureRoomCodeRoom,
} = require('../location-rules.cjs');

const CATALOG_PATH = path.join(DATA_DIR, 'building-catalog.json');

function loadSkipSet() {
  if (!fs.existsSync(getPaths().skipListPath)) return new Set();
  try {
    const data = JSON.parse(fs.readFileSync(getPaths().skipListPath, 'utf8'));
    return new Set(Array.isArray(data) ? data.map(String) : []);
  } catch (e) {
    console.warn('[skip] Failed to load skip list:', e.message);
    return new Set();
  }
}

function resolveCoursePath(fileName) {
  const overridePath = path.join(getPaths().overridesDir, fileName);
  if (fs.existsSync(overridePath)) return overridePath;
  const customPath = path.join(getPaths().customDir, fileName);
  if (fs.existsSync(customPath)) return customPath;
  return path.join(getPaths().courseDir, fileName);
}

function normalizeFloorLabel(label) {
  if (!label) return null;
  const lower = label.trim().toLowerCase().replace(/ß/g, 'ss');
  const upperFloor = lower.match(/^(\d+)\.?\s*(?:og|ober(?:geschoss)?)$/);
  if (upperFloor) return ordinalFloorLabel(Number(upperFloor[1]));
  if (lower === 'eg' || lower === 'erdgeschoss' || /^ground[\s\-]*floor$/.test(lower)) return 'Ground floor';
  if (/^1\.?\s*(?:og|ober(?:geschoss)?)$/.test(lower) || /^1(?:st)?\s*floor$/.test(lower)) return '1st floor';
  if (/^2\.?\s*(?:og|ober(?:geschoss)?)$/.test(lower) || /^2(?:nd)?\s*floor$/.test(lower)) return '2nd floor';
  if (/^3\.?\s*(?:og|ober(?:geschoss)?)$/.test(lower) || /^3(?:rd)?\s*floor$/.test(lower)) return '3rd floor';
  if (/^4\.?\s*(?:og|ober(?:geschoss)?)$/.test(lower) || /^4(?:th)?\s*floor$/.test(lower)) return '4th floor';
  if (/^5\.?\s*(?:og|ober(?:geschoss)?)$/.test(lower) || /^5(?:th)?\s*floor$/.test(lower)) return '5th floor';
  if (/^6\.?\s*(?:og|ober(?:geschoss)?)$/.test(lower) || /^6(?:th)?\s*floor$/.test(lower)) return '6th floor';
  if (/^7\.?\s*(?:og|ober(?:geschoss)?)$/.test(lower) || /^7(?:th)?\s*floor$/.test(lower)) return '7th floor';
  if (/^8\.?\s*(?:og|ober(?:geschoss)?)$/.test(lower) || /^8(?:th)?\s*floor$/.test(lower)) return '8th floor';
  if (/^1\.?\s*(?:ug|untergeschoss)$/.test(lower) || /^lower\s+level\s*1$/.test(lower) || lower === 'ug' || lower === 'untergeschoss') return 'Lower level 1';
  if (/^2\.?\s*(?:ug|untergeschoss)$/.test(lower) || /^lower\s+level\s*2$/.test(lower)) return 'Lower level 2';
  return label.trim() || null;
}

function splitBuildingAndFloor(value, aliasMap) {
  if (!value || typeof value !== 'string') return { buildingName: null, floorLabel: null };
  const text = value.trim();
  if (!text) return { buildingName: null, floorLabel: null };

  const fullAlias = findBuildingAlias(text, aliasMap);
  if (fullAlias) return { buildingName: fullAlias, floorLabel: null };

  const parts = text.split(',').map(p => p.trim()).filter(Boolean);
  if (parts.length === 0) return { buildingName: null, floorLabel: null };

  const isLikelyFloorLabel = (segment) => {
    const normalized = segment.toLowerCase().replace(/ß/g, 'ss');
    if (!normalized) return false;
    if (/\b(floor|ober(?:geschoss)?|erdgeschoss|geschoss|eg|og|untergeschoss|keller|mezzanine|level|ground|lower level|upper level|attic|dach)\b/.test(normalized)) return true;
    if (/\b\d+\s*(st|nd|rd|th)\s*floor\b/.test(normalized)) return true;
    if (/^u\d+$/.test(normalized)) return true;
    if (/ebene/i.test(normalized)) return true;
    if (/e00/i.test(normalized)) return true;
    return false;
  };

  const hasFloorLabel = parts.length >= 2 && isLikelyFloorLabel(parts[parts.length - 1]);
  const floorLabel = hasFloorLabel ? parts[parts.length - 1] : null;
  const coreParts = hasFloorLabel ? parts.slice(0, -1) : parts;
  if (coreParts.length === 0) return { buildingName: null, floorLabel: normalizeFloorLabel(floorLabel) };
  const buildingName = findBuildingAlias(coreParts.join(', '), aliasMap)
    || (coreParts.length >= 2 ? coreParts[coreParts.length - 1] : coreParts[0]);
  return { buildingName: buildingName || null, floorLabel: normalizeFloorLabel(floorLabel) };
}

// --- Parsers ---
function parseOnline(rawRoom) {
  const lower = (rawRoom || '').trim().toLowerCase();
  if (/\b(online|virtuell|virtual|zoom|heiconf|webex|teams)\b/.test(lower)) {
    return { buildingName: 'Online', displayName: 'Online', room: rawRoom.trim() || 'Virtual Room' };
  }
  return null;
}

function parseVossRoom(rawRoom, building, note) {
  if (building === 'Voßstraße 2' || /vo(?:ss|ß)stra(?:ss|ß)e\s*2/i.test(building || '') || /vo(?:ss|ß)stra(?:ss|ß)e\s*2/i.test(note || '') || /vo(?:ss|ß)stra(?:ss|ß)e\s*2/i.test(rawRoom || '')) {
    const combo = [building, rawRoom, note].join(' ');
    const codeMatch = combo.match(/\b(4\d{3})\b/);
    if (codeMatch) {
      let currentRoom = rawRoom;
      if (/^geb(?:ä|a)ude\s*\d+\s*\(/i.test(rawRoom?.trim())) {
        currentRoom = 'Unbekannter Raum';
      }
      return { buildingName: `Voßstraße 2 - ${codeMatch[1]}`, displayName: `Voßstraße 2 ${codeMatch[1]}`, room: currentRoom || 'Unbekannt' };
    }
  }
  return null;
}

function parseInfRoom(rawRoom) {
  const match = (rawRoom || '').trim().match(/^(INF\s+\d+[a-zA-Z]?)[-\/\s]*(.*)$/i);
  if (!match) return null;
  
  const infId = match[1].toUpperCase().replace(/\s+/, ' ');
  const buildingName = infId.replace('INF', 'Im Neuenheimer Feld').trim();
  const rest = (match[2] || '').trim();
  
  let room = '';
  let floorLabel = null;
  if (rest) {
    const split = splitBuildingAndFloor(rest);
    room = split.buildingName || rest;
    floorLabel = split.floorLabel;
  }
  return { buildingName, displayName: infId, room, floorLabel };
}

function parseAkademiestrasse(rawRoom) {
  const match = (rawRoom || '').match(/^(.*)\s*\/\s*(Akademiestra(?:ss|ß)e\s*4)$/i);
  if (!match) return null;
  return { buildingName: 'Akademiestraße 4', displayName: 'Akademiestraße 4', room: match[1].trim() || 'Unbekannter Raum' };
}

function parseSchlierbacher(rawRoom) {
  const match = (rawRoom || '').match(/^Schlierbacher\s+Landstr(?:a(?:ss|ß)e|\.)?\s*200A\s*-\s*(.*)$/i);
  if (!match) return null;
  return { buildingName: 'Schlierbacher Landstraße 200A', displayName: 'Schlierbacher Landstraße 200A', room: match[1].trim() || 'Unbekannt' };
}

function parseZSL(rawRoom) {
  const match = (rawRoom || '').match(/^ZSL,?\s*Raum\s*(\d+)$/i);
  if (!match) return null;
  const roomNumber = match[1];
  const floorDigit = roomNumber.substring(0, 1);
  let floorLabel = '';
  if (floorDigit === '0') floorLabel = 'Ground floor';
  else if (floorDigit === '1') floorLabel = '1st floor';
  else if (floorDigit === '2') floorLabel = '2nd floor';
  else if (floorDigit === '3') floorLabel = '3rd floor';
  else floorLabel = `${floorDigit}th floor`;

  return {
    buildingName: 'Plöck 79-81',
    displayName: 'Plöck 79-81',
    room: `Übungsraum (3120.0${floorDigit}.${roomNumber})`,
    floorLabel
  };
}

function parsePoliklinik(rawRoom) {
  const match = (rawRoom || '').match(/^Poliklinik(?:,?\s*(.*))?$/i);
  if (!match) return null;
  const suffix = match[1]?.trim() || '';
  let floorLabel = null;
  if (/1\.\s*[oO][gG]/.test(suffix)) floorLabel = '1st floor';
  else if (/2\.\s*[oO][gG]/.test(suffix)) floorLabel = '2nd floor';
  else if (/3\.\s*[oO][gG]/.test(suffix)) floorLabel = '3rd floor';
  else if (/EG/i.test(suffix)) floorLabel = 'Ground floor';

  return { buildingName: 'Im Neuenheimer Feld 400', displayName: 'INF 400', room: 'Unbekannt', floorLabel };
}

function mergeBuildingData(target, source) {
  target.aliases = [...new Set([
    ...(target.aliases || []), ...(source.aliases || []), source.street,
  ].filter(name => name && name !== target.street))];
  if (!Array.isArray(target.rooms)) target.rooms = [];
  if (Array.isArray(source.rooms)) {
    for (const room of source.rooms) {
      if (target.rooms.some(existing => existing.name === room.name)) continue;
      let mergedRoom = { ...room };
      if (target.rooms.some(existing => existing.id === mergedRoom.id)) {
        const base = mergedRoom.id;
        let index = 2;
        while (target.rooms.some(existing => existing.id === `${base}-${index}`)) index += 1;
        mergedRoom.id = `${base}-${index}`;
      }
      target.rooms.push(mergedRoom);
    }
  }
  if (!Array.isArray(target.floors)) target.floors = [];
  if (Array.isArray(source.floors)) {
    for (const floor of source.floors) {
      if (!target.floors.includes(floor)) target.floors.push(floor);
    }
  }
}

function mergeEquivalentBuildings(catalog) {
  const exactMap = new Map();
  const toRemove = new Set();

  // Create a strict exact map based on the current street name
  for (const b of catalog.buildings) {
    if (typeof b.street === 'string') {
      exactMap.set(b.street, b);
    }
  }

  // Iterate over buildings and check if they contain a slash
  for (const slashBld of catalog.buildings) {
    if (typeof slashBld.street === 'string' && slashBld.street.includes('/')) {
      const hyphenName = slashBld.street.replace(/\//g, '-');
      const targetBld = exactMap.get(hyphenName);

      // If the hyphen equivalent exists, merge slashBld into targetBld
      if (targetBld && targetBld !== slashBld) {
        const preferSlash = targetBld.campusId === 'other' && slashBld.campusId !== 'other';
        const target = preferSlash ? slashBld : targetBld;
        const source = preferSlash ? targetBld : slashBld;
        mergeBuildingData(target, source);
        toRemove.add(source);
      }
    }
  }

  // Also merge duplicate streets that differ only by spacing around a hyphen
  // (for example, "Plöck 79-81" and "Plöck 79 - 81").
  const normalizedMap = new Map();
  for (const building of catalog.buildings) {
    if (toRemove.has(building) || typeof building.street !== 'string') continue;
    const key = normalizeBuildingKey(building.street);
    const existing = normalizedMap.get(key);
    if (!existing) {
      normalizedMap.set(key, building);
    } else if (existing !== building) {
      // Prefer the reviewed campus assignment over an automatically created Other entry.
      const preferNew = existing.campusId === 'other' && building.campusId !== 'other';
      const target = preferNew ? building : existing;
      const source = preferNew ? existing : building;
      mergeBuildingData(target, source);
      normalizedMap.set(key, target);
      toRemove.add(source);
    }
  }

  // A previously unparsed location may now be an alias of a reviewed building.
  // Merge its rooms before removing it so future syncs cannot resurrect the
  // duplicate or let it override the reviewed alias mapping.
  const reviewedBuildings = catalog.buildings.filter(building =>
    !toRemove.has(building) && building.campusId && building.campusId !== 'other');
  const reviewedAliases = createBuildingAliasMap(reviewedBuildings);
  const reviewedByStreet = new Map(reviewedBuildings.map(building => [building.street, building]));
  for (const source of catalog.buildings) {
    if (toRemove.has(source) || source.campusId !== 'other') continue;
    const target = reviewedByStreet.get(findBuildingAlias(source.street, reviewedAliases));
    if (!target) continue;
    mergeBuildingData(target, source);
    toRemove.add(source);
  }

  // Remove all equivalent duplicate buildings.
  catalog.buildings = catalog.buildings.filter(b => !toRemove.has(b));
}

function mergeHausZumRiesenBuildings(catalog) {
  const legacyBuildings = catalog.buildings.filter(building => parseHausZumRiesen(building.street));
  if (!legacyBuildings.length) return;
  let target = catalog.buildings.find(building => normalizeBuildingKey(building.street) === normalizeBuildingKey('Hauptstraße 52'));
  if (!target) {
    target = { id: 'bld-hauptstrasse-52', street: 'Hauptstraße 52',
      displayName: 'Hauptstraße 52 Haus zum Riesen', campusId: 'altstadt',
      aliases: ['Haus zum Riesen'], rooms: [], floors: [] };
    catalog.buildings.push(target);
  }
  for (const source of legacyBuildings) {
    const rooms = (source.rooms || []).map(room => {
      const parsed = parseHausZumRiesen(room.name);
      if (!parsed) return room;
      return { ...room, name: parsed.room,
        displayName: parseHausZumRiesen(room.displayName) ? parsed.room : room.displayName };
    });
    mergeBuildingData(target, { ...source, rooms });
  }
  const legacySet = new Set(legacyBuildings);
  catalog.buildings = catalog.buildings.filter(building => !legacySet.has(building));
}

function normalizeBuildingNameForMerge(name, buildingsMap) {
  if (!name || typeof name !== 'string') return name;
  const dashName = name.replace(/\//g, '-');
  if (dashName !== name && buildingsMap.has(dashName)) {
    return dashName;
  }
  const normalized = normalizeBuildingKey(name);
  for (const [street, building] of buildingsMap) {
    if (normalizeBuildingKey(street) === normalized) return building.street;
  }
  return name;
}

function mergeBgLudwigshafenRooms(catalog) {
  let target = catalog.buildings.find(building => building.street === 'Ludwig-Guttmann-Straße 13');
  const emptyFallbacks = new Set();
  if (target) {
    target.aliases = [...new Set([...(target.aliases || []), 'BG Ludwigshafen'])];
    if (!target.rooms) target.rooms = [];
    for (const room of target.rooms) {
      if (/^Auto-generated fallback from unparsed location/i.test(room.notes || '')) room.notes = '';
    }
  }
  for (const source of [...catalog.buildings]) {
    const matching = (source.rooms || []).filter(room => parseBgLudwigshafen(room.name));
    if (!matching.length) continue;
    if (!target) {
      target = { id: 'bld-ludwig-guttmann-strasse-13', street: 'Ludwig-Guttmann-Straße 13',
        displayName: 'BG Klinik Ludwigshafen', campusId: 'mannheim-and-ludwigshafen',
        aliases: ['BG Ludwigshafen'], rooms: [], floors: [] };
      catalog.buildings.push(target);
    }
    source.rooms = source.rooms.filter(room => !matching.includes(room));
    for (const room of matching) {
      const parsed = parseBgLudwigshafen(room.name);
      const floors = parsed.floorLabel ? [parsed.floorLabel] : (room.floors || []);
      const cleanedNotes = /^Auto-generated fallback from unparsed location/i.test(room.notes || '') ? '' : room.notes;
      const existing = target.rooms.find(item => item.name === parsed.room);
      if (existing) {
        existing.floors = [...new Set([...(existing.floors || []), ...floors])];
        existing.features = { ...room.features, ...existing.features };
        if (!existing.notes && cleanedNotes) existing.notes = cleanedNotes;
      } else {
        target.rooms.push({ ...room, name: parsed.room, floors,
          displayName: parseBgLudwigshafen(room.displayName) ? parsed.room : room.displayName,
          notes: cleanedNotes });
      }
      target.floors = [...new Set([...(target.floors || []), ...floors])];
    }
    // A tower name alone is not an alias for the hospital. Keep unrelated rooms.
    if (source !== target && source.campusId === 'other' && !source.rooms.length) emptyFallbacks.add(source);
  }
  catalog.buildings = catalog.buildings.filter(building => !emptyFallbacks.has(building));
}

function mergeDirectRoomCodeFallbacks(catalog) {
  const index = createRoomCodeIndex(catalog.buildings);
  const emptyFallbacks = new Set();
  for (const source of catalog.buildings) {
    if (source.campusId !== 'other') continue;
    const moved = new Set();
    for (const room of source.rooms || []) {
      const parsed = parseDirectRoomCode(room.name);
      if (!parsed) continue;
      const target = ensureRoomCodeRoom(index, parsed);
      if (!target) continue;
      if (!target.room.features) target.room.features = {};
      for (const [key, value] of Object.entries(room.features || {})) {
        if (target.room.features[key] == null && value != null) target.room.features[key] = value;
      }
      if (!target.room.notes && room.notes && !/^Auto-generated fallback/.test(room.notes)) target.room.notes = room.notes;
      moved.add(room);
    }
    if (!moved.size) continue;
    source.rooms = source.rooms.filter(room => !moved.has(room));
    if (!source.rooms.length && parseDirectRoomCode(source.street)) emptyFallbacks.add(source);
  }
  catalog.buildings = catalog.buildings.filter(building => !emptyFallbacks.has(building));
}

function mergeInf440StationRooms(catalog) {
  const emptyFallbacks = new Set();
  for (const source of [...catalog.buildings]) {
    if (source.campusId !== 'other' && source.street !== 'Im Neuenheimer Feld 440') continue;
    let moved = false;
    for (const room of [...(source.rooms || [])]) {
      const parsed = parseInf440Station(room.name, room.displayName, source.street);
      if (!parsed) continue;
      const target = ensureInf440StationRoom(catalog, parsed);
      if (target.room === room) continue;
      // Preserve reviewed metadata while removing the old unparsed room label.
      for (const [key, value] of Object.entries(room.features || {})) {
        if (target.room.features[key] == null && value != null) target.room.features[key] = value;
      }
      if (!target.room.notes && room.notes && !/^Auto-generated fallback/i.test(room.notes)) {
        target.room.notes = room.notes;
      }
      for (const floor of (room.floors || []).map(normalizeFloorLabel).filter(Boolean)) {
        if (!target.room.floors.includes(floor)) target.room.floors.push(floor);
        if (!target.building.floors.includes(floor)) target.building.floors.push(floor);
      }
      source.rooms = source.rooms.filter(item => item !== room);
      moved = true;
    }
    if (moved && source.campusId === 'other' && !source.rooms?.length) emptyFallbacks.add(source);
  }
  catalog.buildings = catalog.buildings.filter(building => !emptyFallbacks.has(building));
}

function main() {
  const courseFiles = require('./validate-data.cjs').validateData();
  const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));

  // Merge equivalent buildings first (e.g. Hauptstraße 47/51 -> Hauptstraße 47-51)
  mergeEquivalentBuildings(catalog);
  mergeHausZumRiesenBuildings(catalog);
  mergeBgLudwigshafenRooms(catalog);
  mergeDirectRoomCodeFallbacks(catalog);
  mergeInf440StationRooms(catalog);

  // SELF-HEALING: Clean up existing duplicate IDs in the JSON file
  const globalUniqueIds = new Set();
  function getStrictlyUniqueId(baseId) {
    if (!globalUniqueIds.has(baseId)) {
      globalUniqueIds.add(baseId);
      return baseId;
    }
    let counter = 1;
    let newId = `${baseId}-${counter}`;
    while (globalUniqueIds.has(newId)) {
      counter++;
      newId = `${baseId}-${counter}`;
    }
    globalUniqueIds.add(newId);
    return newId;
  }

  for (const b of catalog.buildings) {
    b.id = getStrictlyUniqueId(b.id);
    if (b.rooms) {
      for (const r of b.rooms) {
        r.id = getStrictlyUniqueId(r.id);
      }
    }
  }

  // Build the map based on the cleaned catalog
  const buildingsMap = new Map();
  for (const b of catalog.buildings) {
    buildingsMap.set(b.street, b);
  }
  const aliasMap = createBuildingAliasMap(catalog.buildings);
  const reviewedAliasMap = createBuildingAliasMap(catalog.buildings, { includeOther: false });
  const roomCodeIndex = createRoomCodeIndex(catalog.buildings);
  const orgLookup = loadOrgSynonymLookup();

  // Ensure directory exists before reading
  if (fs.existsSync(getPaths().courseDir)) {
    const skipSet = loadSkipSet();
    if (skipSet.size > 0) console.log(`[skip] Loaded ${skipSet.size} course(s) to skip.`);
    const files = courseFiles;
    for (const file of files) {
      const coursePath = resolveCoursePath(file);
      const payload = JSON.parse(fs.readFileSync(coursePath, 'utf8'));
      if (payload.id && skipSet.has(String(payload.id))) continue;
      const weeks = Array.isArray(payload.weeks) ? payload.weeks : [];
      
      for (const week of weeks) {
        const rawRoom = week.room || week.location || '';
        if (!rawRoom.trim()) continue;
        const explicitOther = isOtherBuilding(
          splitBuildingAndFloor(week.building, aliasMap).buildingName, catalog.buildings, aliasMap);

        const directCode = parseLocationRoomCode(week.room, week.location);
        if (directCode) {
          const resolved = resolveRoomCode(roomCodeIndex, directCode);
          const explicitBuilding = splitBuildingAndFloor(week.building, aliasMap).buildingName;
          if (resolved && (!explicitBuilding || explicitOther || parseDirectRoomCode(explicitBuilding)?.code === directCode.code || explicitBuilding === resolved.building.street)) {
            ensureRoomCodeRoom(roomCodeIndex, directCode);
            continue;
          }
        }
        const inf440Station = parseInf440Station(rawRoom, week.location, week.building);
        const explicitBuildingName = splitBuildingAndFloor(week.building, aliasMap).buildingName;
        if (inf440Station && (!explicitBuildingName || explicitOther
            || parseInf440Station(null, null, week.building)
            || normalizeBuildingKey(explicitBuildingName) === normalizeBuildingKey(inf440Station.buildingName))) {
          ensureInf440StationRoom(catalog, inf440Station);
          continue;
        }
        if (week.building && !explicitOther) continue;

        const online = parseOnline(rawRoom);
        const inf = parseInfRoom(rawRoom);
        const hausZumRiesen = parseHausZumRiesen(rawRoom);
        const bgLudwigshafen = parseBgLudwigshafen(rawRoom);
        const voss = parseVossRoom(rawRoom, week.building, week.note);
        const akad = parseAkademiestrasse(rawRoom);
        const schlierbacher = parseSchlierbacher(rawRoom);
        const zsl = parseZSL(rawRoom);
        const poliklinik = parsePoliklinik(rawRoom);
        
        let parsedResult = online || inf || hausZumRiesen || bgLudwigshafen || akad || zsl || schlierbacher || poliklinik || voss;
        let fallbackBuildingName, floorLabel, targetRoomName, campusId;

        if (parsedResult) {
          fallbackBuildingName = parsedResult.buildingName;
          targetRoomName = parsedResult.room || "Unbekannter Raum";
          floorLabel = parsedResult.floorLabel;
          // Retain appropriate campus IDs
          campusId = online ? "online" : 
                    (inf || poliklinik) ? "im-neuenheimer-feld" : 
                    (akad || zsl || hausZumRiesen) ? "altstadt" :
                    bgLudwigshafen ? "mannheim-and-ludwigshafen" :
                    voss ? "bergheim" : "other"; 
        } else {
          // Fallback logic
          const reviewedLocation = splitBuildingAndFloor(rawRoom, reviewedAliasMap);
          const reviewedBuilding = findBuildingAlias(reviewedLocation.buildingName, reviewedAliasMap);
          const split = reviewedBuilding ? { ...reviewedLocation, buildingName: reviewedBuilding }
            : splitBuildingAndFloor(explicitOther ? week.building : rawRoom, aliasMap);
          fallbackBuildingName = findBuildingAlias(split.buildingName, aliasMap) || split.buildingName || rawRoom.trim();
          floorLabel = split.floorLabel;
          targetRoomName = rawRoom.trim();
          campusId = "other";
        }

        const roomMatch = (campusId === 'other' && findOrganisationBuildingRoom(catalog.buildings,
          payload.organisation, [targetRoomName, week.room, week.location], fallbackBuildingName, orgLookup))
          || findBuildingRoom(catalog.buildings, targetRoomName, fallbackBuildingName);
        const currentBuilding = catalog.buildings.find(building =>
          normalizeBuildingKey(building.street) === normalizeBuildingKey(fallbackBuildingName));
        if (roomMatch && (!currentBuilding || currentBuilding.campusId === 'other')) {
          fallbackBuildingName = roomMatch.building.street;
          targetRoomName = roomMatch.room.name;
          campusId = roomMatch.building.campusId;
        }

        // Apply hypen mapping if a hyphenated building exists instead of a slash building
        fallbackBuildingName = normalizeBuildingNameForMerge(fallbackBuildingName, buildingsMap);
        let bld = buildingsMap.get(fallbackBuildingName);
        
        if (!bld) {
          const safeIdPart = fallbackBuildingName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
          const fallbackBaseId = parsedResult ? 
            `bld-${(parsedResult.displayName || fallbackBuildingName).toLowerCase().replace(/\s+/g, '-').replace(/ß/g, 'ss')}` : 
            (safeIdPart ? `bld-other-${safeIdPart}` : `bld-other-${Math.random().toString(36).substring(2, 8)}`);
            
          bld = {
            id: getStrictlyUniqueId(fallbackBaseId),
            street: fallbackBuildingName,
            displayName: parsedResult ? (parsedResult.displayName || fallbackBuildingName) : fallbackBuildingName,
            campusId: campusId,
            floors: [],
            rooms: []
          };
          catalog.buildings.push(bld);
          buildingsMap.set(fallbackBuildingName, bld);
        } else if (online) {
          bld.campusId = "online";
        }
        
        let roomObj = bld.rooms.find(r => r.name === targetRoomName);
        
        if (!roomObj) {
          const safeRoomIdPart = targetRoomName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
          const baseRoomId = `${bld.id}::rm-${safeRoomIdPart || 'unbekannt'}`;
          
          roomObj = {
            id: getStrictlyUniqueId(baseRoomId),
            name: targetRoomName,
            floors: [],
            features: {},
            notes: parsedResult ? (online ? "Online/Virtual Course" : "") : "Auto-generated fallback from unparsed location. Needs manual review."
          };
          bld.rooms.push(roomObj);
        }
        
        if (floorLabel && !roomObj.floors.includes(floorLabel)) {
          roomObj.floors.push(floorLabel);
        }
        if (floorLabel && !bld.floors.includes(floorLabel)) {
          bld.floors.push(floorLabel);
        }
      }
    }
  }
  
  fs.writeFileSync(CATALOG_PATH, JSON.stringify(catalog, null, 2));
  console.log("Database catalog patched. Slated duplicate buildings are merged correctly.");
}

main();
