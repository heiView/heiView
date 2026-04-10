const fs = require('fs');
let file = fs.readFileSync('src/styles.css', 'utf8');

const target = `.hei-control-inline .ant-select,
.hei-control-inline .ant-picker {
  flex: 1;
  min-width: 0;
}`;

const rep = `.hei-control-inline .ant-select,
.hei-control-inline .ant-picker {
  flex: none;
  min-width: 0;
}`;

if(file.includes(target)) file = file.replace(target, rep);
fs.writeFileSync('src/styles.css', file, 'utf8');
