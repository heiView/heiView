const fs = require('fs');

const cat = JSON.parse(fs.readFileSync('data/building-catalog.json', 'utf8'));
const vossIdx = cat.buildings.findIndex(b => b.street === 'Voßstraße 2');
if (vossIdx >= 0) {
  const bld = cat.buildings[vossIdx];
  const byCode = {};
  for (const r of bld.rooms) {
    const codeMatch = r.name.match(/\b(4\d{3})\b/);
    const code = codeMatch ? codeMatch[1] : 'Unknown';
    if (!byCode[code]) {
      byCode[code] = {
        id: `bld-vo-stra-e-2-${code}`,
        street: code === 'Unknown' ? 'Voßstraße 2' : `Voßstraße 2 - ${code}`,
        displayName: code === 'Unknown' ? 'Voßstraße 2' : `Voßstraße 2 ${code}`,
        campusId: "bergheim",
        floors: [],
        rooms: []
      };
    }
    const target = byCode[code];
    r.id = `${target.id}::${r.id.split('::')[1] || r.id}`;
    target.rooms.push(r);
    for (const f of r.floors) {
      if (!target.floors.includes(f)) target.floors.push(f);
    }
  }
  cat.buildings.splice(vossIdx, 1);
  for (const code of Object.keys(byCode)) {
    cat.buildings.push(byCode[code]);
  }
  fs.writeFileSync('data/building-catalog.json', JSON.stringify(cat, null, 2));
  console.log('Split Voßstraße 2 in catalog!');
}
