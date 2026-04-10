const fs = require('fs');

let file = fs.readFileSync('server/scripts/patch-catalog.cjs', 'utf8');

const parseVossCode = `
function parseVossRoom(rawRoom, building, note) {
  if (building === 'Voßstraße 2' || /vo(?:ss|ß)stra(?:ss|ß)e\\s*2/i.test(building || '') || /vo(?:ss|ß)stra(?:ss|ß)e\\s*2/i.test(note || '') || /vo(?:ss|ß)stra(?:ss|ß)e\\s*2/i.test(rawRoom || '')) {
    const combo = [building, rawRoom, note].join(' ');
    const codeMatch = combo.match(/\\b(4\\d{3})\\b/);
    if (codeMatch) {
      let currentRoom = rawRoom;
      if (/^geb(?:ä|a)ude\\s*\\d+\\s*\\(/i.test(rawRoom?.trim())) {
        currentRoom = 'Unbekannter Raum';
      }
      return { buildingName: \`Voßstraße 2 - \${codeMatch[1]}\`, displayName: \`Voßstraße 2 \${codeMatch[1]}\`, room: currentRoom || 'Unbekannt' };
    }
  }
  return null;
}
`;

file = file.replace('function parseInfRoom(rawRoom) {', parseVossCode + '\nfunction parseInfRoom(rawRoom) {');

file = file.replace(`const inf = parseInfRoom(rawRoom);`, `const inf = parseInfRoom(rawRoom);\n      const voss = parseVossRoom(rawRoom, week.building, week.note);`);

const ifInf = `if (inf) {
        let bld = buildingsMap.get(inf.buildingName);
        if (!bld) {
          bld = {
            id: \`bld-\${inf.displayName.toLowerCase().replace(/\\s+/g, '-')}\`,
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
            id: \`\${bld.id}::rm-\${targetRoomName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}\`,
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
      }`;

const ifVoss = `if (voss) {
        let bld = buildingsMap.get(voss.buildingName);
        if (!bld) {
          bld = {
            id: \`bld-\${voss.displayName.toLowerCase().replace(/\\s+/g, '-')}\`,
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
            id: \`\${bld.id}::rm-\${targetRoomName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}\`,
            name: targetRoomName,
            floors: [],
            features: {},
            notes: ""
          };
          bld.rooms.push(roomObj);
        }
      }`;

file = file.replace(ifInf, ifInf + ' else ' + ifVoss);

fs.writeFileSync('server/scripts/patch-catalog.cjs', file, 'utf8');
