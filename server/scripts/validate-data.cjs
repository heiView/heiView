const fs = require('fs');
const path = require('path');
const { getPaths } = require('../semesters.cjs');

function validateData(paths = getPaths()) {
  if (!fs.existsSync(paths.courseDir)) throw new Error(`Course directory not found: ${paths.courseDir}`);
  const names = [...new Set([
    ...fs.readdirSync(paths.courseDir),
    ...(fs.existsSync(paths.customDir) ? fs.readdirSync(paths.customDir) : []),
  ].filter(name => /^course-.+\.json$/.test(name)))];
  if (!names.length) throw new Error(`No course data to import for ${paths.semester}`);
  for (const name of names) {
    const candidates = [path.join(paths.overridesDir, name), path.join(paths.customDir, name), path.join(paths.courseDir, name)];
    const selected = candidates.find(file => fs.existsSync(file));
    const course = JSON.parse(fs.readFileSync(selected, 'utf8'));
    if (!course || !course.id || !Array.isArray(course.weeks)) throw new Error(`Invalid course JSON: ${selected}`);
  }
  return names;
}

module.exports = { validateData };
