const fs = require('fs');

let file = fs.readFileSync('src/App.tsx', 'utf8');

file = file.replace("    selectedBuildingFallback: '未选择建筑',\n  },", "    selectedBuildingFallback: '未选择建筑',\n    noteLabel: '备注：',\n  },");
file = file.replace("    selectedBuildingFallback: 'No building selected',\n  },", "    selectedBuildingFallback: 'No building selected',\n    noteLabel: 'Note: ',\n  },");
file = file.replace("    selectedBuildingFallback: 'Kein Gebäude ausgewählt',\n  }", "    selectedBuildingFallback: 'Kein Gebäude ausgewählt',\n    noteLabel: 'Anmerkung: ',\n  }");

fs.writeFileSync('src/App.tsx', file, 'utf8');
