const fs = require('fs');

let file = fs.readFileSync('server/scripts/build-sqlite-db.cjs', 'utf8');

const parseInfCode = `
function parseInfRoom(rawRoom) {
  const match = (rawRoom || '').trim().match(/^(INF\\s+\\d+[a-zA-Z]?)[-\\s\\/]*(.*)$/i);
  if (!match) return null;
  const infId = match[1].toUpperCase().replace(/\\s+/, ' ');
  const buildingName = infId.replace('INF', 'Im Neuenheimer Feld').trim();
  const rest = (match[2] || '').trim();
  let room = '';
  let floorLabel = null;
  if (rest) {
    const split = splitBuildingAndFloor(rest);
    room = split.buildingName || rest;
    floorLabel = split.floorLabel;
  }
  return { buildingName, room, floorLabel, original: infId };
}
`;

const modifiedFile = file.replace('function splitBuildingAndFloor(value) {', parseInfCode + '\nfunction splitBuildingAndFloor(value) {')
  .replace(
    '        const split = splitBuildingAndFloor(week.building || null);',
    `        const rawRoom = week.room || week.location || null;
        let split = splitBuildingAndFloor(week.building || null);
        let currentRoom = rawRoom;
        
        if (!split.buildingName && rawRoom) {
          const inf = parseInfRoom(rawRoom);
          if (inf) {
            split.buildingName = inf.buildingName;
            split.floorLabel = inf.floorLabel;
            currentRoom = inf.room || inf.original;
          }
        }`
  ).replace(
    '            room: week.room || week.location || null,',
    `            room: currentRoom,`
  );

fs.writeFileSync('server/scripts/build-sqlite-db.cjs', modifiedFile, 'utf8');
