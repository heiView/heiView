const fs = require('fs');
const p = 'server/scripts/patch-catalog.cjs';
let code = fs.readFileSync(p, 'utf8');

const schlierbacherBlock = `
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
            id: \`\${bld.id}::rm-\${targetRoomName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}\`,
            name: targetRoomName,
            floors: [],
            features: {},
            notes: ""
          };
          bld.rooms.push(roomObj);
        }
`;

if (code.includes('} else if (voss) {')) {
  code = code.replace('} else if (voss) {', schlierbacherBlock + '      } else if (voss) {');
} else {
  console.log("Could not find voss block");
}

fs.writeFileSync(p, code);
