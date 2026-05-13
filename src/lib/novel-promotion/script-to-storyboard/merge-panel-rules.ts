import type {
  ActingDirection,
  PhotographyRule,
  StoryboardPanel,
} from '@/lib/storyboard-phases'

function normalizePanelNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.trim())
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

function formatAvailablePanelNumbers(items: Array<{ panel_number?: unknown }>) {
  return items.map((item) => String(item.panel_number)).join(', ') || 'none'
}

function findRuleForPanel<T extends { panel_number?: unknown }>(params: {
  panel: StoryboardPanel
  index: number
  panelsCount: number
  items: T[]
  label: string
}): T {
  const targetNumber = normalizePanelNumber(params.panel.panel_number)
  if (targetNumber !== null) {
    const matched = params.items.find((item) => normalizePanelNumber(item.panel_number) === targetNumber)
    if (matched) return matched
  }

  if (params.items.length === params.panelsCount && params.items[params.index]) {
    return params.items[params.index]
  }

  throw new Error(
    `Missing ${params.label} for panel_number=${String(params.panel.panel_number)} at index=${params.index}; available panel_numbers=${formatAvailablePanelNumbers(params.items)}`,
  )
}

export function mergePanelsWithRules(params: {
  finalPanels: StoryboardPanel[]
  photographyRules: PhotographyRule[]
  actingDirections: ActingDirection[]
}) {
  const { finalPanels, photographyRules, actingDirections } = params
  return finalPanels.map((panel, index) => {
    const rules = findRuleForPanel({
      panel,
      index,
      panelsCount: finalPanels.length,
      items: photographyRules,
      label: 'photography rule',
    })
    const acting = findRuleForPanel({
      panel,
      index,
      panelsCount: finalPanels.length,
      items: actingDirections,
      label: 'acting direction',
    })

    return {
      ...panel,
      photographyPlan: {
        composition: rules.composition,
        lighting: rules.lighting,
        colorPalette: rules.color_palette,
        atmosphere: rules.atmosphere,
        technicalNotes: rules.technical_notes,
      },
      actingNotes: acting.characters,
    }
  })
}
