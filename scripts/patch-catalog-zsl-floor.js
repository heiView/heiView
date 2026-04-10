const fs = require('fs');
const p = 'server/scripts/patch-catalog.cjs';
let code = fs.readFileSync(p, 'utf8');

const target = `
            notes: ""
          };
          bld.rooms.push(roomObj);
        }
      } else if (schlierbacher) {`;

const replacement = `
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
      } else if (schlierbacher) {`;

code = code.replace(target, replacement);
fs.writeFileSync(p, code);
