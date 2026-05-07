import { describe, expect, it } from 'vitest'
import {
  classifyArkGenerationTaskPhase,
  extractSeedanceTaskVideoUrl,
} from '@/lib/async-task-utils'

describe('Seedance / Ark generation task poll JSON', () => {
  it('extracts official content.video_url', () => {
    const url = extractSeedanceTaskVideoUrl({
      status: 'succeeded',
      content: { video_url: 'https://cdn.example/v.mp4' },
    })
    expect(url).toBe('https://cdn.example/v.mp4')
  })

  it('extracts gateway output.video_url', () => {
    const url = extractSeedanceTaskVideoUrl({
      status: 'SUCCESS',
      output: { video_url: 'https://gw.example/out.mp4' },
    })
    expect(url).toBe('https://gw.example/out.mp4')
  })

  it('extracts content JSON string with video_url', () => {
    const url = extractSeedanceTaskVideoUrl({
      status: 'completed',
      content: JSON.stringify({ video_url: 'https://x.test/a.mp4' }),
    })
    expect(url).toBe('https://x.test/a.mp4')
  })

  it('classifies success status aliases', () => {
    expect(classifyArkGenerationTaskPhase({ status: 'SUCCEEDED' })).toBe('success')
    expect(classifyArkGenerationTaskPhase({ status: 'Success' })).toBe('success')
    expect(classifyArkGenerationTaskPhase({ status: 'COMPLETED' })).toBe('success')
  })

  it('classifies failure status aliases', () => {
    expect(classifyArkGenerationTaskPhase({ status: 'FAILED' })).toBe('failure')
    expect(classifyArkGenerationTaskPhase({ status: 'error' })).toBe('failure')
  })

  it('classifies running as running', () => {
    expect(classifyArkGenerationTaskPhase({ status: 'running' })).toBe('running')
    expect(classifyArkGenerationTaskPhase({ status: 'pending' })).toBe('running')
  })
})
