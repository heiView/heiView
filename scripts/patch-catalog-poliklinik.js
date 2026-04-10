const fs = require('fs');
const p = 'server/scripts/patch-catalog.cjs';
let code = fs.readFileSync(p, 'utf8');

const poliklinikBlock = `
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
            id: \`\${bld.id}::rm-\${targetRoomName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}\`,
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
`;

code = code.replace('} else if (voss) {', poliklinikBlock + '      } else if (voss) {');
fs.writeFileSync(p, code);
