const fs = require('fs');

let file = fs.readFileSync('src/App.tsx', 'utf8');

const old1 = `        const firstBuilding = data.buildings.find((building) => {
          const street = resolveLocalizedText(building.street, language) || building.id
          const campus = normalizeCampusValue(building.campus) || resolveCampusName(street) || 'Other'
          return campus === selectedCampus
        })?.id || ''`;

const new1 = `        let firstBuilding = '';
        if (selectedCampus === 'Other') {
          const unknownBuilding = data.buildings.find(b => b.id === 'Unknown' && (normalizeCampusValue(b.campus) || resolveCampusName(resolveLocalizedText(b.street, language) || b.id) || 'Other') === 'Other');
          if (unknownBuilding) firstBuilding = unknownBuilding.id;
        }
        if (!firstBuilding) {
          firstBuilding = data.buildings.find((building) => {
            const street = resolveLocalizedText(building.street, language) || building.id
            const campus = normalizeCampusValue(building.campus) || resolveCampusName(street) || 'Other'
            return campus === selectedCampus
          })?.id || ''
        }`;

file = file.replace(old1, new1);
fs.writeFileSync('src/App.tsx', file, 'utf8');
