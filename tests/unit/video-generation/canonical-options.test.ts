import { describe, expect, it } from 'vitest'
import {
  buildCanonicalVideoPayload,
  resolveCanonicalVideoGenerationOptions,
  resolveVideoGenerationModeFromPayload,
  resolveVideoModelKeyFromPayload,
  resolveVideoRuntimeSelectionsFromPayload,
} from '@/lib/video-generation/canonical-options'

describe('video-generation/canonical-options', () => {
  it('extracts model key from videoModel field', () => {
    expect(
      resolveVideoModelKeyFromPayload({ videoModel: 'ark::doubao-seedance-2-0-260128' }),
    ).toBe('ark::doubao-seedance-2-0-260128')
  })

  it('prefers firstLastFrame.flModel when available', () => {
    expect(
      resolveVideoModelKeyFromPayload({
        videoModel: 'ark::doubao-seedance-1-0-pro-250528',
        firstLastFrame: { flModel: 'ark::doubao-seedance-1-0-lite-i2v-250428' },
      }),
    ).toBe('ark::doubao-seedance-1-0-lite-i2v-250428')
  })

  it('returns null for missing/invalid model keys', () => {
    expect(resolveVideoModelKeyFromPayload(null)).toBeNull()
    expect(resolveVideoModelKeyFromPayload({})).toBeNull()
    expect(resolveVideoModelKeyFromPayload({ videoModel: 'not-a-key' })).toBeNull()
  })

  it('detects firstlastframe mode from payload presence', () => {
    expect(resolveVideoGenerationModeFromPayload({ firstLastFrame: { flModel: 'x' } })).toBe('firstlastframe')
    expect(resolveVideoGenerationModeFromPayload({})).toBe('normal')
    expect(resolveVideoGenerationModeFromPayload(null)).toBe('normal')
  })

  it('flattens runtime selections from payload top-level + generationOptions', () => {
    const selections = resolveVideoRuntimeSelectionsFromPayload({
      duration: 6,
      resolution: '720p',
      generateAudio: true,
      generationOptions: {
        containsVideoInput: false,
      },
    })
    expect(selections).toMatchObject({
      duration: 6,
      resolution: '720p',
      generateAudio: true,
      containsVideoInput: false,
      generationMode: 'normal',
    })
  })

  it('fills missing Seedance 2.0 defaults from builtin capability catalog', () => {
    const options = resolveCanonicalVideoGenerationOptions({
      modelKey: 'ark::doubao-seedance-2-0-260128',
      payload: { videoModel: 'ark::doubao-seedance-2-0-260128' },
    })
    expect(options).toMatchObject({
      generationMode: 'normal',
      duration: 4,
      resolution: '480p',
      generateAudio: true,
      containsVideoInput: false,
    })
  })

  it('honors caller-provided runtime selections when supported by the catalog', () => {
    const options = resolveCanonicalVideoGenerationOptions({
      modelKey: 'ark::doubao-seedance-2-0-260128',
      payload: { videoModel: 'ark::doubao-seedance-2-0-260128' },
      runtimeSelections: { duration: 8, resolution: '720p' },
    })
    expect(options.duration).toBe(8)
    expect(options.resolution).toBe('720p')
  })

  it('drops unsupported selections instead of poisoning billing payload', () => {
    const options = resolveCanonicalVideoGenerationOptions({
      modelKey: 'ark::doubao-seedance-2-0-260128',
      payload: {
        videoModel: 'ark::doubao-seedance-2-0-260128',
        generationOptions: { duration: 60, resolution: '8k' },
      },
    })
    expect(options.duration).toBe(4)
    expect(options.resolution).toBe('480p')
  })

  it('preserves non-capability fields (e.g. aspectRatio) on canonical payload', () => {
    const payload = buildCanonicalVideoPayload({
      payload: {
        videoModel: 'ark::doubao-seedance-2-0-260128',
        generationOptions: { aspectRatio: '9:16' },
      },
    }) as Record<string, unknown>
    const generationOptions = payload.generationOptions as Record<string, unknown>
    expect(generationOptions.aspectRatio).toBe('9:16')
    expect(generationOptions.duration).toBe(4)
    expect(generationOptions.resolution).toBe('480p')
  })

  it('returns payload untouched when model key is missing', () => {
    const payload = buildCanonicalVideoPayload({ payload: { foo: 'bar' } })
    expect(payload).toEqual({ foo: 'bar' })
  })

  it('skips canonicalization for non-record payloads', () => {
    expect(buildCanonicalVideoPayload({ payload: null })).toBeNull()
    expect(buildCanonicalVideoPayload({ payload: 'plain' })).toBe('plain')
  })
})
