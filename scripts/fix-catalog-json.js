const fs = require('fs');

function normalizeFloorLabel(label) {
  if (!label) return null;
  const t = label.trim();
  const lower = t.toLowerCase();
  
  if (lower === '1. og' || lower === '1.og') return '1st floor';
  if (lower === '2. og' || lower === '2.og') return '2nd floor';
  if (lower === '3. og' || lower === '3.og') return '3rd floor';
  if (lower === '4. og' || lower === '4.og') return '4th floor';
  if (lower === '5. og' || lower === '5.og') return '5th floor';
  if (lower === '6. og' || lower === '6.og') return '6th floor';
  if (lower === '7. og' || lower === '7.og') return '7th floor';
  if (lower === '8. og' || lower === '8.og') return '8th floor';
  
  if (lower === 'eg' || lower === 'erdgeschoss') return 'Ground floor';
  if (lower === 'ug' || lower === 'untergeschoss' || lower === '1. ug' || lower === '1.ug') return 'Lower level 1';
  if (lower === '2. ug' || lower === '2.ug') return 'Lower level 2';
  
  return t;
}

const c = JSON.parse(fs.readFileSync('data/building-catalog.json', 'utf8'));

c.buildings.forEach(b => {
  b.floors = [...new Set(b.floors.map(normalizeFloorLabel).filter(Boolean))];
  b.rooms.forEach(r => {
    r.floors = [...new Set(r.floors.map(normalizeFloorLabel).filter(Boolean))];
  });
});

fs.writeFileSync('data/building-catalog.json', JSON.stringify(c, null, 2));
