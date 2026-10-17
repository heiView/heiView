const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./semesters.cjs');

const ORG_NAME_MAP_PATH = path.join(DATA_DIR, 'org-name-map.json');
let cachedVersion;
let cachedLookup = new Map();

function normalizeOrganisation(value) {
  return (value || '').replace(/&amp;/gi, '&').replace(/\s+/g, ' ').trim().toLowerCase();
}

// One shared registry for every semester, refreshed when the file changes.
function loadOrgSynonymLookup() {
  try {
    const stat = fs.statSync(ORG_NAME_MAP_PATH);
    const version = `${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
    if (version === cachedVersion) return cachedLookup;
    const raw = JSON.parse(fs.readFileSync(ORG_NAME_MAP_PATH, 'utf8'));
    const lookup = new Map();
    for (const entry of Object.values(raw)) {
      const variants = new Set([
        entry.en, entry.de, entry.abbrev,
        ...(Array.isArray(entry.synonyms) ? entry.synonyms : []),
      ].filter(value => typeof value === 'string').map(normalizeOrganisation).filter(Boolean));
      if (entry.abbrev) {
        for (const name of [entry.en, entry.de]) {
          if (name) variants.add(normalizeOrganisation(`${name} (${entry.abbrev})`));
        }
      }
      for (const variant of variants) {
        if (!lookup.has(variant)) lookup.set(variant, new Set());
        for (const synonym of variants) lookup.get(variant).add(synonym);
      }
    }
    cachedLookup = lookup;
    cachedVersion = version;
    return lookup;
  } catch (error) {
    if (error.code !== 'ENOENT') console.warn('[org-map] Failed to load org-name-map.json:', error.message);
    return new Map();
  }
}

function matchesOrganisation(organisation, filter, lookup) {
  const required = normalizeOrganisation(filter);
  if (!required) return true;
  const actual = normalizeOrganisation(organisation);
  if (!actual) return false;
  const variants = lookup.get(required) || new Set([required]);
  return [...variants].some(variant => {
    // Short abbreviations must be complete tokens, not part of another name.
    if (variant.length < 4) {
      const escaped = variant.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}($|[^\\p{L}\\p{N}])`, 'u').test(actual);
    }
    return actual.includes(variant);
  });
}

module.exports = { loadOrgSynonymLookup, matchesOrganisation };
