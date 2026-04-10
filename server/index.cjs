const path = require('path');
const fs = require('fs');
const express = require('express');
const Database = require('better-sqlite3');

const ROOT = path.resolve(__dirname, '..');
const DB_PATH = path.join(ROOT, 'data', 'heitable.db');
const PORT = Number.parseInt(process.env.PORT || '3001', 10);

function openDb() {
  if (!fs.existsSync(DB_PATH)) {
    throw new Error(
      `SQLite database not found at ${DB_PATH}. Run \"npm run db:build\" first.`
    );
  }
  return new Database(DB_PATH, { readonly: true });
}

function makeCourseLabel(title, courseId) {
  return title || courseId || 'Unnamed Course';
}

function makeTimeRange(startTime, endTime) {
  if (startTime && endTime) {
    return `${startTime}-${endTime}`;
  }
  if (startTime) {
    return `${startTime}-`;
  }
  if (endTime) {
    return `-${endTime}`;
  }
  return '';
}

function toNullableBoolean(value) {
  if (value === null || value === undefined) return null;
  return Number(value) === 1;
}

function parseJsonArray(value) {
  if (!value || typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_err) {
    return [];
  }
}

function campusLabelFromId(value) {
  const key = String(value || '').trim().toLowerCase();
  if (key === 'altstadt' || key === 'alterstadt') return 'Altstadt';
  if (key === 'bergheim') return 'Bergheim';
  if (key === 'im-neuenheimer-feld') return 'Im Neuenheimer Feld';
  if (key === 'other') return 'Other';
  return null;
}

function createApp() {
  const app = express();

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.get('/api/schedule', (req, res) => {
    const date = typeof req.query.date === 'string' ? req.query.date.trim() : '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      res.status(400).json({ error: 'date query must be YYYY-MM-DD' });
      return;
    }

    const buildingFilter =
      typeof req.query.building === 'string' && req.query.building.trim()
        ? req.query.building.trim()
        : null;

    let db;
    try {
      db = openDb();

      const buildingCampusMap = new Map();
      const buildingDisplayNameMap = new Map();
      
      try {
        const buildingRows = db
          .prepare(
            `
              SELECT
                name,
                campus_id,
                display_name
              FROM buildings_meta
            `
          )
          .all();

        for (const buildingRow of buildingRows) {
          const buildingName = (buildingRow.name || '').trim();
          if (!buildingName) continue;
          buildingCampusMap.set(buildingName, campusLabelFromId(buildingRow.campus_id));
          const displayName = (buildingRow.display_name || '').trim();
          if (displayName) {
            buildingDisplayNameMap.set(buildingName, displayName);
          }
        }
      } catch (e) {
        console.warn('Could not load buildings_meta', e.message);
      }

      const buildingsSet = new Set();
      const rooms = {};

      function ensureBuilding(buildingName) {
        const normalized = (buildingName || '').trim() || 'Unknown';
        if (buildingFilter && normalized !== buildingFilter) {
          return null;
        }

        buildingsSet.add(normalized);
        if (!rooms[normalized]) {
          rooms[normalized] = [];
        }
        return normalized;
      }

      function ensureRoomEntry(buildingName, roomName, floorLabel, features) {
        const resolvedBuilding = ensureBuilding(buildingName);
        if (!resolvedBuilding) return null;

        const room = roomName || 'Unknown';
        const floor = floorLabel || null;
        let roomEntry = rooms[resolvedBuilding].find(
          (item) => item.room === room && (item.floor || null) === floor
        );
        if (!roomEntry) {
          roomEntry = {
            room,
            floor,
            features: features || null,
            courses: [],
          };
          rooms[resolvedBuilding].push(roomEntry);
        } else if (features) {
          roomEntry.features = {
            hasAirConditioning: features.hasAirConditioning ?? roomEntry.features?.hasAirConditioning ?? null,
            hasAccessControl: features.hasAccessControl ?? roomEntry.features?.hasAccessControl ?? null,
            hasProjector: features.hasProjector ?? roomEntry.features?.hasProjector ?? null,
            hasMicrophone: features.hasMicrophone ?? roomEntry.features?.hasMicrophone ?? null,
          };
        }
        return roomEntry;
      }

      try {
        const buildingRows = db
          .prepare(
            `
              SELECT name
              FROM buildings_meta
            `
          )
          .all();

        for (const buildingRow of buildingRows) {
          ensureBuilding(buildingRow.name);
        }
      } catch(e) {}

      try {
        const roomRows = db
          .prepare(
            `
              SELECT
                b.name AS building_name,
                r.name AS room_name,
                r.floors_json,
                r.has_air_conditioning,
                r.has_access_control,
                r.has_projector,
                r.has_microphone
              FROM rooms_meta r
              JOIN buildings_meta b ON b.id = r.building_id
            `
          )
          .all();

        for (const roomRow of roomRows) {
          const features = {
            hasAirConditioning: toNullableBoolean(roomRow.has_air_conditioning),
            hasAccessControl: toNullableBoolean(roomRow.has_access_control),
            hasProjector: toNullableBoolean(roomRow.has_projector),
            hasMicrophone: toNullableBoolean(roomRow.has_microphone),
          };

          const floors = parseJsonArray(roomRow.floors_json).map((value) =>
            value === null || value === undefined ? null : String(value)
          );
          const targetFloors = floors.length > 0 ? floors : [null];

          for (const floorLabel of targetFloors) {
            ensureRoomEntry(roomRow.building_name, roomRow.room_name, floorLabel, features);
          }
        }
      } catch(e) {}

      const rows = db
        .prepare(
          `
            SELECT
              o.building_name,
              o.floor_label,
              o.room,
              o.start_time,
              o.end_time,
              o.note,
              c.title,
              c.id AS course_id,
              c.detail_link,
              c.lecturers_json
            FROM occurrences o
            JOIN courses c ON c.id = o.course_id
            WHERE o.date = ?
            ORDER BY o.building_name, o.room, o.start_time, c.title
          `
        )
        .all(date);

      for (const row of rows) {
        let building = (row.building_name || 'Unknown').trim();
        let roomLabel = row.room || 'Unknown';
        
        if (building.toLowerCase() === 'online' || roomLabel.toLowerCase() === 'online') {
          building = 'Online';
          roomLabel = 'Online';
        }

        const floor = row.floor_label || null;
        let roomEntry = ensureRoomEntry(building, roomLabel, floor, null);
        if (!roomEntry) continue;

        let lecturers = [];
        if (row.lecturers_json) {
          try {
            lecturers = JSON.parse(row.lecturers_json);
          } catch (_err) {
            lecturers = [];
          }
        }

        const newCourse = {
          time: makeTimeRange(row.start_time, row.end_time),
          name: makeCourseLabel(row.title, row.course_id),
          note: row.note || null,
          prof: Array.isArray(lecturers)
            ? lecturers.map(l => {
                if (typeof l === 'string') {
                  let name = l.trim();
                  
                  const nnMatch = name.match(/<N\.N\.>\(([^)]+)\)/);
                  if (nnMatch) {
                    name = nnMatch[1].trim();
                  } else {
                    name = name.replace(/,\s*\d+\.\d+$/, '').trim();
                  }
                  const parts = name.split(',');
                  if (parts.length === 2) return `${parts[1].trim()} ${parts[0].trim()}`;
                  return name;
                }
                return l;
              }).join(', ')
            : '',
          link: row.detail_link || undefined,
        };

        const isDuplicate = roomEntry.courses.some(
          (c) => c.time === newCourse.time && c.name === newCourse.name
        );

        if (!isDuplicate) {
          roomEntry.courses.push(newCourse);
        }
      }

      
      // Inject No Information
      const noInfoBuilding = 'No Information';
      
      // Always add the building to the list so it appears in the UI
      buildingsSet.add(noInfoBuilding);
      buildingCampusMap.set(noInfoBuilding, 'Other');
      buildingDisplayNameMap.set(noInfoBuilding, 'No Information');
      
      // ONLY fetch and parse the thousands of unscheduled courses if explicitly selected
      if (buildingFilter === noInfoBuilding) {
        const unscheduled = db.prepare(`
          SELECT c.id AS course_id, c.title, c.detail_link, c.lecturers_json
          FROM courses c
          WHERE c.id NOT IN (SELECT course_id FROM occurrences)
        `).all();
        
        if (unscheduled.length > 0) {
          const noInfoCourses = unscheduled.map(c => {
            let lecturers = [];
            if (c.lecturers_json) {
              try { lecturers = JSON.parse(c.lecturers_json); } catch(err) {}
            }
            
            let profStr = '—';
            if (Array.isArray(lecturers) && lecturers.length > 0) {
              profStr = lecturers.map(l => {
                if (typeof l === 'string') {
                  let name = l.trim();
                  const nnMatch = name.match(/<N\.N\.>\(([^)]+)\)/);
                  if (nnMatch) {
                    name = nnMatch[1].trim();
                  } else {
                    name = name.replace(/,\s*\d+\.\d+$/, '').trim();
                  }
                  const parts = name.split(',').map(s => s.trim());
                  if (parts.length === 2) {
                    return `${parts[1]} ${parts[0]}`;
                  }
                  return name;
                }
                return l;
              }).join(', ');
            }
            
            return {
              time: '',
              name: {
                zh: c.title,
                en: c.title,
                de: c.title,
              },
              note: null,
              prof: {
                zh: profStr,
                en: profStr,
                de: profStr,
              },
              link: c.detail_link || null
            };
          });
          
          if (!rooms[noInfoBuilding]) rooms[noInfoBuilding] = [];
          rooms[noInfoBuilding].push({
            room: 'No Room',
            floor: null,
            features: {},
            courses: noInfoCourses,
          });
        }
      }

      const buildings = Array.from(buildingsSet)
        .sort((left, right) => left.localeCompare(right))
        .map((id) => ({
          id,
          street: id,
          displayName: buildingDisplayNameMap.get(id) || id,
          campus: buildingCampusMap.get(id) || null,
        }));

      res.json({
        buildings,
        rooms,
      });
    } catch (err) {
      res.status(500).json({ error: err.message || String(err) });
    } finally {
      if (db) db.close();
    }
  });

  return app;
}

const app = createApp();
app.listen(PORT, () => {
  console.log(`SQLite API listening on http://localhost:${PORT}`);
});
