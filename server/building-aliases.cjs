function normalizeBuildingKey(value) {
  return String(value || '')
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/\s*[-–—]\s*/g, '-')
    .replace(/\s*\/\s*/g, '/')
    .replace(/\s*,\s*/g, ', ');
}

function createBuildingAliasMap(buildings) {
  const aliases = new Map();
  for (const building of buildings) {
    if (!building.street) continue;
    const names = [building.street, building.street.replace(/\//g, '-'), ...(building.aliases || [])];
    for (const name of names) {
      const key = normalizeBuildingKey(name);
      if (key) aliases.set(key, building.street);
    }
  }
  return aliases;
}

function findBuildingAlias(value, aliases) {
  return aliases?.get(normalizeBuildingKey(value)) || null;
}

module.exports = { normalizeBuildingKey, createBuildingAliasMap, findBuildingAlias };
