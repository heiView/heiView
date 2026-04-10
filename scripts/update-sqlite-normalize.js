const fs = require('fs');
const p = 'server/scripts/build-sqlite-db.cjs';
let code = fs.readFileSync(p, 'utf8');

const normalizeFn = `
function normalizeFloorLabel(label) {
  if (!label) return null;
  const lower = label.trim().toLowerCase();
  if (lower === 'eg' || lower === 'erdgeschoss' || /^ground[\\s\\-]*floor$/.test(lower)) return 'Ground floor';
  if (/^1\\.?\\s*[oO][gG]$/.test(lower) || /^1(?:st)?\\s*floor$/.test(lower)) return '1st floor';
  if (/^2\\.?\\s*[oO][gG]$/.test(lower) || /^2(?:nd)?\\s*floor$/.test(lower)) return '2nd floor';
  if (/^3\\.?\\s*[oO][gG]$/.test(lower) || /^3(?:rd)?\\s*floor$/.test(lower)) return '3rd floor';
  if (/^4\\.?\\s*[oO][gG]$/.test(lower) || /^4(?:th)?\\s*floor$/.test(lower)) return '4th floor';
  if (/^5\\.?\\s*[oO][gG]$/.test(lower) || /^5(?:th)?\\s*floor$/.test(lower)) return '5th floor';
  if (/^6\\.?\\s*[oO][gG]$/.test(lower) || /^6(?:th)?\\s*floor$/.test(lower)) return '6th floor';
  if (/^7\\.?\\s*[oO][gG]$/.test(lower) || /^7(?:th)?\\s*floor$/.test(lower)) return '7th floor';
  if (/^8\\.?\\s*[oO][gG]$/.test(lower) || /^8(?:th)?\\s*floor$/.test(lower)) return '8th floor';
  if (/^1\\.?\\s*[uU][gG]$/.test(lower) || /^lower\\s+level\\s*1$/.test(lower) || lower === 'ug' || lower === 'untergeschoss') return 'Lower level 1';
  if (/^2\\.?\\s*[uU][gG]$/.test(lower) || /^lower\\s+level\\s*2$/.test(lower)) return 'Lower level 2';
  return label.trim() || null;
}

function splitBuildingAndFloor(value) {
`;

if (!code.includes('normalizeFloorLabel')) {
  code = code.replace('function splitBuildingAndFloor(value) {', normalizeFn);
  code = code.replace(/return { buildingName: (null|buildingName \|\| null), floorLabel };/g, 'return { buildingName: $1, floorLabel: normalizeFloorLabel(floorLabel) };');
  fs.writeFileSync(p, code);
}
