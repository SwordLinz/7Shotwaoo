import { describe, expect, it } from 'vitest'
import { normalizeOpenRouterUpstreamModelId } from '@/lib/model-config-contract'

describe('normalizeOpenRouterUpstreamModelId', () => {
  it('maps duplicate-vendor Xiaomi slug to OpenRouter canonical id', () => {
    expect(normalizeOpenRouterUpstreamModelId('xiaomi/xiaomi-Mimo-v2-Pro')).toBe('xiaomi/mimo-v2-pro')
    expect(normalizeOpenRouterUpstreamModelId('xiaomi/xiaomi-mimo-v2-pro')).toBe('xiaomi/mimo-v2-pro')
  })

  it('leaves other ids unchanged', () => {
    expect(normalizeOpenRouterUpstreamModelId('anthropic/claude-sonnet-4')).toBe('anthropic/claude-sonnet-4')
  })
})
