const fs = require('fs');
let content = fs.readFileSync('server/index.cjs', 'utf-8');

const regex = /        roomEntry\.courses\.push\(\{[\s\S]*?link: row\.detail_link \|\| undefined,\n        \}\);/;
const replacement = `        const newCourse = {
          time: makeTimeRange(row.start_time, row.end_time),
          name: makeCourseLabel(row.title, row.course_id),
          note: row.note || null,
          prof: Array.isArray(lecturers)
            ? lecturers.map(l => {
                if (typeof l === 'string') {
                  let name = l.trim();
                  
                  const nnMatch = name.match(/<N\\.N\\.>\\(([^)]+)\\)/);
                  if (nnMatch) {
                    name = nnMatch[1].trim();
                  } else {
                    name = name.replace(/,\\s*\\d+\\.\\d+$/, '').trim();
                  }
                  const parts = name.split(',');
                  if (parts.length === 2) return \`\${parts[1].trim()} \${parts[0].trim()}\`;
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
        }`;

content = content.replace(regex, replacement);
fs.writeFileSync('server/index.cjs', content);
