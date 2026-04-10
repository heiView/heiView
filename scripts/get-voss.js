const fs = require('fs');
const cat = JSON.parse(fs.readFileSync('data/building-catalog.json', 'utf8'));
const v = cat.buildings.find(b => b.street === 'Voßstraße 2');
if (v) {
  console.log(v.rooms.map(r => r.name).join('\n'));
}
