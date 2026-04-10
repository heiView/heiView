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
    if (/ebene/i.test(normalized)) return true; // e.g. "Ebene 99"
    if (/e00/i.test(normalized)) return true;   // e.g. "E00"
    return false;
  };

  const hasFloorLabel = parts.length >= 2 && isLikelyFloorLabel(parts[parts.length - 1]);
  const floorLabel = hasFloorLabel ? parts[parts.length - 1] : null;
  const coreParts = hasFloorLabel ? parts.slice(0, -1) : parts;
  if (coreParts.length === 0) return { buildingName: null, floorLabel: normalizeFloorLabel(floorLabel) };
  const buildingName = coreParts.length >= 2 ? coreParts[coreParts.length - 1] : coreParts[0];
  return { buildingName: buildingName || null, floorLabel: normalizeFloorLabel(floorLabel) };
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
  return { 
    buildingName: 'Akademiestraße 4', 
    displayName: 'Akademiestraße 4', 
    room: match[1].trim() || 'Unbekannter Raum'
  };
}

function parseSchlierbacher(rawRoom) {
  const match = (rawRoom || '').match(/^Schlierbacher\s+Landstr(?:a(?:ss|ß)e|\.)?\s*200A\s*-\s*(.*)$/i);
  if (!match) return null;
  return {
    buildingName: 'Schlierbacher Landstraße 200A',
    displayName: 'Schlierbacher Landstraße 200A',
    room: match[1].trim() || 'Unbekannt'
  };
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

  return {
    buildingName: 'Im Neuenheimer Feld 400',
    displayName: 'INF 400',
    room: 'Unbekannt',
    floorLabel
  };
}

function main() {
  const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
  const buildingsMap = new Map();
  for (const b of catalog.buildings) buildingsMap.set(b.street, b);

  const files = fs.readdirSync(COURSE_DIR).filter(f => f.endsWith('.json'));
  for (const file of files) {
    const payload = JSON.parse(fs.readFileSync(path.join(COURSE_DIR, file), 'utf8'));
    const weeks = Array.isArray(payload.weeks) ? payload.weeks : [];

    for (const week of weeks) {
      if (week.building) continue;
      const rawRoom = week.room || week.location || '';

      // Skip empty location data
      if (!rawRoom.trim()) continue;

      const inf = parseInfRoom(rawRoom);
      const voss = parseVossRoom(rawRoom, week.building, week.note);
      const akad = parseAkademiestrasse(rawRoom);
      const schlierbacher = parseSchlierbacher(rawRoom);
      const zsl = parseZSL(rawRoom);
      const poliklinik = parsePoliklinik(rawRoom);

      if (inf) {
        let bld = buildingsMap.get(inf.buildingName);
        if (!bld) {
          bld = {
            id: `bld-${inf.displayName.toLowerCase().replace(/\s+/g, '-')}`,
            street: inf.buildingName,
            displayName: inf.displayName,
            campusId: "im-neuenheimer-feld",
            floors: [],
            rooms: []
          };
          catalog.buildings.push(bld);
          buildingsMap.set(inf.buildingName, bld);
        }
        
        let targetRoomName = inf.room || "Main";
        let roomObj = bld.rooms.find(r => r.name === targetRoomName);
        if (!roomObj) {
          roomObj = {
            id: `${bld.id}::rm-${targetRoomName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
            name: targetRoomName,
            floors: [],
            features: {},
            notes: ""
          };
          bld.rooms.push(roomObj);
        }
        
        if (inf.floorLabel && !roomObj.floors.includes(inf.floorLabel)) {
          roomObj.floors.push(inf.floorLabel);
        }
        if (inf.floorLabel && !bld.floors.includes(inf.floorLabel)) {
          bld.floors.push(inf.floorLabel);
        }
      
      } else if (akad) {
        let bld = buildingsMap.get(akad.buildingName);
        if (!bld) {
          bld = {
            id: `bld-${akad.displayName.toLowerCase().replace(/\s+/g, '-').replace(/ß/g, 'ss')}`,
            street: akad.buildingName,
            displayName: akad.displayName,
            campusId: "altstadt",
            floors: [],
            rooms: []
          };
          catalog.buildings.push(bld);
          buildingsMap.set(akad.buildingName, bld);
        }
        
        let targetRoomName = akad.room || "Unbekannter Raum";
        let roomObj = bld.rooms.find(r => r.name === targetRoomName);
        if (!roomObj) {
          roomObj = {
            id: `${bld.id}::rm-${targetRoomName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
            name: targetRoomName,
            floors: [],
            features: {},
            notes: ""
          };
          bld.rooms.push(roomObj);
        }
      
      } else if (zsl) {
        let bld = buildingsMap.get(zsl.buildingName);
        if (!bld) {
          bld = {
            id: 'bld-plock-79-81',
            street: zsl.buildingName,
            displayName: zsl.displayName,
            campusId: "altstadt",
            floors: [],
            rooms: []
          };
          catalog.buildings.push(bld);
          buildingsMap.set(zsl.buildingName, bld);
        }
        
        let targetRoomName = zsl.room || "Unbekannter Raum";
        let roomObj = bld.rooms.find(r => r.name === targetRoomName);
        if (!roomObj) {
          roomObj = {
            id: `${bld.id}::rm-${targetRoomName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
            name: targetRoomName,
            floors: [],
            features: {},
            notes: ""
          };
          bld.rooms.push(roomObj);
        }
        if (zsl.floorLabel && !roomObj.floors.includes(zsl.floorLabel)) {
          roomObj.floors.push(zsl.floorLabel);
        }
        if (zsl.floorLabel && !bld.floors.includes(zsl.floorLabel)) {
          bld.floors.push(zsl.floorLabel);
        }
      } else if (schlierbacher) {
        let bld = buildingsMap.get(schlierbacher.buildingName);
        if (!bld) {
          bld = {
            id: 'bld-schlierbacher-landstra-e-200a',
            street: schlierbacher.buildingName,
            displayName: schlierbacher.displayName,
            campusId: "other",
            floors: [],
            rooms: []
          };
          catalog.buildings.push(bld);
          buildingsMap.set(schlierbacher.buildingName, bld);
        }
        
        let targetRoomName = schlierbacher.room || "Unbekannter Raum";
        let roomObj = bld.rooms.find(r => r.name === targetRoomName);
        if (!roomObj) {
          roomObj = {
            id: `${bld.id}::rm-${targetRoomName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
            name: targetRoomName,
            floors: [],
            features: {},
            notes: ""
          };
          bld.rooms.push(roomObj);
        }
      
      } else if (poliklinik) {
        let bld = buildingsMap.get(poliklinik.buildingName);
        if (!bld) {
          bld = {
            id: 'bld-im-neuenheimer-feld-400',
            street: poliklinik.buildingName,
            displayName: poliklinik.displayName,
            campusId: "im-neuenheimer-feld",
            floors: [],
            rooms: []
          };
          catalog.buildings.push(bld);
          buildingsMap.set(poliklinik.buildingName, bld);
        }
        
        let targetRoomName = poliklinik.room || "Unbekannter Raum";
        let roomObj = bld.rooms.find(r => r.name === targetRoomName);
        if (!roomObj) {
          roomObj = {
            id: `${bld.id}::rm-${targetRoomName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
            name: targetRoomName,
            floors: [],
            features: {},
            notes: ""
          };
          bld.rooms.push(roomObj);
        }
        
        if (poliklinik.floorLabel && !roomObj.floors.includes(poliklinik.floorLabel)) {
          roomObj.floors.push(poliklinik.floorLabel);
        }
        if (poliklinik.floorLabel && !bld.floors.includes(poliklinik.floorLabel)) {
          bld.floors.push(poliklinik.floorLabel);
        }
      } else if (voss) {
        let bld = buildingsMap.get(voss.buildingName);
        if (!bld) {
          bld = {
            id: `bld-${voss.displayName.toLowerCase().replace(/\s+/g, '-')}`,
            street: voss.buildingName,
            displayName: voss.displayName,
            campusId: "bergheim",
            floors: [],
            rooms: []
          };
          catalog.buildings.push(bld);
          buildingsMap.set(voss.buildingName, bld);
        }
        
        let targetRoomName = voss.room || "Unbekannter Raum";
        let roomObj = bld.rooms.find(r => r.name === targetRoomName);
        if (!roomObj) {
          roomObj = {
            id: `${bld.id}::rm-${targetRoomName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
            name: targetRoomName,
            floors: [],
            features: {},
            notes: ""
          };
          bld.rooms.push(roomObj);
        }
      } else {
        // Fallback logic for completely unrecognized rooms/buildings
        const split = splitBuildingAndFloor(rawRoom);
        const fallbackBuildingName = split.buildingName || rawRoom.trim();
        const floorLabel = split.floorLabel;
        
        let bld = buildingsMap.get(fallbackBuildingName);
        if (!bld) {
          const safeIdPart = fallbackBuildingName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
          const uniqueSuffix = Math.random().toString(36).substring(2, 8);
          
          bld = {
            id: `bld-other-${safeIdPart || uniqueSuffix}`,
            street: fallbackBuildingName,
            displayName: fallbackBuildingName,
            campusId: "other",
            floors: [],
            rooms: []
          };
          catalog.buildings.push(bld);
          buildingsMap.set(fallbackBuildingName, bld);
        }
        
        let targetRoomName = rawRoom.trim();
        let roomObj = bld.rooms.find(r => r.name === targetRoomName);
        
        if (!roomObj) {
          const safeRoomId = targetRoomName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
          roomObj = {
            id: `${bld.id}::rm-${safeRoomId || 'unbekannt'}`,
            name: targetRoomName,
            floors: [],
            features: {},
            notes: "Auto-generated fallback from unparsed location. Needs manual review."
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
  console.log("Updated building-catalog.json with mapped and fallback rooms.");
}

main();