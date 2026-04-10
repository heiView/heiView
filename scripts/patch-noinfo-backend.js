const fs = require('fs');

let code = fs.readFileSync('server/index.cjs', 'utf8');

const injection = `
      // Inject No Information
      const unscheduled = db.prepare(\`
        SELECT c.id AS course_id, c.title, c.detail_link, c.lecturers_json
        FROM courses c
        WHERE c.id NOT IN (SELECT course_id FROM occurrences)
      \`).all();
      
      if (unscheduled.length > 0) {
        const noInfoBuilding = 'No Information';
        buildingsSet.add(noInfoBuilding);
        buildingCampusMap.set(noInfoBuilding, 'Other');
        buildingDisplayNameMap.set(noInfoBuilding, 'No Information');
        
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
                const nnMatch = name.match(/<N\\.N\\.>\\(([^)]+)\\)/);
                if (nnMatch) {
                  name = nnMatch[1].trim();
                } else {
                  name = name.replace(/,\\s*\\d+\\.\\d+$/, '').trim();
                }
                const parts = name.split(',').map(s => s.trim());
                if (parts.length === 2) {
                  return \`\${parts[1]} \${parts[0]}\`;
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
`;

code = code.replace("const buildings = Array.from(buildingsSet)", injection + "\n      const buildings = Array.from(buildingsSet)");

fs.writeFileSync('server/index.cjs', code, 'utf8');
