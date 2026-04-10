const fs = require('fs');

const CATALOG_PATH = 'data/building-catalog.json';
const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));

const existing = catalog.buildings.find(b => b.id === 'bld-peterskirche');
if (!existing) {
  catalog.buildings.push({
    "id": "bld-peterskirche",
    "street": "Peterskirche",
    "displayName": "Peterskirche",
    "campusId": "altstadt",
    "floors": [],
    "rooms": [
      {
        "id": "bld-peterskirche::rm-peterskirche",
        "name": "Peterskirche",
        "floors": [],
        "features": {},
        "notes": ""
      }
    ]
  });
  fs.writeFileSync(CATALOG_PATH, JSON.stringify(catalog, null, 2));
  console.log("Added Peterskirche to building-catalog.json");
} else {
  console.log("Peterskirche already exists in building-catalog.");
}
