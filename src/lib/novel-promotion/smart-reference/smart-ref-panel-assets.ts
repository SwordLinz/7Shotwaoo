import type { Character, Location, NovelPromotionPanel } from '@/types/project'

/** 与分镜资产选择器 `SelectedAsset` 结构一致，避免 lib 引用 app 下 hook */
export interface SmartRefPickerAsset {
  id: string
  name: string
  type: 'character' | 'location' | 'reference'
  imageUrl: string | null
  appearanceId?: number
  appearanceName?: string
}

export interface PanelCharacterEntry {
  name: string
  appearance: string
}

export function parsePanelCharactersStructured(raw: string | null): PanelCharacterEntry[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    const out: PanelCharacterEntry[] = []
    for (const item of parsed) {
      if (typeof item === 'string') {
        const n = item.trim()
        if (n) out.push({ name: n, appearance: '初始形象' })
        continue
      }
      if (item && typeof item === 'object' && item !== null && 'name' in item) {
        const name = String((item as { name: unknown }).name).trim()
        if (!name) continue
        const appearance =
          'appearance' in item && (item as { appearance?: unknown }).appearance != null
            ? String((item as { appearance: unknown }).appearance)
            : '初始形象'
        out.push({ name, appearance })
      }
    }
    return out
  } catch {
    return raw
      .split(/[,，、]/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map((name) => ({ name, appearance: '初始形象' }))
  }
}

export function buildSelectedAssetsForSmartRefPanel(
  panel: NovelPromotionPanel,
  projectCharacters: Character[],
  projectLocations: Location[],
): SmartRefPickerAsset[] {
  const selected: SmartRefPickerAsset[] = []

  const locName = panel.location?.trim()
  if (locName) {
    const loc =
      projectLocations.find((l) => l.name === locName)
      || projectLocations.find((l) => l.name.toLowerCase() === locName.toLowerCase())
    if (loc) {
      const img =
        loc.selectedImageId
          ? loc.images.find((i) => String(i.id) === String(loc.selectedImageId))
          : undefined
      const primary = img ?? loc.images[0]
      selected.push({
        id: loc.id,
        name: loc.name,
        type: 'location',
        imageUrl: primary?.imageUrl ?? null,
      })
    }
  }

  const entries = parsePanelCharactersStructured(panel.characters)
  for (const { name, appearance } of entries) {
    const ch =
      projectCharacters.find((c) => c.name === name)
      || projectCharacters.find((c) => c.name.toLowerCase() === name.toLowerCase())
    if (!ch) continue
    const appearances = ch.appearances || []
    if (appearances.length === 0) continue

    const ap =
      appearances.find((a) => a.changeReason === appearance)
      || appearances.find((a) => a.appearanceIndex === 0)
      || appearances[0]

    const hasMultiple = appearances.length > 1
    const displayName = hasMultiple
      ? `${ch.name} - ${ap.changeReason || '默认'}`
      : ch.name

    selected.push({
      id: ch.id,
      name: displayName,
      type: 'character',
      imageUrl: ap?.imageUrl ?? null,
      appearanceId: ap.appearanceIndex,
      appearanceName: ap.changeReason,
    })
  }

  return selected
}

export function panelUpdateFromSelectedAssets(
  selected: SmartRefPickerAsset[],
  projectCharacters: Character[],
  projectLocations: Location[],
): { location: string | null; characters: string | null } {
  const locPick = selected.find((a) => a.type === 'location')
  let location: string | null = null
  if (locPick) {
    const loc =
      projectLocations.find((l) => l.id === locPick.id)
      || projectLocations.find((l) => l.name === locPick.name)
    location = loc?.name ?? locPick.name ?? null
  }

  const charPicks = selected.filter((a) => a.type === 'character')
  const entries: PanelCharacterEntry[] = []
  for (const pick of charPicks) {
    const ch = projectCharacters.find((c) => c.id === pick.id)
    const canonicalName = ch?.name?.trim() || pick.name.split(/\s*-\s*/)[0]?.trim() || pick.name
    if (!canonicalName) continue
    const appearances = ch?.appearances || []
    let appearance =
      pick.appearanceName
      || appearances.find((a) => a.appearanceIndex === pick.appearanceId)?.changeReason
      || '初始形象'
    if (pick.appearanceId !== undefined && appearances.length > 0) {
      const byId = appearances.find((a) => a.appearanceIndex === pick.appearanceId)
      if (byId?.changeReason) appearance = byId.changeReason
    }
    entries.push({
      name: canonicalName,
      appearance,
    })
  }

  if (entries.length === 0) {
    return { location, characters: null }
  }
  return { location, characters: JSON.stringify(entries) }
}
