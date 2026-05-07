import { describe, expect, it } from 'vitest'
import {
  PRESET_MODELS,
  encodeModelKey,
  isPresetComingSoonModel,
  isPresetComingSoonModelKey,
} from '@/app/[locale]/profile/components/api-config/types'

describe('api-config preset coming soon', () => {
  it('registers Nano Banana 2 under Google AI Studio presets', () => {
    const model = PRESET_MODELS.find(
      (entry) => entry.provider === 'google' && entry.modelId === 'gemini-3.1-flash-image-preview',
    )
    expect(model).toBeDefined()
    expect(model?.name).toBe('Nano Banana 2')
  })

  it('registers Seedance 2.0 preset models under Volcengine Ark', () => {
    const seedance2 = PRESET_MODELS.find(
      (entry) => entry.provider === 'ark' && entry.modelId === 'doubao-seedance-2-0',
    )
    const seedance2Fast = PRESET_MODELS.find(
      (entry) => entry.provider === 'ark' && entry.modelId === 'doubao-seedance-2-0-fast',
    )
    expect(seedance2?.name).toBe('Seedance 2.0')
    expect(seedance2Fast?.name).toBe('Seedance 2.0 Fast')
  })

  it('does not mark Seedance 2.0 as coming soon', () => {
    expect(isPresetComingSoonModel('ark', 'doubao-seedance-2-0')).toBe(false)
    expect(isPresetComingSoonModel('ark', 'doubao-seedance-2-0-fast')).toBe(false)
    expect(isPresetComingSoonModelKey(encodeModelKey('ark', 'doubao-seedance-2-0'))).toBe(false)
  })

  it('does not mark normal preset models as coming soon', () => {
    const modelKey = encodeModelKey('ark', 'doubao-seedance-1-5-pro-251215')
    expect(isPresetComingSoonModel('ark', 'doubao-seedance-1-5-pro-251215')).toBe(false)
    expect(isPresetComingSoonModelKey(modelKey)).toBe(false)
  })

  it('registers Bailian Wan i2v preset models', () => {
    const modelIds = PRESET_MODELS
      .filter((entry) => entry.provider === 'bailian' && entry.type === 'video')
      .map((entry) => entry.modelId)

    expect(modelIds).toEqual(expect.arrayContaining([
      'wan2.6-i2v-flash',
      'wan2.6-i2v',
      'wan2.5-i2v-preview',
      'wan2.2-i2v-plus',
      'wan2.2-kf2v-flash',
      'wanx2.1-kf2v-plus',
      'happyhorse-1.0-t2v',
      'happyhorse-1.0-i2v',
      'happyhorse-1.0-r2v',
      'happyhorse-1.0-video-edit',
    ]))
  })
})
