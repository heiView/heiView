const fs = require('fs');
const p = 'server/scripts/patch-catalog.cjs';
let code = fs.readFileSync(p, 'utf8');
code = code.replace(/return { buildingName: (null|buildingName \|\| null), floorLabel };/g, 'return { buildingName: $1, floorLabel: normalizeFloorLabel(floorLabel) };');
fs.writeFileSync(p, code);
