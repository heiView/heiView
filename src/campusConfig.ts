export type Campus = 'Altstadt' | 'Bergheim' | 'Im Neuenheimer Feld' | 'Other' | 'Online'

type CampusBuildingRule = {
  campus: Campus
  patterns: string[]
}

export const CAMPUS_BUILDING_RULES: CampusBuildingRule[] = [
  {
    campus: 'Altstadt',
    patterns: ['Altstadt'],
  },
  {
    campus: 'Bergheim',
    patterns: ['Bergheim'],
  },
  {
    campus: 'Im Neuenheimer Feld',
    patterns: ['Im Neuenheimer Feld', 'INF'],
  },
  {
    campus: 'Online',
    patterns: ['Online', 'Virtual', 'Remote'],
  },
]

export const CAMPUS_OPTIONS: Campus[] = ['Altstadt', 'Bergheim', 'Im Neuenheimer Feld', 'Online', 'Other']

export function resolveCampusFromBuilding(buildingName: string): Campus | null {
  const normalized = (buildingName || '').trim().toLowerCase()
  if (!normalized) return null

  for (const rule of CAMPUS_BUILDING_RULES) {
    const matched = rule.patterns.some((pattern) => normalized.includes(pattern.toLowerCase()))
    if (matched) return rule.campus
  }

  return null
}
