import { describe, expect, it } from 'vitest'
import { applyYouchuanTobPromptSuffixes } from '@/lib/generators/youchuan'

describe('applyYouchuanTobPromptSuffixes', () => {
  it('appends --ar from aspectRatio when missing', () => {
    expect(applyYouchuanTobPromptSuffixes('a cat', { aspectRatio: '16:9' })).toBe('a cat --ar 16:9')
    expect(applyYouchuanTobPromptSuffixes('a cat', { aspectRatio: ' 9 : 16 ' })).toBe('a cat --ar 9:16')
  })

  it('does not duplicate --ar', () => {
    expect(applyYouchuanTobPromptSuffixes('x --ar 1:1', { aspectRatio: '16:9' })).toBe('x --ar 1:1')
  })

  it('appends --q from resolution when missing', () => {
    expect(applyYouchuanTobPromptSuffixes('scene', { resolution: '2' })).toBe('scene --q 2')
    expect(applyYouchuanTobPromptSuffixes('scene', { resolution: '4K' })).toBe('scene --q 2')
    expect(applyYouchuanTobPromptSuffixes('scene', { resolution: '2K' })).toBe('scene --q 1')
  })

  it('does not duplicate --q', () => {
    expect(applyYouchuanTobPromptSuffixes('x --q 1', { resolution: '2' })).toBe('x --q 1')
  })

  it('combines ar and q', () => {
    expect(
      applyYouchuanTobPromptSuffixes('p', { aspectRatio: '3:4', resolution: '1' }),
    ).toBe('p --ar 3:4 --q 1')
  })
})
