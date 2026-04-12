/**
 * Migrate building IDs in building-catalog.json:
 * - Replace German special chars before slugifying: ä→ae, ö→oe, ü→ue, ß→ss
 * - Also updates all room.id fields (which use buildingId as prefix)
 *
 * Collision overrides:
 *   bld-other-pl-ck-57a       → bld-ploeck-57a-other  (duplicate fallback for Plöck 57a)
 *   bld-other-ort-zeit-noch-nicht-bekannt-1 → bld-ort-zeit-noch-nicht-bekannt-1
 */

'use strict';
const fs = require('fs');
const path = require('path');

const CATALOG_PATH = path.join(__dirname, '../data/building-catalog.json');

const DE_MAP = { ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss', Ä: 'ae', Ö: 'oe', Ü: 'ue' };

function slugify(s) {
  return s
    .replace(/[äöüßÄÖÜ]/g, c => DE_MAP[c])
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Manual overrides for collision resolution
const MANUAL_OVERRIDES = {
  'bld-other-pl-ck-57a': 'bld-ploeck-57a-other',
  'bld-other-ort-zeit-noch-nicht-bekannt-1': 'bld-ort-zeit-noch-nicht-bekannt-1',
};

const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));

// Build mapping: oldId → newId
const idMap = {};
for (const b of catalog.buildings) {
  if (MANUAL_OVERRIDES[b.id]) {
    idMap[b.id] = MANUAL_OVERRIDES[b.id];
  } else {
    idMap[b.id] = 'bld-' + slugify(b.street);
  }
}

// Verify no unexpected collisions
const newIdsSeen = new Set();
let hasCollision = false;
for (const [oldId, newId] of Object.entries(idMap)) {
  if (newIdsSeen.has(newId)) {
    console.error(`COLLISION: ${oldId} → ${newId} (already taken)`);
    hasCollision = true;
  }
  newIdsSeen.add(newId);
}
if (hasCollision) {
  console.error('Fix collisions before running migration.');
  process.exit(1);
}

// Apply renames
let changedBuildings = 0;
let changedRooms = 0;

for (const b of catalog.buildings) {
  const oldId = b.id;
  const newId = idMap[oldId];
  if (oldId === newId) continue;

  changedBuildings++;
  b.id = newId;

  for (const r of b.rooms) {
    if (r.id.startsWith(oldId + '::')) {
      r.id = newId + '::' + r.id.slice(oldId.length + 2);
      changedRooms++;
    }
  }
}

fs.writeFileSync(CATALOG_PATH, JSON.stringify(catalog, null, 2) + '\n', 'utf8');
console.log(`Done. Changed ${changedBuildings} building IDs, ${changedRooms} room IDs.`);

// Print summary of changes
const changed = Object.entries(idMap).filter(([o, n]) => o !== n);
changed.forEach(([o, n]) => console.log(`  ${o}  →  ${n}`));
