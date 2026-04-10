const fs = require('fs');

let file = fs.readFileSync('src/App.tsx', 'utf8');

const target1 = `style={{ position: 'relative', width: '100%', height: 'auto', padding: '12px', minHeight: '120px', cursor: 'pointer' }}`;
const replace1 = `style={{ position: 'relative', width: '100%', height: '140px', padding: '12px', cursor: 'pointer', overflow: 'hidden' }}`;

if(file.includes(target1)) {
    fs.writeFileSync('src/App.tsx', file.replace(target1, replace1), 'utf8');
} else {
    console.log("Could not find the target!");
}
