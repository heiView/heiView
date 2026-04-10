const fs = require('fs');

let file = fs.readFileSync('server/scripts/build-sqlite-db.cjs', 'utf8');
const oldStr = `        if (split.buildingName === 'Voßstraße 2' || /vo(?:ss|ß)stra(?:ss|ß)e\\s*2/i.test(week.building || '') || /vo(?:ss|ß)stra(?:ss|ß)e\\s*2/i.test(week.note || '') || /vo(?:ss|ß)stra(?:ss|ß)e\\s*2/i.test(rawRoom || '')) {
          const combo = [week.building, rawRoom, week.note].join(' ');
          const codeMatch = combo.match(/\\b(4\\d{3})\\b/);
          if (codeMatch) {
            split.buildingName = \`Voßstraße 2 - \${codeMatch[1]}\`;
          } else {
            split.buildingName = \`Voßstraße 2\`;
          }
        }`;
const newStr = `        if (split.buildingName === 'Voßstraße 2' || /vo(?:ss|ß)stra(?:ss|ß)e\\s*2/i.test(week.building || '') || /vo(?:ss|ß)stra(?:ss|ß)e\\s*2/i.test(week.note || '') || /vo(?:ss|ß)stra(?:ss|ß)e\\s*2/i.test(rawRoom || '')) {
          const combo = [week.building, rawRoom, week.note].join(' ');
          const codeMatch = combo.match(/\\b(4\\d{3})\\b/);
          if (codeMatch) {
            split.buildingName = \`Voßstraße 2 - \${codeMatch[1]}\`;
            if (/^geb(?:ä|a)ude\\s*\\d+\\s*\\(/i.test(rawRoom?.trim())) {
              currentRoom = 'Unbekannter Raum';
            }
          } else {
            split.buildingName = \`Voßstraße 2\`;
          }
        }`;
if(file.includes(oldStr)) {
    fs.writeFileSync('server/scripts/build-sqlite-db.cjs', file.replace(oldStr, newStr), 'utf8');
    console.log("Patched build-sqlite-db.cjs");
} else {
    console.log("Could not find the string in build-sqlite-db.cjs");
}
