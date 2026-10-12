const fs = require('fs');
const path = require('path');
const { AsyncLocalStorage } = require('node:async_hooks');
const config = require('../config/semesters.json');

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.resolve(process.env.HEIVIEW_DATA_DIR || path.join(ROOT, 'data'));
const context = new AsyncLocalStorage();

function validSemester(value) {
  return typeof value === 'string' && /^\d{4}(SS|WS)$/.test(value);
}

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function semesterForDate(value) {
  if (!validDate(value)) throw new Error('date must be a valid YYYY-MM-DD calendar date');
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  if (month < config.summerStartMonth) return `${year - 1}WS`;
  return `${year}${month < config.winterStartMonth ? 'SS' : 'WS'}`;
}

function today() {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: config.timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const get = (type) => parts.find(part => part.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function pathsFor(semester = process.env.HEIVIEW_SEMESTER || config.defaultSemester) {
  if (!validSemester(semester)) throw new Error('Invalid semester; expected YYYYSS or YYYYWS');
  const courseDir = path.join(DATA_DIR, semester);
  return {
    semester, dataDir: DATA_DIR, courseDir,
    dbPath: path.join(courseDir, 'heiview.db'),
    overridesDir: path.join(courseDir, 'overrides'),
    customDir: path.join(courseDir, 'custom'),
    skipListPath: path.join(courseDir, 'skip', 'skip.json'),
    feedbackDir: path.join(courseDir, 'feedback'),
    furtherInfoSkipPath: path.join(courseDir, 'further-info-skip.json'),
    syncMetaPath: path.join(courseDir, 'sync-meta.json'),
  };
}

function existingDbPath(paths) {
  if (fs.existsSync(paths.dbPath)) return paths.dbPath;
  const legacy = path.join(paths.dataDir, 'heiview.db');
  return paths.semester === config.legacySemester && fs.existsSync(legacy) ? legacy : paths.dbPath;
}

function getPaths() {
  return context.getStore() || { ...pathsFor(), dbPath: process.env.HEIVIEW_DB_PATH || pathsFor().dbPath };
}

function withPaths(paths, callback) {
  return context.run(paths, callback);
}

function databaseVersion(paths) {
  try {
    const stat = fs.statSync(paths.dbPath);
    return `${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
  } catch (_) {
    return 'missing';
  }
}

module.exports = { config, ROOT, DATA_DIR, validSemester, validDate, semesterForDate,
  today, pathsFor, existingDbPath, getPaths, withPaths, databaseVersion };
