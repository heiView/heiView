const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const ROOT = path.resolve(__dirname, '..', '..');
const DB_PATH = path.join(ROOT, 'data', 'heitable.db');
const CATALOG_PATH = path.join(ROOT, 'data', 'building-catalog.json');

function toNullableInteger(value) {
  if (value === true) return 1;
  if (value === false) return 0;
  return null;
}

function normalizeCampusId(value) {
  const text = String(value || '').trim().toLowerCase();
  if (text === 'alterstadt') return 'altstadt';
  if (text === 'altstadt') return 'altstadt';
  if (text === 'bergheim') return 'bergheim';
  if (text === 'im-neuenheimer-feld') return 'im-neuenheimer-feld';
  if (text === 'other') return 'other';
  return text || 'other';
}

function normalizeCampusName(value) {
  const text = String(value || '').trim();
  const lower = text.toLowerCase();
  if (lower === 'alterstadt' || lower === 'altstadt') return 'Altstadt';
  if (lower === 'bergheim') return 'Bergheim';
  if (lower === 'im neuenheimer feld') return 'Im Neuenheimer Feld';
  if (lower === 'other') return 'Other';
  return text || 'Other';
}

function toNullableString(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
}

function ensureSchema(db) {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;

    CREATE TABLE IF NOT EXISTS campuses (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS buildings_meta (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      display_name TEXT,
      campus_id TEXT NOT NULL,
      floors_json TEXT NOT NULL,
      notes TEXT,
      FOREIGN KEY (campus_id) REFERENCES campuses(id)
    );

    CREATE TABLE IF NOT EXISTS rooms_meta (
      id TEXT PRIMARY KEY,
      building_id TEXT NOT NULL,
      name TEXT NOT NULL,
      floors_json TEXT NOT NULL,
      has_air_conditioning INTEGER,
      has_access_control INTEGER,
      has_projector INTEGER,
      has_microphone INTEGER,
      notes TEXT,
      FOREIGN KEY (building_id) REFERENCES buildings_meta(id)
    );

    CREATE INDEX IF NOT EXISTS idx_buildings_meta_campus_id
      ON buildings_meta(campus_id);

    CREATE INDEX IF NOT EXISTS idx_rooms_meta_building_id
      ON rooms_meta(building_id);

    CREATE UNIQUE INDEX IF NOT EXISTS idx_rooms_meta_building_name
      ON rooms_meta(building_id, name);
  `);

  const columns = db.prepare('PRAGMA table_info(buildings_meta);').all();
  const names = new Set(columns.map((column) => column.name));
  if (!names.has('display_name')) {
    db.exec('ALTER TABLE buildings_meta ADD COLUMN display_name TEXT;');
  }
}

function parseCatalog() {
  if (!fs.existsSync(CATALOG_PATH)) {
    throw new Error(`Catalog file not found: ${CATALOG_PATH}`);
  }

  const raw = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
  const campuses = Array.isArray(raw.campuses) ? raw.campuses : [];
  const buildings = Array.isArray(raw.buildings) ? raw.buildings : [];
  return { campuses, buildings };
}

function main() {
  const { campuses, buildings } = parseCatalog();
  const db = new Database(DB_PATH);
  ensureSchema(db);

  const insertCampus = db.prepare(`
    INSERT INTO campuses (id, name)
    VALUES (@id, @name);
  `);

  const insertBuilding = db.prepare(`
    INSERT INTO buildings_meta (
      id, name, display_name, campus_id, floors_json, notes
    ) VALUES (
      @id, @name, @display_name, @campus_id, @floors_json, @notes
    );
  `);

  const insertRoom = db.prepare(`
    INSERT INTO rooms_meta (
      id, building_id, name, floors_json,
      has_air_conditioning, has_access_control, has_projector, has_microphone,
      notes
    ) VALUES (
      @id, @building_id, @name, @floors_json,
      @has_air_conditioning, @has_access_control, @has_projector, @has_microphone,
      @notes
    );
  `);

  db.exec('BEGIN');
  try {
    db.exec('DELETE FROM rooms_meta;');
    db.exec('DELETE FROM buildings_meta;');
    db.exec('DELETE FROM campuses;');

    for (const campus of campuses) {
      if (!campus || !campus.id || !campus.name) continue;
      insertCampus.run({
        id: normalizeCampusId(campus.id),
        name: normalizeCampusName(campus.name),
      });
    }

    let buildingCount = 0;
    let roomCount = 0;

    for (const building of buildings) {
      const street = toNullableString(building?.street);
      if (!building || !building.id || !street || !building.campusId) {
        continue;
      }

      insertBuilding.run({
        id: String(building.id),
        name: street,
        display_name: toNullableString(building.displayName),
        campus_id: normalizeCampusId(building.campusId),
        floors_json: JSON.stringify(Array.isArray(building.floors) ? building.floors : []),
        notes: building.notes ? String(building.notes) : null,
      });
      buildingCount += 1;

      const rooms = Array.isArray(building.rooms) ? building.rooms : [];
      for (const room of rooms) {
        if (!room || !room.id || !room.name) continue;

        const features = room.features || {};
        insertRoom.run({
          id: String(room.id),
          building_id: String(building.id),
          name: String(room.name),
          floors_json: JSON.stringify(Array.isArray(room.floors) ? room.floors : []),
          has_air_conditioning: toNullableInteger(features.hasAirConditioning),
          has_access_control: toNullableInteger(features.hasAccessControl),
          has_projector: toNullableInteger(features.hasProjector),
          has_microphone: toNullableInteger(features.hasMicrophone),
          notes: room.notes ? String(room.notes) : null,
        });
        roomCount += 1;
      }
    }

    db.exec('COMMIT');
    console.log(`Building catalog import complete: ${DB_PATH}`);
    console.log(`Campuses: ${campuses.length}`);
    console.log(`Buildings: ${buildingCount}`);
    console.log(`Rooms: ${roomCount}`);
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  } finally {
    db.close();
  }
}

main();
