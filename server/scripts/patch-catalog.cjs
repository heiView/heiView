const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const COURSE_DIR = path.join(ROOT, 'data', '2026SS');
const CATALOG_PATH = path.join(ROOT, 'data', 'building-catalog.json');

function normalizeFloorLabel(label) {
  if (!label) return null;
  const lower = label.trim().toLowerCase();
  if (lower === 'eg' || lower === 'erdgeschoss' || /^ground[\s\-]*floor$/.test(lower)) return 'Ground floor';
  if (/^1\.?\s*[oO][gG]$/.test(lower) || /^1(?:st)?\s*floor$/.test(lower)) return '1st floor';
  if (/^2\.?\s*[oO][gG]$/.test(lower) || /^2(?:nd)?\s*floor$/.test(lower)) return '2nd floor';
  if (/^3\.?\s*[oO][gG]$/.test(lower) || /^3(?:rd)?\s*floor$/.test(lower)) return '3rd floor';
  if (/^4\.?\s*[oO][gG]$/.test(lower) || /^4(?:th)?\s*floor$/.test(lower)) return '4th floor';
  if (/^5\.?\s*[oO][gG]$/.test(lower) || /^5(?:th)?\s*floor$/.test(lower)) return '5th floor';
  if (/^6\.?\s*[oO][gG]$/.test(lower) || /^6(?:th)?\s*floor$/.test(lower)) return '6th floor';
  if (/^7\.?\s*[oO][gG]$/.test(lower) || /^7(?:th)?\s*floor$/.test(lower)) return '7th floor';
  if (/^8\.?\s*[oO][gG]$/.test(lower) || /^8(?:th)?\s*floor$/.test(lower)) return '8th floor';
  if (/^1\.?\s*[uU][gG]$/.test(lower) || /^lower\s+level\s*1$/.test(lower) || lower === 'ug' || lower === 'untergeschoss') return 'Lower level 1';
  if (/^2\.?\s*[uU][gG]$/.test(lower) || /^lower\s+level\s*2$/.test(lower)) return 'Lower level 2';
  return label.trim() || null;
}

function splitBuildingAndFloor(value) {
  if (!value || typeof value !== 'string') return { buildingName: null, floorLabel: null };
  const text = value.trim();
  if (!text) return { buildingName: null, floorLabel: null };

  const parts = text.split(',').map(p => p.trim()).filter(Boolean);
  if (parts.length === 0) return { buildingName: null, floorLabel: null };

  const isLikelyFloorLabel = (segment) => {
    const normalized = segment.toLowerCase();
    if (!normalized) return false;
    if (/\b(floor|geschoss|eg|og|untergeschoss|keller|mezzanine|level|ground|lower level|upper level|attic|dach)\b/.test(normalized)) return true;
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
  const buildingName = coreParts.length >= 2 ? coreParts[coreParts.length - 1] : coreParts[0];
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
        
        // Merge rooms
        if (Array.isArray(slashBld.rooms)) {
          for (const room of slashBld.rooms) {
            // Check if the room already exists by name
            if (!targetBld.rooms.some(r => r.name === room.name)) {
              let newRoom = { ...room };
              // Resolve duplicate ID conflicts
              if (targetBld.rooms.some(r => r.id === newRoom.id)) {
                let base = newRoom.id;
                let idx = 2;
                while (targetBld.rooms.some(r => r.id === `${base}-${idx}`)) {
                  idx++;
                }
                newRoom.id = `${base}-${idx}`;
              }
              targetBld.rooms.push(newRoom);
            }
          }
        }

        // Merge floors
        if (Array.isArray(slashBld.floors)) {
          for (const floor of slashBld.floors) {
            if (!targetBld.floors.includes(floor)) {
              targetBld.floors.push(floor);
            }
          }
        }
        toRemove.add(slashBld);
      }
    }
  }

  // Remove the merged slash items
  catalog.buildings = catalog.buildings.filter(b => !toRemove.has(b));
}

function normalizeBuildingNameForMerge(name, buildingsMap) {
  if (!name || typeof name !== 'string') return name;
  const dashName = name.replace(/\//g, '-');
  if (dashName !== name && buildingsMap.has(dashName)) {
    return dashName;
  }
  return name;
}

function main() {
  const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));

  // Merge equivalent buildings first (e.g. Hauptstraße 47/51 -> Hauptstraße 47-51)
  mergeEquivalentBuildings(catalog);

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

  // Ensure directory exists before reading
  if (fs.existsSync(COURSE_DIR)) {
    const files = fs.readdirSync(COURSE_DIR).filter(f => f.endsWith('.json'));
    for (const file of files) {
      const payload = JSON.parse(fs.readFileSync(path.join(COURSE_DIR, file), 'utf8'));
      const weeks = Array.isArray(payload.weeks) ? payload.weeks : [];
      
      for (const week of weeks) {
        if (week.building) continue;
        const rawRoom = week.room || week.location || '';
        
        if (!rawRoom.trim()) continue;

        const online = parseOnline(rawRoom);
        const inf = parseInfRoom(rawRoom);
        const voss = parseVossRoom(rawRoom, week.building, week.note);
        const akad = parseAkademiestrasse(rawRoom);
        const schlierbacher = parseSchlierbacher(rawRoom);
        const zsl = parseZSL(rawRoom);
        const poliklinik = parsePoliklinik(rawRoom);
        
        let parsedResult = online || inf || akad || zsl || schlierbacher || poliklinik || voss;
        let fallbackBuildingName, floorLabel, targetRoomName, campusId;

        if (parsedResult) {
          fallbackBuildingName = parsedResult.buildingName;
          targetRoomName = parsedResult.room || "Unbekannter Raum";
          floorLabel = parsedResult.floorLabel;
          // Retain appropriate campus IDs
          campusId = online ? "online" : 
                    (inf || poliklinik) ? "im-neuenheimer-feld" : 
                    (akad || zsl) ? "altstadt" : 
                    voss ? "bergheim" : "other"; 
        } else {
          // Fallback logic
          const split = splitBuildingAndFloor(rawRoom);
          fallbackBuildingName = split.buildingName || rawRoom.trim();
          floorLabel = split.floorLabel;
          targetRoomName = rawRoom.trim();
          campusId = "other";
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