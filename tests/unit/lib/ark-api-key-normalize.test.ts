import { describe, expect, it } from 'vitest'
import { normalizeArkApiKeyForBearer } from '@/lib/ark-api'

describe('normalizeArkApiKeyForBearer', () => {
  it('trims whitespace', () => {
    expect(normalizeArkApiKeyForBearer('  ark-abc  ')).toBe('ark-abc')
  })

  it('strips duplicated Bearer prefix', () => {
    expect(normalizeArkApiKeyForBearer('Bearer ark-xyz')).toBe('ark-xyz')
    expect(normalizeArkApiKeyForBearer('bearer\tark-xyz')).toBe('ark-xyz')
  })

  it('strips wrapping quotes', () => {
    expect(normalizeArkApiKeyForBearer('"ark-q"')).toBe('ark-q')
  })
})
