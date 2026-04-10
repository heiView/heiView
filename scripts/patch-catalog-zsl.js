const fs = require('fs');
const p = 'server/scripts/patch-catalog.cjs';
let code = fs.readFileSync(p, 'utf8');

const zslBlock = `
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
            id: \`\${bld.id}::rm-\${targetRoomName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}\`,
            name: targetRoomName,
            floors: [],
            features: {},
            notes: ""
          };
          bld.rooms.push(roomObj);
        }
`;

code = code.replace('} else if (schlierbacher)', zslBlock + '      } else if (schlierbacher)');
fs.writeFileSync(p, code);
