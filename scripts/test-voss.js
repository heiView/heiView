const fs = require('fs');
const files = fs.readdirSync('data/2026SS').filter(f => f.endsWith('.json'));

let found = [];
for (const file of files) {
  const d = JSON.parse(fs.readFileSync('data/2026SS/'+file));
  if (!d.weeks) continue;
  for (const w of d.weeks) {
    const text = [w.building, w.room, w.location, w.note].join(' ');
    if (/voßstraße 2/i.test(text)) {
      found.push(w);
    }
  }
}
console.log(found.slice(0, 3));
