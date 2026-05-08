import { describe, expect, it } from 'vitest'
import {
  filterNormalVideoModelOptions,
  filterSmartReferenceVideoModelOptions,
  isFirstLastFrameOnlyModel,
  isSmartReferenceVideoModel,
  resolveVideoModelOptionsForWorkflow,
  supportsFirstLastFrame,
} from '@/lib/model-capabilities/video-model-options'
import type { VideoModelOption } from '@/lib/novel-promotion/stages/video-stage-runtime/types'

describe('video model options partition', () => {
  const models: VideoModelOption[] = [
    {
      value: 'p::normal',
      label: 'normal',
      capabilities: {
        video: {
          generationModeOptions: ['normal'],
          firstlastframe: false,
        },
      },
    },
    {
      value: 'p::firstlast-only',
      label: 'firstlast-only',
      capabilities: {
        video: {
          generationModeOptions: ['firstlastframe'],
          firstlastframe: true,
        },
      },
    },
    {
      value: 'p::both',
      label: 'both',
      capabilities: {
        video: {
          generationModeOptions: ['normal', 'firstlastframe'],
          firstlastframe: true,
        },
      },
    },
    {
      value: 'p::custom-no-capability',
      label: 'custom-no-capability',
    },
  ]

  it('detects firstlastframe support and firstlastframe-only capability', () => {
    expect(supportsFirstLastFrame(models[0])).toBe(false)
    expect(supportsFirstLastFrame(models[1])).toBe(true)
    expect(supportsFirstLastFrame(models[2])).toBe(true)
    expect(supportsFirstLastFrame(models[3])).toBe(false)

    expect(isFirstLastFrameOnlyModel(models[0])).toBe(false)
    expect(isFirstLastFrameOnlyModel(models[1])).toBe(true)
    expect(isFirstLastFrameOnlyModel(models[2])).toBe(false)
    expect(isFirstLastFrameOnlyModel(models[3])).toBe(false)
  })

  it('filters out firstlastframe-only models from normal video model list', () => {
    const normalModels = filterNormalVideoModelOptions(models)
    expect(normalModels.map((item) => item.value)).toEqual([
      'p::normal',
      'p::both',
      'p::custom-no-capability',
    ])
  })

  it('smart-reference keeps only allowlisted multi-reference model keys', () => {
    const mixed: VideoModelOption[] = [
      {
        value: 'ark::doubao-seedance-1-5-pro-251215',
        label: 'Seedance 1.5',
        capabilities: {
          video: {
            generationModeOptions: ['normal'],
            supportsMultipleReferenceImages: true,
          },
        },
      },
      {
        value: 'kling::kling-v3-omni',
        label: 'Kling Omni',
        capabilities: { video: { generationModeOptions: ['normal'] } },
      },
      {
        value: 'runninghub::sparkvideo-2.0-i2v',
        label: 'RH Spark',
      },
      {
        value: 'vidu::viduq3-pro',
        label: 'Vidu',
        capabilities: {
          video: {
            generationModeOptions: ['normal'],
            supportsMultipleReferenceImages: true,
          },
        },
      },
    ]
    const smart = filterSmartReferenceVideoModelOptions(mixed)
    expect(smart.map((m) => m.value).sort()).toEqual([
      'kling::kling-v3-omni',
      'runninghub::sparkvideo-2.0-i2v',
    ])
    expect(isSmartReferenceVideoModel(mixed[0])).toBe(false)
    expect(isSmartReferenceVideoModel(mixed[1])).toBe(true)
    expect(isSmartReferenceVideoModel(mixed[3])).toBe(false)
  })

  it('resolveVideoModelOptionsForWorkflow matches normal workflow for smart-reference (no extra filter)', () => {
    const list: VideoModelOption[] = [
      {
        value: 'kling::kling-video-o1',
        label: 'O1',
        capabilities: { video: { generationModeOptions: ['normal', 'firstlastframe'] } },
      },
      {
        value: 'ark::doubao-seedance-1-0-pro-250528',
        label: 'Seedance',
        capabilities: { video: { generationModeOptions: ['normal'] } },
      },
    ]
    const expected = ['kling::kling-video-o1', 'ark::doubao-seedance-1-0-pro-250528']
    expect(resolveVideoModelOptionsForWorkflow(list, 'srt').map((m) => m.value)).toEqual(expected)
    expect(resolveVideoModelOptionsForWorkflow(list, 'smart-reference').map((m) => m.value)).toEqual(expected)
  })
})
