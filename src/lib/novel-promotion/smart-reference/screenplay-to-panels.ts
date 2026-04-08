/**
 * Smart Reference: Screenplay → Panels (simplified path)
 *
 * Deterministic transformation — no LLM calls needed.
 * Each screenplay scene becomes one panel with a videoPrompt
 * optimized for omnireference video models.
 */

import type { StoryboardPanel } from '@/lib/storyboard-phases'
import type { ClipPanelsResult } from '@/lib/workers/handlers/script-to-storyboard-helpers'
import { buildSmartReferencePrompt } from './prompt-builder'

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

interface ClipInput {
  id: string
  content: string
  characters: string | null
  location: string | null
  screenplay: string | null
}

interface CharacterAssetRef {
  name: string
  description?: string | null
}

interface LocationAssetRef {
  name: string
  description?: string | null
}

const VALID_CONTENT_TYPES = new Set(['action', 'dialogue', 'voiceover'])

function parseScreenplay(screenplayJson: string | null): ScreenplayScene[] {
  if (!screenplayJson) return []
  try {
    const parsed = JSON.parse(screenplayJson) as Record<string, unknown>
    const scenes = parsed.scenes
    if (!Array.isArray(scenes)) return []
    return (scenes as Array<Record<string, unknown>>).map((raw) => ({
      ...raw,
      content: Array.isArray(raw.content)
        ? (raw.content as Array<Record<string, unknown>>)
            .filter((c) => typeof c.type === 'string' && VALID_CONTENT_TYPES.has(c.type))
            .map((c) => ({ ...c, type: c.type as 'action' | 'dialogue' | 'voiceover' }))
        : undefined,
    })) as ScreenplayScene[]
  } catch {
    return []
  }
}

function buildSourceText(scene: ScreenplayScene): string {
  if (!scene.content || scene.content.length === 0) {
    return scene.description || ''
  }
  return scene.content
    .map((item) => item.text || item.lines || '')
    .filter(Boolean)
    .join(' ')
}

export function convertScreenplayToPanels(
  clips: ClipInput[],
  characterAssets: CharacterAssetRef[],
  locationAssets: LocationAssetRef[],
  artStyle?: string,
): {
  clipPanels: ClipPanelsResult[]
  totalPanelCount: number
} {
  const clipPanels: ClipPanelsResult[] = []
  let totalPanelCount = 0
  let globalPanelNumber = 1

  for (let clipIndex = 0; clipIndex < clips.length; clipIndex++) {
    const clip = clips[clipIndex]
    const scenes = parseScreenplay(clip.screenplay)
    const panels: StoryboardPanel[] = []

    if (scenes.length === 0) {
      const fallbackPrompt = buildSmartReferencePrompt(
        {
          description: clip.content.slice(0, 500),
          characters: clip.characters ? tryParseStringArray(clip.characters) : [],
          heading: { location: clip.location || undefined },
        },
        characterAssets,
        locationAssets,
        artStyle,
      )
      panels.push({
        panel_number: globalPanelNumber++,
        description: clip.content.slice(0, 500) || undefined,
        location: clip.location || undefined,
        characters: clip.characters ? tryParseStringArray(clip.characters) : [],
        source_text: clip.content.slice(0, 300),
        shot_type: '中景',
        camera_move: '固定',
        video_prompt: fallbackPrompt.mainPrompt,
        duration: fallbackPrompt.estimatedDuration,
      })
    } else {
      for (const scene of scenes) {
        const refPrompt = buildSmartReferencePrompt(
          scene,
          characterAssets,
          locationAssets,
          artStyle,
        )

        panels.push({
          panel_number: globalPanelNumber++,
          description: scene.description || undefined,
          location: scene.heading?.location || clip.location || undefined,
          characters: refPrompt.characterNames,
          source_text: buildSourceText(scene),
          shot_type: '中景',
          camera_move: '推拉',
          video_prompt: refPrompt.mainPrompt,
          duration: refPrompt.estimatedDuration,
        })
      }
    }

    totalPanelCount += panels.length
    clipPanels.push({
      clipId: clip.id,
      clipIndex,
      finalPanels: panels,
    })
  }

  return { clipPanels, totalPanelCount }
}

function tryParseStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown
    if (Array.isArray(parsed)) {
      return parsed.filter((item): item is string => typeof item === 'string')
    }
    return [value]
  } catch {
    return value.split(/[,，、]/).map((s) => s.trim()).filter(Boolean)
  }
}
