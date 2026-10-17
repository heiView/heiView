// Build off to the side; publish only after all steps succeed.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const Database = require('better-sqlite3');
const { pathsFor, ROOT, DATA_DIR, config, validSemester } = require('../semesters.cjs');
const { validateData } = require('./validate-data.cjs');

function acquireLock(lockPath) {
  if (fs.existsSync(lockPath)) {
    const pid = Number(fs.readFileSync(lockPath, 'utf8'));
    if (Number.isInteger(pid) && pid > 0) {
      try { process.kill(pid, 0); }
      catch (err) { if (err.code === 'ESRCH') fs.rmSync(lockPath, { force: true }); }
    }
  }
  let lock;
  try { lock = fs.openSync(lockPath, 'wx'); }
  catch (err) {
    if (err.code === 'EEXIST') throw new Error(`Another database sync is running, or a stale lock exists: ${lockPath}`);
    throw err;
  }
  fs.writeFileSync(lock, String(process.pid));
  return lock;
}

function allSemesterPaths() {
  const semesters = new Set(Object.keys(config.semesters));
  for (const entry of fs.readdirSync(DATA_DIR, { withFileTypes: true })) {
    if (entry.isDirectory() && validSemester(entry.name)) semesters.add(entry.name);
    if (entry.isFile() && entry.name.endsWith('.db') && validSemester(entry.name.slice(0, -3))) {
      semesters.add(entry.name.slice(0, -3));
    }
  }
  return [...semesters].sort().reverse().map(semester => pathsFor(semester));
}

function pruneUnusedOtherBuildings(stages) {
  const used = new Set();
  for (const { stage } of stages) {
    const db = new Database(stage, { readonly: true });
    try {
      for (const row of db.prepare('SELECT DISTINCT building_name FROM occurrences WHERE building_name IS NOT NULL').all()) {
        used.add(row.building_name);
      }
    } finally { db.close(); }
  }
  const catalogPath = path.join(DATA_DIR, 'building-catalog.json');
  const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
  const removed = catalog.buildings.filter(building => building.campusId === 'other' && !used.has(building.street));
  if (!removed.length) return false;
  const removedSet = new Set(removed);
  catalog.buildings = catalog.buildings.filter(building => !removedSet.has(building));
  fs.writeFileSync(catalogPath, JSON.stringify(catalog, null, 2));
  console.log(`[all] Removed ${removed.length} unused Other building(s): ${removed.map(building => building.street).join('; ')}`);
  return true;
}

function main({ all = false } = {}) {
  const pathsList = all ? allSemesterPaths() : [pathsFor()];
  // Refuse partial coverage before any cleanup or published database changes.
  for (const paths of pathsList) validateData(paths);
  const locks = [];
  const stages = [];
  const catalogPath = path.join(DATA_DIR, 'building-catalog.json');
  let originalCatalog = null;
  let published = false;
  let cleaned = false;
  const runScript = (script, paths, stage) => {
    const env = { ...process.env, HEIVIEW_SEMESTER: paths.semester, HEIVIEW_DB_PATH: stage };
    const result = spawnSync(process.execPath, [path.join(__dirname, script)], { cwd: ROOT, env, stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`${script} failed (${result.status ?? result.signal})`);
  };
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    if (!published && originalCatalog !== null) fs.writeFileSync(catalogPath, originalCatalog);
    for (const { stage } of stages) {
      for (const suffix of ['', '-wal', '-shm']) fs.rmSync(stage + suffix, { force: true });
    }
    for (const { lock, lockPath } of locks.reverse()) {
      fs.closeSync(lock);
      fs.rmSync(lockPath, { force: true });
    }
  };
  const interrupt = () => { cleanup(); process.exit(130); };
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  try {
    for (const paths of pathsList) {
      const lockPath = path.join(paths.courseDir, '.db-sync.lock');
      locks.push({ lockPath, lock: acquireLock(lockPath) });
      stages.push({ paths, stage: path.join(DATA_DIR, `.${paths.semester}-${crypto.randomUUID()}.db`) });
    }
    const catalogLockPath = path.join(DATA_DIR, '.catalog-sync.lock');
    locks.push({ lockPath: catalogLockPath, lock: acquireLock(catalogLockPath) });
    originalCatalog = fs.readFileSync(catalogPath);
    // Finish the shared catalog before building any semester's metadata.
    for (const { paths, stage } of stages) runScript('patch-catalog.cjs', paths, stage);
    for (const { paths, stage } of stages) {
      runScript('build-sqlite-db.cjs', paths, stage);
    }
    if (all) pruneUnusedOtherBuildings(stages);
    for (const { paths, stage } of stages) runScript('import-building-catalog.cjs', paths, stage);
    for (const { paths, stage } of stages) {
      fs.renameSync(stage, paths.dbPath);
      console.log(`[${paths.semester}] Published database: ${paths.dbPath}`);
    }
    published = true;
  } finally {
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', interrupt);
    cleanup();
  }
}

if (require.main === module) {
  try {
    const args = process.argv.slice(2);
    if (args.some(arg => arg !== '--all')) throw new Error('Usage: npm run db:sync [-- --all]');
    main({ all: args.includes('--all') });
  } catch (err) { console.error(err.message); process.exitCode = 1; }
}
module.exports = { main };
