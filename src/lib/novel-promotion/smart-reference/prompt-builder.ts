/**
 * Smart Reference Video Prompt Builder
 *
 * Converts screenplay scene JSON + asset info into structured prompts
 * optimized for omnireference video models (e.g. Seedance 2.0 via RunningHub).
 */

interface ScreenplayScene {
  scene_number?: number
  heading?: {
    int_ext?: string
    location?: string
    time?: string
  }
  description?: string
  characters?: string[]
  bgm_description?: string
  sfx_description?: string
  content?: Array<{
    type: 'action' | 'dialogue' | 'voiceover'
    text?: string
    character?: string
    lines?: string
    parenthetical?: string
  }>
}

interface CharacterAssetRef {
  name: string
  description?: string | null
}

interface LocationAssetRef {
  name: string
  description?: string | null
}

export interface SmartReferenceVideoPrompt {
  mainPrompt: string
  characterNames: string[]
  locationName: string | null
  bgmDescription: string | null
  sfxDescription: string | null
  estimatedDuration: number
}

function extractActionFlow(scene: ScreenplayScene): string {
  if (!scene.content || scene.content.length === 0) return ''
  const parts: string[] = []
  for (const item of scene.content) {
    switch (item.type) {
      case 'action':
        if (item.text?.trim()) parts.push(item.text.trim())
        break
      case 'dialogue':
        if (item.character && item.lines) {
          const paren = item.parenthetical ? `（${item.parenthetical}）` : ''
          parts.push(`${item.character}${paren}说：「${item.lines}」`)
        }
        break
      case 'voiceover':
        if (item.text?.trim()) parts.push(`（旁白）${item.text.trim()}`)
        break
    }
  }
  return parts.join(' ')
}

function estimateDuration(scene: ScreenplayScene): number {
  const contentLength = (scene.content || []).reduce((sum, item) => {
    const text = item.text || item.lines || ''
    return sum + text.length
  }, 0)
  const descLen = (scene.description || '').length
  const total = contentLength + descLen
  if (total < 30) return 5
  if (total < 80) return 8
  if (total < 150) return 10
  return 10
}

function resolveCharacterDescription(
  characterName: string,
  characterAssets: CharacterAssetRef[],
): string | null {
  const match = characterAssets.find(
    (c) => c.name.toLowerCase() === characterName.toLowerCase(),
  )
  return match?.description || null
}

function resolveLocationDescription(
  locationName: string | undefined | null,
  locationAssets: LocationAssetRef[],
): string | null {
  if (!locationName) return null
  const match = locationAssets.find(
    (l) => l.name.toLowerCase() === locationName.toLowerCase(),
  )
  return match?.description || null
}

export function buildSmartReferencePrompt(
  scene: ScreenplayScene,
  characterAssets: CharacterAssetRef[],
  locationAssets: LocationAssetRef[],
  artStyle?: string,
): SmartReferenceVideoPrompt {
  const sceneChars = scene.characters || []
  const locationName = scene.heading?.location || null

  const promptParts: string[] = []

  if (artStyle) {
    promptParts.push(`画面风格：${artStyle}。`)
  }

  const heading = scene.heading
  if (heading) {
    const intExt = heading.int_ext === 'EXT' ? '外景' : '内景'
    const time = heading.time || ''
    promptParts.push(`${intExt}，${heading.location || '未知场景'}，${time}。`)
  }

  if (scene.description?.trim()) {
    promptParts.push(scene.description.trim())
  }

  const locDesc = resolveLocationDescription(locationName, locationAssets)
  if (locDesc) {
    promptParts.push(`场景环境：${locDesc}`)
  }

  for (const charName of sceneChars) {
    const charDesc = resolveCharacterDescription(charName, characterAssets)
    if (charDesc) {
      promptParts.push(`${charName}外貌：${charDesc}`)
    }
  }

  const actionFlow = extractActionFlow(scene)
  if (actionFlow) {
    promptParts.push(actionFlow)
  }

  if (scene.bgm_description?.trim()) {
    promptParts.push(`背景音乐：${scene.bgm_description.trim()}`)
  }

  if (scene.sfx_description?.trim()) {
    promptParts.push(`音效：${scene.sfx_description.trim()}`)
  }

  return {
    mainPrompt: promptParts.join('\n'),
    characterNames: sceneChars,
    locationName,
    bgmDescription: scene.bgm_description?.trim() || null,
    sfxDescription: scene.sfx_description?.trim() || null,
    estimatedDuration: estimateDuration(scene),
  }
}
