const fs = require('fs');

let file = fs.readFileSync('src/App.tsx', 'utf8');

const oldStr1 = `  const activeBuildingId = React.useMemo(() => {
    if (selectedBuilding && filteredBuildingOptions.some((option) => option.value === selectedBuilding)) {
      return selectedBuilding
    }
    return filteredBuildingOptions[0]?.value || ''
  }, [filteredBuildingOptions, selectedBuilding])`;

const newStr1 = `  const activeBuildingId = React.useMemo(() => {
    if (selectedBuilding && filteredBuildingOptions.some((option) => option.value === selectedBuilding)) {
      return selectedBuilding
    }
    if (selectedCampus === 'Other') {
      const unknownOp = filteredBuildingOptions.find((op) => op.value === 'Unknown' || op.label.toLowerCase() === 'unknown')
      if (unknownOp) return unknownOp.value
    }
    return filteredBuildingOptions[0]?.value || ''
  }, [filteredBuildingOptions, selectedBuilding, selectedCampus])`;

const oldStr2 = `  React.useEffect(() => {
    if (filteredBuildingOptions.length === 0) return
    if (!filteredBuildingOptions.some((option) => option.value === selectedBuilding)) {
      setSelectedBuilding(filteredBuildingOptions[0].value)
    }
  }, [filteredBuildingOptions, selectedBuilding])`;

const newStr2 = `  React.useEffect(() => {
    if (filteredBuildingOptions.length === 0) return
    if (!filteredBuildingOptions.some((option) => option.value === selectedBuilding)) {
      if (selectedCampus === 'Other') {
        const unknownOp = filteredBuildingOptions.find((op) => op.value === 'Unknown' || String(op.label).toLowerCase() === 'unknown')
        if (unknownOp) {
          setSelectedBuilding(unknownOp.value)
          return
        }
      }
      setSelectedBuilding(filteredBuildingOptions[0].value)
    }
  }, [filteredBuildingOptions, selectedBuilding, selectedCampus])`;

file = file.replace(oldStr1, newStr1).replace(oldStr2, newStr2);
fs.writeFileSync('src/App.tsx', file, 'utf8');
