// Build off to the side; publish only after all steps succeed.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { pathsFor, ROOT, DATA_DIR } = require('../semesters.cjs');
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

function main() {
  const paths = pathsFor();
  validateData(paths);
  const lockPath = path.join(paths.courseDir, '.db-sync.lock');
  const lock = acquireLock(lockPath);
  // Catalog additions are shared even when course databases are separate.
  const catalogLockPath = path.join(DATA_DIR, '.catalog-sync.lock');
  let catalogLock = null;
  const stage = path.join(paths.dataDir, `.${paths.semester}-${crypto.randomUUID()}.db`);
  const env = { ...process.env, HEIVIEW_SEMESTER: paths.semester, HEIVIEW_DB_PATH: stage };
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    for (const suffix of ['', '-wal', '-shm']) fs.rmSync(stage + suffix, { force: true });
    fs.closeSync(lock);
    fs.rmSync(lockPath, { force: true });
    if (catalogLock !== null) {
      fs.closeSync(catalogLock);
      fs.rmSync(catalogLockPath, { force: true });
    }
  };
  const interrupt = () => { cleanup(); process.exit(130); };
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  try {
    catalogLock = acquireLock(catalogLockPath);
    for (const script of ['patch-catalog.cjs', 'build-sqlite-db.cjs', 'import-building-catalog.cjs']) {
      const result = spawnSync(process.execPath, [path.join(__dirname, script)], { cwd: ROOT, env, stdio: 'inherit' });
      if (result.error) throw result.error;
      if (result.status !== 0) throw new Error(`${script} failed (${result.status ?? result.signal})`);
    }
    fs.renameSync(stage, paths.dbPath);
    console.log(`[${paths.semester}] Published database: ${paths.dbPath}`);
  } finally {
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', interrupt);
    cleanup();
  }
}

if (require.main === module) {
  try { main(); } catch (err) { console.error(err.message); process.exitCode = 1; }
}
module.exports = { main };
